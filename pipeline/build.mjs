// GTFS → OSM graph → map matching (HMM) → GeoJSON files for the frontend.
// Modes: buses (OSM roadways, navy) and trams (railway=tram tracks, red).
// Usage: node pipeline/build.mjs [--all | lines...] [--tram 1,4]
// Each mode has its own GTFS feed, graph and color; results land in shared files
// with properties.color/mode, so the frontend styles them data-driven.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { iterCsv, readCsv } from './lib/csv.mjs';
import { makeProj, resample, nearestOnPolyline, polylineLength } from './lib/geo.mjs';
import { buildGraph } from './lib/graph.mjs';
import { matchShape } from './lib/hmm.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GAP_MIN = 120;   // m — longer jumps between shape points are GTFS data gaps

const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const numSort = (a, b) => (Number(a) - Number(b)) || a.localeCompare(b);
function round6(v) { return Math.round(v * 1e6) / 1e6; }

// ---------- CLI ----------
const ARGS = process.argv.slice(2);
let tramLines = [];
const ti = ARGS.indexOf('--tram');
const busArgs = [...ARGS];
if (ti >= 0) {
  tramLines = (ARGS[ti + 1] || '').split(',').filter(Boolean);
  busArgs.splice(ti, 2);
}
const busAll = busArgs.includes('--all');
const busList = busArgs.filter((a) => a !== '--all');

const MODES = [{
  mode: 'bus', label: 'buses', gtfsDir: 'data/gtfs', osmFile: 'data/osm/krakow.json',
  graphMode: 'road', color: '#0059a9', colorDark: '#00294f',
  all: busAll, lines: busList.length ? busList : (busAll ? [] : ['102']),
}];
if (tramLines.length) MODES.push({
  mode: 'tram', label: 'trams', gtfsDir: 'data/gtfs-t', osmFile: 'data/osm/krakow-tram.json',
  graphMode: 'tram', color: '#d6212b', colorDark: '#7c1116',
  all: false, lines: tramLines,
});

function mergeRuns(all) {
  const merged = [];
  const byKey = new Map();
  for (const r of all) {
    if (r.roundabout) { merged.push(r); continue; }
    let arr = byKey.get(r.linesKey);
    if (!arr) byKey.set(r.linesKey, (arr = []));
    arr.push(r);
  }
  const pk = (c) => c[0] + ',' + c[1];
  for (const arr of byKey.values()) {
    const ends = new Map();
    arr.forEach((r, i) => {
      for (const [k, end] of [[pk(r.coords[0]), 0], [pk(r.coords[r.coords.length - 1]), 1]]) {
        let l = ends.get(k);
        if (!l) ends.set(k, (l = []));
        l.push({ i, end });
      }
    });
    const used = new Array(arr.length).fill(false);
    const free = (k) => (ends.get(k) || []).filter((e) => !used[e.i]);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < arr.length; i++) {
        if (used[i]) continue;
        const r = arr[i];
        const k0 = pk(r.coords[0]), k1 = pk(r.coords[r.coords.length - 1]);
        let coords;
        if (pass === 0) {
          if (free(k0).length === 1) coords = [...r.coords];
          else if (free(k1).length === 1) coords = [...r.coords].reverse();
          else continue;
        } else coords = [...r.coords];
        used[i] = true;
        const names = new Set(r.name ? [r.name] : []);
        for (;;) {
          const cands = free(pk(coords[coords.length - 1]));
          if (cands.length !== 1) break; // fork/end — we do not guess
          const { i: ni, end } = cands[0];
          const nr = arr[ni];
          used[ni] = true;
          const add = end === 0 ? nr.coords : [...nr.coords].reverse();
          for (let p = 1; p < add.length; p++) coords.push(add[p]);
          if (nr.name) names.add(nr.name);
        }
        merged.push({ coords, name: [...names][0] || '', linesKey: r.linesKey, roundabout: 0 });
      }
    }
  }
  return merged;
}

