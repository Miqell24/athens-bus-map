// Frontend: MapLibre GL + OpenFreeMap vector tiles (positron) + OASA line layers
// in the visual logic of the official KMK-style network map.
const KMK = '#0059a9';
const KMK_DARK = '#00294f';

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/positron',
  center: [23.73, 37.98],
  zoom: 11.5,
  attributionControl: false,
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ maxWidth: 120 }), 'bottom-left');
map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Timetables: GTFS OASA (data.gov.gr)' }));

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function init() {
  const [meta] = await Promise.all([
    fetch('data/meta.json').then((r) => r.json()),
    // Do not hang on 'load' (one stuck tile blocks it forever) —
    // a loaded style is enough, tiles catch up in the background.
    new Promise((res) => {
      if (map.loaded()) return res();
      map.once('load', res);
      const t = setInterval(() => {
        if (map.isStyleLoaded()) { clearInterval(t); res(); }
      }, 400);
    }),
  ]);

  // Panel (English, minimal): legend + mode toggles + expandable clickable line list.
  const nBus = meta.lines.filter((l) => l.mode === 'bus').length;
  const nTram = meta.lines.filter((l) => l.mode === 'tram').length;
  document.getElementById('count').textContent = `(${nBus} bus · ${nTram} metro/tram)`;
  document.getElementById('stamp').textContent = new Date(meta.generatedAt).toLocaleDateString('en-GB');
  document.getElementById('chips').innerHTML = meta.lines
    .map((l) => `<button class="chip" data-line="${esc(l.line)}" style="background:${esc(l.color)}">${esc(l.line)}</button>`)
    .join(' ');

  // Line layers go below the base style labels (street names stay readable).
  const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;

  // Strokes come from the merged-streets layer (one stroke per roadway regardless
  // of line count — the KMK map logic), not from overlapping per-line routes.
  map.addSource('streets', { type: 'geojson', data: 'data/streets.geojson' });
  map.addSource('stops', { type: 'geojson', data: 'data/stops.geojson' });

  // Trams drawn with the same logic as buses (both tracks at their true OSM
  // positions, no offset — like the two carriageways of a dual carriageway).
  map.addLayer({
    id: 'route-casing', type: 'line', source: 'streets',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.2, 14, 4.6, 17, 9],
    },
  }, firstSymbol);
  map.addLayer({
    id: 'route-line', type: 'line', source: 'streets',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': ['coalesce', ['get', 'color'], KMK],
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.1, 14, 2.3, 17, 4.5],
    },
  }, firstSymbol);

  // Line numbers: pipeline points carry the street bearing (angle) — the text is
  // rotated PARALLEL to the road and offset sideways in text space (anchor bottom
  // + offset), so it stands BESIDE the roadway along its course, never on the stroke.
  // A shared bus+rail corridor = one segment: the metro/tram row (in that line's
  // own color — M1 green, M2 red, M3 azure, tram purple) above the bus row.
  const TRAM_RED = '#d6212b';
  const railColor = ['coalesce', ['get', 'color'], TRAM_RED];
  const numberField = ['case', ['has', 'busLines'],
    ['format',
      ['get', 'lines'], { 'text-color': railColor },
      '\n', {},
      ['get', 'busLines'], { 'text-color': KMK }],
    ['format', ['get', 'lines'], {}]];
  map.addSource('labels', { type: 'geojson', data: 'data/labels.geojson' });
  map.addLayer({
    id: 'street-numbers', type: 'symbol', source: 'labels',
    minzoom: 11,
    layout: {
      'text-field': numberField,
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 14, 12.5, 17, 16],
      'text-rotate': ['get', 'angle'],
      'text-rotation-alignment': 'map',
      // 'auto' inherits pitch-alignment 'map', and that path in MapLibre 5.6 kills
      // rotated point symbols (0 rendered); the map has no pitch anyway
      'text-pitch-alignment': 'viewport',
      'text-anchor': 'bottom',
      'text-offset': [0, -1.0],
      'text-max-width': 22,
      'text-line-height': 1.15,
    },
    paint: { 'text-color': ['coalesce', ['get', 'color'], KMK], 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
  });

  map.addLayer({
    id: 'stops-dots', type: 'circle', source: 'stops',
    minzoom: 11,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2, 14, 4.2, 17, 7],
      'circle-color': ['case', ['==', ['get', 'terminus'], 1], ['coalesce', ['get', 'color'], KMK], '#ffffff'],
      'circle-stroke-color': ['case', ['==', ['get', 'terminus'], 1], ['coalesce', ['get', 'colorDark'], KMK_DARK], ['coalesce', ['get', 'color'], KMK]],
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11, 1.2, 17, 2.5],
    },
  });
  map.addLayer({
    id: 'stops-names', type: 'symbol', source: 'stops',
    minzoom: 13,
    filter: ['all', ['!=', ['get', 'terminus'], 1], ['==', ['get', 'label'], 1]],
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10.5, 17, 13.5],
      'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
      'text-radial-offset': 0.75,
      'text-justify': 'auto',
    },
    paint: { 'text-color': '#000000', 'text-halo-color': '#ffffff', 'text-halo-width': 1.7 },
  });
  map.addLayer({
    id: 'stops-terminus-names', type: 'symbol', source: 'stops',
    minzoom: 10.5,
    filter: ['all', ['==', ['get', 'terminus'], 1], ['==', ['get', 'label'], 1]],
    layout: {
      // terminus: name (black, like all stop names) + numbers of terminating
      // lines in the mode color
      'text-field': ['format',
        ['get', 'name'], {},
        '\n', {},
        ['get', 'lines'], { 'font-scale': 0.82, 'text-color': ['coalesce', ['get', 'colorDark'], KMK_DARK] }],
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 10.5, 11, 17, 14.5],
      'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
      'text-radial-offset': 0.9,
      'text-justify': 'auto',
    },
    paint: { 'text-color': '#000000', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
  });

  // Mode filters (bus/tram) + line selection: clicking a chip shows only that
  // line's route with all of its stops (properties.arr carry the line lists).
  const state = { bus: true, tram: true, selected: null };
  const busOnlyNumbers = ['case', ['has', 'busLines'],
    ['format', ['get', 'busLines'], { 'text-color': KMK }],
    ['format', ['get', 'lines'], {}]];
  const tramOnlyNumbers = ['format', ['get', 'lines'], {}];
  function applyFilters() {
    const modes = [state.bus ? 'bus' : null, state.tram ? 'tram' : null].filter(Boolean);
    const modeC = ['in', ['get', 'mode'], ['literal', modes]];
    const selC = state.selected ? ['in', state.selected, ['get', 'arr']] : true;
    map.setFilter('route-casing', ['all', modeC, selC]);
    map.setFilter('route-line', ['all', modeC, selC]);
    map.setFilter('stops-dots', ['all', modeC, selC]);
    // with a line selected, names of ALL its stops (no label clustering)
    const lblC = state.selected ? true : ['==', ['get', 'label'], 1];
    map.setFilter('stops-names', ['all', ['!=', ['get', 'terminus'], 1], modeC, selC, lblC]);
    map.setFilter('stops-terminus-names', ['all', ['==', ['get', 'terminus'], 1], modeC, selC, lblC]);
    if (state.bus && !state.tram) {
      // trams hidden: shared corridor labels (mode=tram with busLines) must stay,
      // but they show only the bus part
      map.setFilter('street-numbers', ['all', ['any', ['==', ['get', 'mode'], 'bus'], ['has', 'busLines']], selC]);
      map.setLayoutProperty('street-numbers', 'text-field', busOnlyNumbers);
    } else {
      map.setFilter('street-numbers', ['all', modeC, selC]);
      map.setLayoutProperty('street-numbers', 'text-field', state.tram && !state.bus ? tramOnlyNumbers : numberField);
    }
  }
  document.getElementById('chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    state.selected = state.selected === b.dataset.line ? null : b.dataset.line;
    document.querySelectorAll('#chips .chip').forEach((c) => c.classList.toggle('active', c.dataset.line === state.selected));
    applyFilters();
  });
  for (const [id, key] of [['toggle-bus', 'bus'], ['toggle-tram', 'tram']]) {
    document.getElementById(id).addEventListener('change', (e) => { state[key] = e.target.checked; applyFilters(); });
  }
  applyFilters();

  // POSTER-mode PNG export (like the official KMK map): the current view is
  // rendered in TILES on a hidden map instance and stitched into one ~12288 px
  // image — the GPU texture limit constrains a single tile only, not the whole.
  // pixelRatio 2 doubles text pixel density (sharp when zooming the file),
  // antialias smooths strokes, the PAD overlap reconciles labels at seams.
  // map.getStyle() carries the FULL user state: bus/tram filters, selected line, QA.
  const exportBtn = document.getElementById('export-png');
  exportBtn.addEventListener('click', async () => {
    if (exportBtn.disabled) return;
    exportBtn.disabled = true;
    const setLbl = (t) => { exportBtn.textContent = t; };
    const PAD = 200;          // CSS px of tile overlap
    const MAX_OUT = 16384;    // px of the file's longer edge (browser 2D canvas limit)
    const contCSS = 4096;     // big tile = fewer passes; actual density is measured
    const tileCSS = contCSS - 2 * PAD;
    const cont = map.getContainer();
    const vw = cont.clientWidth, vh = cont.clientHeight;
    // PRIORITY: detail (a zoom boost of ~+3 so street and stop names make it into
    // the file), then text pixel density (ratio 1–2) from the remaining budget.
    // Zoom never exceeds 17.3 — beyond that the style adds nothing but blank pixels.
    const vpLong = Math.max(vw, vh);
    const RATIO = Math.min(2, Math.max(1, MAX_OUT / (vpLong * 8)));
    let boost = Math.min(3.2, Math.log2(MAX_OUT / (vpLong * RATIO)));
    boost = Math.max(0.8, Math.min(boost, 17.3 - map.getZoom()));
    const scale = 2 ** boost;
    const W = Math.round(vw * scale), H = Math.round(vh * scale); // CSS px of the whole
    const cols = Math.ceil(W / tileCSS), rows = Math.ceil(H / tileCSS);
    const Z = map.getZoom() + Math.log2(scale);
    // mercator in world pixels at zoom Z (base style tile = 512 px)
    const world = 512 * 2 ** Z;
    const c0 = map.getCenter();
    const s0 = Math.sin((c0.lat * Math.PI) / 180);
    const tlx = ((c0.lng + 180) / 360) * world - W / 2;
    const tly = (0.5 - Math.log((1 + s0) / (1 - s0)) / (4 * Math.PI)) * world - H / 2;
    const px2ll = (x, y) => {
      const n = Math.PI - (2 * Math.PI * y) / world;
      return [(x / world) * 360 - 180, (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))];
    };
    const div = document.createElement('div');
    div.style.cssText = `position:fixed;left:-100000px;top:0;width:${contCSS}px;height:${contCSS}px;`;
    document.body.appendChild(div);
    let m2 = null;
    try {
      m2 = new maplibregl.Map({
        container: div, style: map.getStyle(), center: c0, zoom: Z,
        pixelRatio: RATIO, preserveDrawingBuffer: true, antialias: true,
        attributionControl: false, interactive: false, fadeDuration: 0,
      });
      const idle = () => new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('tile render timeout')), 45000);
        m2.once('idle', () => { clearTimeout(t); res(); });
      });
      await idle(); // full style load
      // ACTUAL tile pixel density: the GPU can silently clamp the canvas below
      // contCSS×RATIO — stitching geometry uses the MEASURED value, otherwise the
      // crops land in wrong places (reported as "cut-off squares" with blank space).
      const SR = m2.getCanvas().width / contCSS;
      const out = document.createElement('canvas');
      out.width = Math.round(W * SR);
      out.height = Math.round(H * SR);
      const ctx = out.getContext('2d');
      let k = 0;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          setLbl(`Rendering ${++k}/${rows * cols}…`);
          const x0 = i * tileCSS, y0 = j * tileCSS;
          const w = Math.min(tileCSS, W - x0), h = Math.min(tileCSS, H - y0);
          m2.jumpTo({ center: px2ll(tlx + x0 + w / 2, tly + y0 + h / 2), zoom: Z });
          m2.triggerRepaint(); // a jumpTo to the same spot would not emit idle
          await idle();
          ctx.drawImage(m2.getCanvas(),
            ((contCSS - w) / 2) * SR, ((contCSS - h) / 2) * SR, w * SR, h * SR,
            x0 * SR, y0 * SR, w * SR, h * SR);
        }
      }
      setLbl('Saving…');
      // attribution baked into the image (the DOM bar is not part of the canvas)
      const fs = Math.max(16, Math.round(out.width / 130));
      ctx.font = `${fs}px sans-serif`;
      ctx.textBaseline = 'bottom';
      const txt = '© OpenStreetMap contributors · OpenFreeMap · GTFS: OASA (data.gov.gr)';
      const tw = ctx.measureText(txt).width;
      ctx.fillStyle = 'rgba(255,255,255,0.82)';
      ctx.fillRect(out.width - tw - fs, out.height - fs * 1.7, tw + fs, fs * 1.7);
      ctx.fillStyle = '#333333';
      ctx.fillText(txt, out.width - tw - fs / 2, out.height - fs * 0.4);
      const blob = await new Promise((res) => out.toBlob(res, 'image/png'));
      if (!blob) throw new Error('toBlob returned null (out of memory?)');
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const a = document.createElement('a');
      a.download = `athens-transit_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}_${out.width}x${out.height}.png`;
      a.href = URL.createObjectURL(blob);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      // QA trace: thumbnail of the whole + 1:1 center crop (tile stitching check)
      const mk = (w2, h2, draw) => {
        const c = document.createElement('canvas');
        c.width = w2; c.height = h2;
        draw(c.getContext('2d'));
        return c.toDataURL('image/png');
      };
      const th = Math.round(400 * out.height / out.width);
      window.__lastExport = {
        width: out.width, height: out.height, tiles: rows * cols, sr: Math.round(SR * 100) / 100, bytes: blob.size,
        thumb: mk(400, th, (c2) => c2.drawImage(out, 0, 0, 400, th)),
        crop: mk(400, 400, (c2) => c2.drawImage(out, (out.width - 400) / 2, (out.height - 400) / 2, 400, 400, 0, 0, 400, 400)),
      };
    } catch (e) {
      console.error('Export failed', e);
    }
    if (m2) try { m2.remove(); } catch (e) { /* the canvas may be gone already */ }
    div.remove();
    exportBtn.disabled = false;
    setLbl('Export view as PNG');
  });

  // Raw GTFS trace — for matching QA; lazy-loaded on first toggle
  // (a large file with all lines included).
  document.getElementById('toggle-shape').addEventListener('change', (e) => {
    if (e.target.checked && !map.getSource('gtfs-shape')) {
      map.addSource('gtfs-shape', { type: 'geojson', data: 'data/gtfs-shape.geojson' });
      map.addLayer({
        id: 'gtfs-shape-line', type: 'line', source: 'gtfs-shape',
        paint: { 'line-color': '#e6003c', 'line-width': 1.8, 'line-dasharray': [2, 2] },
      });
    } else if (map.getLayer('gtfs-shape-line')) {
      map.setLayoutProperty('gtfs-shape-line', 'visibility', e.target.checked ? 'visible' : 'none');
    }
  });

  map.on('click', 'stops-dots', (e) => {
    const f = e.features[0];
    const p = f.properties;
    const label = p.lines.includes(',') ? 'lines' : 'line';
    new maplibregl.Popup({ closeButton: false, offset: 10 })
      .setLngLat(f.geometry.coordinates)
      .setHTML(`<strong>${esc(p.name)}</strong>${p.terminus ? ' · terminus' : ''}<br>${label}: ${esc(p.lines)}`)
      .addTo(map);
  });
  map.on('mouseenter', 'stops-dots', () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', 'stops-dots', () => (map.getCanvas().style.cursor = ''));

  map.fitBounds([[meta.bbox[0], meta.bbox[1]], [meta.bbox[2], meta.bbox[3]]], { padding: 70, duration: 0 });
}

init().catch((err) => {
  console.error(err);
  document.getElementById('footer').textContent = 'Data loading error: ' + err.message;
});