async function processMode(cfg) {
  log(`== ${cfg.label} ==`);

  // ---------- 1) routes.txt → line list and route_ids ----------
  const routes = await readCsv(join(ROOT, cfg.gtfsDir, 'routes.txt'));
  let LINES = cfg.all
    ? [...new Set(routes.map((r) => r.route_short_name))].sort(numSort)
    : cfg.lines;
  const routeToLine = new Map();
  const missing = [];
  for (const L of LINES) {
    const ids = routes.filter((r) => r.route_short_name === L).map((r) => r.route_id);
    if (!ids.length) { missing.push(L); continue; }
    for (const id of ids) routeToLine.set(id, L);
  }
  if (missing.length) log(`SKIPPED (absent from routes.txt): ${missing.join(', ')}`);
  LINES = LINES.filter((L) => !missing.includes(L));
  log(`Lines (${LINES.length}): ${LINES.join(', ')}`);

  // ---------- 2) trips.txt → representative variant (shape) per line+direction ----------
  const byLineDir = new Map();
  for await (const t of iterCsv(join(ROOT, cfg.gtfsDir, 'trips.txt'))) {
    const L = routeToLine.get(t.route_id);
    if (!L) continue;
    let dirs = byLineDir.get(L);
    if (!dirs) byLineDir.set(L, (dirs = new Map()));
    const dir = t.direction_id || '0';
    let m = dirs.get(dir);
    if (!m) dirs.set(dir, (m = new Map()));
    let e = m.get(t.shape_id);
    if (!e) m.set(t.shape_id, (e = { count: 0, trips: [] }));
    e.count++;
    if (e.trips.length < 40) e.trips.push({ trip_id: t.trip_id, headsign: t.trip_headsign });
  }
  let reps = [];
  for (const L of LINES) {
    const dirs = byLineDir.get(L);
    if (!dirs) { log(`SKIPPED line ${L}: no trips in trips.txt`); continue; }
    for (const dir of [...dirs.keys()].sort()) {
      const m = dirs.get(dir);
      let best = null;
      for (const [shapeId, e] of m) if (!best || e.count > best.e.count) best = { shapeId, e };
      reps.push({
        line: L, dir, shapeId: best.shapeId,
        headsign: best.e.trips[0]?.headsign || '',
        candTrips: new Set(best.e.trips.map((x) => x.trip_id)),
        variants: m.size, tripCount: best.e.count,
      });
    }
  }

  // ---------- 3) stop_times.txt (streaming) → stop sequences ----------
  const allTripIds = new Set();
  for (const r of reps) for (const id of r.candTrips) allTripIds.add(id);
  const tripStops = new Map();
  for await (const st of iterCsv(join(ROOT, cfg.gtfsDir, 'stop_times.txt'))) {
    if (!allTripIds.has(st.trip_id)) continue;
    let arr = tripStops.get(st.trip_id);
    if (!arr) tripStops.set(st.trip_id, (arr = []));
    arr.push({ seq: Number(st.stop_sequence), stopId: st.stop_id });
  }
  for (const r of reps) {
    let bestTrip = null, bestLen = -1;
    for (const id of r.candTrips) {
      const n = tripStops.get(id)?.length ?? 0;
      if (n > bestLen) { bestLen = n; bestTrip = id; }
    }
    r.stopSeq = (tripStops.get(bestTrip) || []).sort((a, b) => a.seq - b.seq);
  }

  // ---------- 4) shapes.txt (streaming) → route polylines ----------
  const shapeIds = new Set(reps.map((r) => r.shapeId));
  const shapePts = new Map();
  for await (const s of iterCsv(join(ROOT, cfg.gtfsDir, 'shapes.txt'))) {
    if (!shapeIds.has(s.shape_id)) continue;
    let arr = shapePts.get(s.shape_id);
    if (!arr) shapePts.set(s.shape_id, (arr = []));
    arr.push([Number(s.shape_pt_sequence), Number(s.shape_pt_lat), Number(s.shape_pt_lon)]);
  }
  for (const r of reps) {
    const pts = (shapePts.get(r.shapeId) || []).sort((a, b) => a[0] - b[0]);
    r.shapeLatLon = pts.map((p) => [p[1], p[2]]);
    if (r.shapeLatLon.length < 2) log(`SKIPPED ${r.line}/${r.dir}: empty shape ${r.shapeId}`);
  }
  reps = reps.filter((r) => r.shapeLatLon.length >= 2);

  // ---------- 5) stops.txt ----------
  const stopsById = new Map();
  for (const s of await readCsv(join(ROOT, cfg.gtfsDir, 'stops.txt'))) {
    stopsById.set(s.stop_id, { name: s.stop_name, lat: Number(s.stop_lat), lon: Number(s.stop_lon) });
  }

  // ---------- 6) local projection + graph ----------
  let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
  for (const r of reps) for (const [lat, lon] of r.shapeLatLon) {
    if (lat < latMin) latMin = lat; if (lat > latMax) latMax = lat;
    if (lon < lonMin) lonMin = lon; if (lon > lonMax) lonMax = lon;
  }
  const proj = makeProj((latMin + latMax) / 2, (lonMin + lonMax) / 2);
  const osm = JSON.parse(readFileSync(join(ROOT, cfg.osmFile), 'utf8'));
  const graph = buildGraph(osm.elements, proj, cfg.graphMode);
  log(`Graph (${cfg.graphMode}): ${graph.nodes.size} nodes, ${graph.segs.length} segments, ${graph.ways.size} ways`);

  // ---------- 7) map matching per line+direction ----------
  const segLines = new Map();
  const rawRunsAll = [];
  for (const r of reps) {
    const xy = r.shapeLatLon.map(([lat, lon]) => proj.toXY(lat, lon));
    let gaps = 0, maxGap = 0;
    for (let i = 1; i < xy.length; i++) {
      const L = Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
      if (L > GAP_MIN) { gaps++; if (L > maxGap) maxGap = L; }
    }
    if (gaps) log(`  shape gap ${r.line}/${r.dir}: ${gaps} × >${GAP_MIN} m (max ${Math.round(maxGap)} m) — bridged by routing`);
    const sampled = resample(xy, 20, GAP_MIN);
    const res = matchShape(graph, sampled);
    if (!res) { log(`SKIPPED ${r.line}/${r.dir}: matching failed`); continue; }
    r.matchedXY = res.coords;
    r.usedSegs = res.usedSegs;
    r.stats = res.stats;
    r.lengthKm = polylineLength(res.coords) / 1000;
    for (const si of res.usedSegs) {
      let set = segLines.get(si);
      if (!set) segLines.set(si, (set = new Set()));
      set.add(r.line);
    }
    for (const raw of res.rawStretches) {
      if (raw.length < 2) continue;
      let len = 0;
      for (let i = 1; i < raw.length; i++) len += Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]);
      const mid = raw[Math.floor(raw.length / 2)];
      let g = rawRunsAll.find((g) => Math.hypot(g.x - mid[0], g.y - mid[1]) < 60 && Math.abs(g.len - len) < Math.max(60, len * 0.3));
      if (g) g.lines.add(r.line);
      else rawRunsAll.push({
        x: mid[0], y: mid[1], len,
        lines: new Set([r.line]),
        coords: raw.map(([x, y]) => { const [lon, lat] = proj.toLonLat(x, y); return [round6(lon), round6(lat)]; }),
      });
    }
    log(`line ${r.line} dir ${r.dir}: ${r.lengthKm.toFixed(2)} km, mean error ${res.stats.meanError.toFixed(1)} m, ` +
        `breaks=${res.stats.viterbiBreaks} (bridged=${res.stats.bridged}, raw=${res.stats.rawStretchCount}/${res.stats.rawMeters} m), ` +
        `roundabouts=${res.stats.roundaboutSegs}, no candidates=${res.stats.noCandidates}`);
    for (const [bx, by] of res.breakPts) {
      const [lon, lat] = proj.toLonLat(bx, by);
      log(`  BREAK ${r.line}/${r.dir} @ ${lat.toFixed(5)},${lon.toFixed(5)}`);
    }
  }
  reps = reps.filter((r) => r.matchedXY);

  // Trams take the IDENTICAL path as buses: we draw every traversed segment of
  // every direction. The two directional tracks (~3 m apart) are the analog of the
  // two carriageways of a dual carriageway for buses — both strokes, zero selection.
  // The earlier per-line "base track" selection + seam welding produced stubs at
  // every base handoff between lines (reported by the user at 23 lines).

  // ---------- 8) stops: merge by stop_id, line list, snap to routes ----------
  const stopAgg = new Map();
  for (const r of reps) {
    r.stopSeq.forEach((s, i) => {
      const st = stopsById.get(s.stopId);
      if (!st) return;
      let e = stopAgg.get(s.stopId);
      if (!e) stopAgg.set(s.stopId, (e = { name: st.name, lat: st.lat, lon: st.lon, lines: new Set(), terminus: 0 }));
      e.lines.add(r.line);
      if (i === 0 || i === r.stopSeq.length - 1) e.terminus = 1;
    });
  }
  const stopFeatures = [];
  let stopsFar = 0;
  for (const e of stopAgg.values()) {
    const [sx, sy] = proj.toXY(e.lat, e.lon);
    let best = null;
    for (const r of reps) {
      if (!e.lines.has(r.line)) continue;
      const near = nearestOnPolyline(sx, sy, r.matchedXY);
      if (near && (!best || near.d < best.d)) best = near;
    }
    const useSnap = best && best.d <= 80;
    if (!useSnap) stopsFar++;
    const [lon, lat] = useSnap ? proj.toLonLat(best.x, best.y) : [e.lon, e.lat];
    stopFeatures.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [round6(lon), round6(lat)] },
      properties: {
        name: e.name,
        lines: [...e.lines].sort(numSort).join(', '),
        arr: [...e.lines].sort(numSort),
        terminus: e.terminus,
        mode: cfg.mode,
        color: cfg.color,
        colorDark: cfg.colorDark,
        snapDist: best ? Math.round(best.d) : null,
      },
    });
  }
  if (stopsFar) log(`WARNING: ${stopsFar} stops farther than 80 m from the route (kept at GTFS position)`);

  // One label per pole group: clustering by name within a 220 m radius.
  const byName = new Map();
  for (const f of stopFeatures) {
    let g = byName.get(f.properties.name);
    if (!g) byName.set(f.properties.name, (g = []));
    g.push(f);
  }
  let labelCount = 0;
  for (const g of byName.values()) {
    const clusters = [];
    for (const f of g) {
      const [lon, lat] = f.geometry.coordinates;
      const [x, y] = proj.toXY(lat, lon);
      let c = clusters.find((c) => Math.hypot(c.x - x, c.y - y) < 220);
      if (!c) clusters.push((c = { x, y, best: f }));
      else if (f.properties.terminus > c.best.properties.terminus) c.best = f;
      f.properties.label = 0;
    }
    for (const c of clusters) { c.best.properties.label = 1; labelCount++; }
  }
  log(`Stops: ${stopFeatures.length} poles, ${labelCount} labels`);

  // ---------- 9) streets/tracks: runs merged per line set ----------
  const byWay = new Map();
  for (const [si, lines] of segLines) {
    const s = graph.segs[si];
    let m = byWay.get(s.wayId);
    if (!m) byWay.set(s.wayId, (m = new Map()));
    m.set(s.wayPos, lines);
  }
  const runs = [];
  for (const [wayId, posMap] of byWay) {
    const way = graph.ways.get(wayId);
    const positions = [...posMap.keys()].sort((a, b) => a - b);
    const keyOf = (pos) => [...posMap.get(pos)].sort(numSort).join(', ');
    const flush = (start, end, linesKey) => {
      const ids = way.nodeIds.slice(start, end + 2);
      const coords = ids.map((id) => {
        const n = graph.nodes.get(id);
        return [round6(n.lon), round6(n.lat)];
      });
      if (coords.length >= 2) runs.push({ coords, name: way.name, linesKey, roundabout: way.roundabout ? 1 : 0 });
    };
    let runStart = positions[0], prevPos = positions[0], runKey = keyOf(positions[0]);
    for (let i = 1; i < positions.length; i++) {
      const pos = positions[i], key = keyOf(pos);
      if (pos !== prevPos + 1 || key !== runKey) {
        flush(runStart, prevPos, runKey);
        runStart = pos;
        runKey = key;
      }
      prevPos = pos;
    }
    flush(runStart, prevPos, runKey);
  }
  const mergedRuns = mergeRuns(runs);
  const streetFeatures = mergedRuns.map((r) => ({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: r.coords },
    properties: { name: r.name, lines: r.linesKey, arr: r.linesKey.split(', '), roundabout: r.roundabout, mode: cfg.mode, color: cfg.color },
  }));
  for (const g of rawRunsAll) {
    streetFeatures.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: g.coords },
      properties: { name: '', lines: [...g.lines].sort(numSort).join(', '), arr: [...g.lines].sort(numSort), roundabout: 0, mode: cfg.mode, color: cfg.color, unmapped: 1 },
    });
  }
  log(`Runs: ${runs.length} → ${mergedRuns.length} after merging` +
      (rawRunsAll.length ? ` (+${rawRunsAll.length} outside OSM)` : ''));

  const toLonLat = (xy) => xy.map(([x, y]) => { const [lon, lat] = proj.toLonLat(x, y); return [round6(lon), round6(lat)]; });
  const routeFeatures = reps.map((r) => ({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: toLonLat(r.matchedXY) },
    properties: { line: r.line, dir: r.dir, headsign: r.headsign, mode: cfg.mode, color: cfg.color },
  }));
  const shapeFeatures = reps.map((r) => ({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: r.shapeLatLon.map(([lat, lon]) => [lon, lat]) },
    properties: { line: r.line, dir: r.dir, mode: cfg.mode },
  }));
  const metaLines = [...new Set(reps.map((r) => r.line))].sort(numSort).map((L) => ({
    line: L,
    mode: cfg.mode,
    color: cfg.color,
    dirs: reps.filter((r) => r.line === L).map((r) => ({
      dir: r.dir, headsign: r.headsign, variants: r.variants, tripCount: r.tripCount,
      stops: r.stopSeq.length, lengthKm: Math.round(r.lengthKm * 100) / 100, stats: r.stats,
    })),
  }));

  return { routeFeatures, shapeFeatures, stopFeatures, streetFeatures, metaLines };
}

// ---------- run per mode + write shared files ----------
const results = [];
for (const cfg of MODES) results.push(await processMode(cfg));

const routeFeatures = results.flatMap((r) => r.routeFeatures);
const shapeFeatures = results.flatMap((r) => r.shapeFeatures);
const stopFeatures = results.flatMap((r) => r.stopFeatures);
const streetFeatures = results.flatMap((r) => r.streetFeatures);
const metaLines = results.flatMap((r) => r.metaLines);

// ---------- 10) line-number labels: SHARED across both modes ----------
// On a street shared by trams and buses the roadway and the track are parallel
// geometries 2–6 m apart — separate labels of both modes fought for space.
// Here we pair them geometrically: a tram run following a bus roadway gets
// `busLines` (one number segment: red + blue), and the covered bus run gets
// `nolabel` (its stroke stays, the track takes over its numbers).
{
  const [lon0, lat0] = streetFeatures[0].geometry.coordinates[0];
  const P = makeProj(lat0, lon0);
  const CELL = 60, NEAR = 18, STEP = 25;
  const wrap = (f) => {
    const xy = f.geometry.coordinates.map(([lon, lat]) => P.toXY(lat, lon));
    let len = 0;
    for (let i = 1; i < xy.length; i++) len += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
    return { f, xy, len };
  };
  const labelable = (f) => !f.properties.roundabout && !f.properties.unmapped;
  const busF = streetFeatures.filter((f) => f.properties.mode === 'bus' && labelable(f)).map(wrap);
  const tramF = streetFeatures.filter((f) => f.properties.mode === 'tram' && labelable(f)).map(wrap);
  const gridOf = (list) => {
    const g = new Map();
    list.forEach((o, oi) => {
      for (let i = 0; i + 1 < o.xy.length; i++) {
        const [ax, ay] = o.xy[i], [bx, by] = o.xy[i + 1];
        for (let cx = Math.floor(Math.min(ax, bx) / CELL); cx <= Math.floor(Math.max(ax, bx) / CELL); cx++)
          for (let cy = Math.floor(Math.min(ay, by) / CELL); cy <= Math.floor(Math.max(ay, by) / CELL); cy++) {
            const k = cx + ':' + cy;
            let arr = g.get(k);
            if (!arr) g.set(k, (arr = []));
            arr.push([ax, ay, bx, by, oi]);
          }
      }
    });
    return g;
  };
  const dSeg = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };
  const samplesOf = (xy) => {
    const out = [];
    let carry = 0;
    for (let i = 0; i + 1 < xy.length; i++) {
      const [ax, ay] = xy[i], [bx, by] = xy[i + 1];
      const L = Math.hypot(bx - ax, by - ay);
      if (!L) continue;
      let d = carry;
      while (d <= L) { const t = d / L; out.push([ax + t * (bx - ax), ay + t * (by - ay)]); d += STEP; }
      carry = d - L;
    }
    return out;
  };
  const nearAt = (grid, x, y) => {
    const hit = new Set();
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iy = cy - 1; iy <= cy + 1; iy++)
      for (const [ax, ay, bx, by, oi] of grid.get(ix + ':' + iy) || [])
        if (!hit.has(oi) && dSeg(x, y, ax, ay, bx, by) <= NEAR) hit.add(oi);
    return hit;
  };
  const busGrid = gridOf(busF), tramGrid = gridOf(tramF);
  const adopted = new Set(); // bus runs whose numbers were taken over by some track
  for (const o of tramF) {
    const smp = samplesOf(o.xy);
    if (smp.length < 2) continue;
    const nearLen = new Map();
    let nearAny = 0;
    for (const [x, y] of smp) {
      const hit = nearAt(busGrid, x, y);
      if (hit.size) nearAny++;
      for (const oi of hit) nearLen.set(oi, (nearLen.get(oi) || 0) + STEP);
    }
    if (nearAny / smp.length < 0.55) continue;
    const lines = new Set();
    for (const [oi, L] of nearLen) {
      const b = busF[oi];
      // brief brushes (intersections) do not count as a shared corridor
      if (L >= Math.max(60, 0.35 * Math.min(o.len, b.len))) {
        for (const s of b.f.properties.lines.split(', ')) lines.add(s);
        adopted.add(oi);
      }
    }
    if (lines.size) o.f.properties.busLines = [...lines].sort(numSort).join(', ');
  }
  busF.forEach((o, oi) => {
    if (!adopted.has(oi)) return; // numbers not adopted anywhere — the label stays
    const smp = samplesOf(o.xy);
    if (smp.length < 2) return;
    let nearAny = 0;
    for (const [x, y] of smp) if (nearAt(tramGrid, x, y).size) nearAny++;
    if (nearAny / smp.length >= 0.7) o.f.properties.nolabel = 1;
  });

  // Numbers ONCE per street: one label per (street name × line set) pair —
  // a set change on the same street or the next street = a new label. A group
  // (twin carriageways/tracks of the same street) gets one anchor at the midpoint
  // of its longest run. The point carries the street BEARING: the frontend rotates
  // the text parallel to the road and offsets it aside, so the number stands
  // BESIDE the roadway along its course.
  var labelFeatures = [];
  const groups = new Map(); // (name|set) → longest run of the group
  let anonId = 0;
  for (const f of streetFeatures) {
    const p = f.properties;
    if (p.roundabout || p.nolabel) continue;
    const coords = f.geometry.coordinates;
    const xy = coords.map(([lon, lat]) => P.toXY(lat, lon));
    const segLens = [];
    let total = 0;
    for (let i = 1; i < xy.length; i++) {
      const L = Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
      segLens.push(L);
      total += L;
    }
    if (total < 60) continue;
    // no name (links, construction) means no street identity — each run on its own
    const gKey = (p.name || `~${anonId++}`) + '|' + p.lines + '|' + (p.busLines || '');
    const g = groups.get(gKey);
    if (!g || total > g.total) groups.set(gKey, { f, coords, xy, segLens, total });
  }
  const WIN = 30;
  for (const g of groups.values()) {
    const { f, coords, xy, segLens, total } = g;
    const p = f.properties;
    const at = (d) => {
      let acc = 0;
      for (let i = 0; i < segLens.length; i++) {
        if (acc + segLens[i] >= d || i === segLens.length - 1) {
          const t = segLens[i] ? Math.min(1, Math.max(0, (d - acc) / segLens[i])) : 0;
          return {
            x: xy[i][0] + t * (xy[i + 1][0] - xy[i][0]), y: xy[i][1] + t * (xy[i + 1][1] - xy[i][1]),
            lon: coords[i][0] + t * (coords[i + 1][0] - coords[i][0]), lat: coords[i][1] + t * (coords[i + 1][1] - coords[i][1]),
          };
        }
        acc += segLens[i];
      }
    };
    // anchor at the midpoint; if there is a tight bend there, try a straighter spot nearby
    let placed = null;
    for (const d of [total / 2, total * 0.35, total * 0.65, total * 0.2, total * 0.8]) {
      const c = at(d), a = at(Math.max(0, d - WIN)), b = at(Math.min(total, d + WIN));
      const dx = b.x - a.x, dy = b.y - a.y;
      if (Math.hypot(dx, dy) < 5) continue;
      let ang = Math.atan2(-dy, dx) * 180 / Math.PI; // clockwise degrees, screen y downwards
      if (ang > 90) ang -= 180;   // normalization: text never upside down
      if (ang < -90) ang += 180;
      placed = { c, ang };
      break;
    }
    if (!placed) continue;
    const arr = p.busLines ? [...p.lines.split(', '), ...p.busLines.split(', ')] : p.lines.split(', ');
    const props = { lines: p.lines, color: p.color, mode: p.mode, arr, angle: Math.round(placed.ang * 10) / 10 };
    if (p.busLines) props.busLines = p.busLines;
    labelFeatures.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [round6(placed.c.lon), round6(placed.c.lat)] }, properties: props });
  }
  const nShared = tramF.filter((o) => o.f.properties.busLines).length;
  log(`Labels: ${nShared} shared bus+tram segments, ${busF.filter((o) => o.f.properties.nolabel).length} roadways hand their numbers to tracks, ${labelFeatures.length} number labels`);
}

let bLonMin = Infinity, bLonMax = -Infinity, bLatMin = Infinity, bLatMax = -Infinity;
for (const f of routeFeatures) for (const [lon, lat] of f.geometry.coordinates) {
  if (lon < bLonMin) bLonMin = lon; if (lon > bLonMax) bLonMax = lon;
  if (lat < bLatMin) bLatMin = lat; if (lat > bLatMax) bLatMax = lat;
}

const outDir = join(ROOT, 'data/out');
mkdirSync(outDir, { recursive: true });
const fc = (features) => JSON.stringify({ type: 'FeatureCollection', features });
writeFileSync(join(outDir, 'route.geojson'), fc(routeFeatures));
writeFileSync(join(outDir, 'streets.geojson'), fc(streetFeatures));
writeFileSync(join(outDir, 'labels.geojson'), fc(labelFeatures));
writeFileSync(join(outDir, 'stops.geojson'), fc(stopFeatures));
writeFileSync(join(outDir, 'gtfs-shape.geojson'), fc(shapeFeatures));
writeFileSync(join(outDir, 'meta.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  bbox: [bLonMin, bLatMin, bLonMax, bLatMax],
  modes: MODES.map((m) => ({ mode: m.mode, label: m.label, color: m.color })),
  lines: metaLines,
}, null, 2));
log(`Wrote data/out/{route,streets,labels,stops,gtfs-shape}.geojson + meta.json`);
