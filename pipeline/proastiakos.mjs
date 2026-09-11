// Proastiakos — the Athens suburban railway of Hellenic Train — as a small,
// clean GTFS for the rail mode of this map (user request, 11.09.2026).
//
// Hellenic Train publishes no GTFS of its own. The feed read here is the one
// Transitous collects (jbb.ghsq.de/gtfs/gr-hellenic-train.gtfs.zip): every
// train of the national network, ONE ROUTE PER TRAIN NUMBER (1202, 1204, …),
// shapes drawn on OSM, ferries of the sister companies thrown in. Two copies of
// each suburban train sit side by side — route_type 106 ("Πειραιάς Πορθμείο")
// and 109 ("Πειραιάς"); the 109 copy is the suburban one and the only one read.
//
// Out of it come the four lines Hellenic Train runs in Attica, under the
// designations of its own network map and the colours of that map's legend
// (hellenictrain.gr/proastiakes-grammes-athinas):
//   A1  Πειραιάς – Αθήνα – Αεροδρόμιο        (+ the Ταύρος – Αεροδρόμιο short runs)
//   A2  Άνω Λιόσια – Αεροδρόμιο
//   A3  Αθήνα – Χαλκίδα                      (+ Αθήνα – Αφίδνες, Οινόη – Χαλκίδα)
//   A4  Πειραιάς – Αθήνα – Κιάτο             (+ Κιάτο – Ταύρος)
// Kiato – Aigio, the Kalavryta rack railway and the Patras line are other
// networks on the same map and stay out.
//
// Every id is prefixed "P:" — the build reads this feed in the same pass as
// STASY, whose numeric ids would otherwise collide.
//
// Usage: node pipeline/proastiakos.mjs <extracted Hellenic Train feed> <out dir>
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { iterCsv, readCsv } from './lib/csv.mjs';

const [SRC = 'data/hellenic-train', OUT = 'data/gtfs-p'] = process.argv.slice(2);

export const LINES = {
  A1: { name: 'Πειραιάς – Αθήνα – Αεροδρόμιο', color: '3C5494' },
  A2: { name: 'Άνω Λιόσια – Αεροδρόμιο', color: '6E6F73' },
  A3: { name: 'Αθήνα – Χαλκίδα', color: '3BB464' },
  A4: { name: 'Πειραιάς – Αθήνα – Κιάτο', color: 'F09635' },
};

// A train belongs to a line by the stations it calls at; direction 0 runs away
// from Piraeus / Athens (to the airport, Chalkida, Kiato), A2 from Ano Liosia.
const classify = (names) => {
  const has = (n) => names.includes(n);
  const first = names[0], last = names[names.length - 1];
  let line = null;
  if (has('Κιάτο')) line = 'A4';
  else if (has('Χαλκίδα') || has('Αφίδνες') || has('Οινόη')) line = 'A3';
  else if (has('Αεροδρόμιο') && (first === 'Άνω Λιόσια' || last === 'Άνω Λιόσια')) line = 'A2';
  else if (has('Αεροδρόμιο')) line = 'A1';
  if (!line) return null;
  const inbound = {
    A1: last === 'Πειραιάς' || last === 'Ταύρος',
    A2: last === 'Άνω Λιόσια',
    A3: last === 'Αθήνα' || last === 'Οινόη',
    A4: last === 'Πειραιάς' || last === 'Ταύρος',
  }[line];
  return { line, dir: inbound ? '1' : '0' };
};

// The feed's one garbled station name; the network map and the timetables
// write "ΣΚΑ (Σιδηροδρομικό κέντρο Αχαρνών)".
const NAME_FIX = { 'Σιδηροδρομικός Κέντρο Αχαρνών (ΣΚΑ)': 'ΣΚΑ (Σιδηροδρομικό Κέντρο Αχαρνών)' };

const q = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const write = (file, cols, rows) =>
  writeFileSync(join(OUT, file), [cols.join(','), ...rows.map((r) => cols.map((c) => q(r[c])).join(','))].join('\n') + '\n');

const routes = new Map((await readCsv(join(SRC, 'routes.txt')))
  .filter((r) => r.agency_id === 'hellenic-train' && r.route_type === '109')
  .map((r) => [r.route_id, r]));
const stops = new Map((await readCsv(join(SRC, 'stops.txt'))).map((s) => [s.stop_id, s]));
const trips = new Map();
for await (const t of iterCsv(join(SRC, 'trips.txt'))) if (routes.has(t.route_id)) trips.set(t.trip_id, t);

const seq = new Map();
for await (const st of iterCsv(join(SRC, 'stop_times.txt'))) {
  if (!trips.has(st.trip_id)) continue;
  let a = seq.get(st.trip_id);
  if (!a) seq.set(st.trip_id, (a = []));
  a.push(st);
}

// The feed draws a shape PER TRAIN — thirty identical copies of the Piraeus –
// Airport run. The build picks a line's geometry by the shape most trips share,
// so one stop pattern gets one shape: the first train's.
const patternShape = new Map();
const outTrips = [], outTimes = [], usedStops = new Set(), usedShapes = new Set();
const perLine = {};
for (const [tid, t] of trips) {
  const sts = (seq.get(tid) || []).sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
  if (sts.length < 2) continue;
  const names = sts.map((s) => stops.get(s.stop_id)?.stop_name || '');
  const c = classify(names);
  if (!c) continue;
  perLine[c.line] = (perLine[c.line] || 0) + 1;
  const pattern = sts.map((s) => s.stop_id).join('>');
  if (!patternShape.has(pattern) && t.shape_id) patternShape.set(pattern, t.shape_id);
  const shape = patternShape.get(pattern) || '';
  outTrips.push({
    route_id: 'P:' + c.line, service_id: 'P:' + t.service_id, trip_id: 'P:' + tid,
    trip_headsign: names[names.length - 1], trip_short_name: routes.get(t.route_id).route_short_name,
    direction_id: c.dir, shape_id: shape ? 'P:' + shape : '',
  });
  if (shape) usedShapes.add(shape);
  for (const s of sts) {
    usedStops.add(s.stop_id);
    outTimes.push({ trip_id: 'P:' + tid, arrival_time: s.arrival_time, departure_time: s.departure_time, stop_id: 'P:' + s.stop_id, stop_sequence: s.stop_sequence });
  }
}

mkdirSync(OUT, { recursive: true });
write('agency.txt', ['agency_id', 'agency_name', 'agency_url', 'agency_timezone'],
  [{ agency_id: 'P:HT', agency_name: 'Hellenic Train', agency_url: 'https://www.hellenictrain.gr', agency_timezone: 'Europe/Athens' }]);
write('routes.txt', ['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type', 'route_color', 'route_text_color'],
  Object.entries(LINES).filter(([k]) => perLine[k]).map(([k, v]) => ({
    route_id: 'P:' + k, agency_id: 'P:HT', route_short_name: k, route_long_name: v.name, route_type: '2', route_color: v.color, route_text_color: 'FFFFFF',
  })));
write('trips.txt', ['route_id', 'service_id', 'trip_id', 'trip_headsign', 'trip_short_name', 'direction_id', 'shape_id'], outTrips);
write('stop_times.txt', ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence'], outTimes);
write('stops.txt', ['stop_id', 'stop_name', 'stop_lat', 'stop_lon'],
  [...usedStops].map((id) => { const s = stops.get(id); return { stop_id: 'P:' + id, stop_name: NAME_FIX[s.stop_name] || s.stop_name, stop_lat: s.stop_lat, stop_lon: s.stop_lon }; }));
const shapeRows = [];
for await (const s of iterCsv(join(SRC, 'shapes.txt'))) {
  if (usedShapes.has(s.shape_id)) shapeRows.push({ shape_id: 'P:' + s.shape_id, shape_pt_lat: s.shape_pt_lat, shape_pt_lon: s.shape_pt_lon, shape_pt_sequence: s.shape_pt_sequence });
}
write('shapes.txt', ['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence'], shapeRows);
// the version the map's timeline shows: the day Transitous wrote the feed
const made = statSync(join(SRC, 'routes.txt')).mtime;
const ymd = `${made.getFullYear()}-${String(made.getMonth() + 1).padStart(2, '0')}-${String(made.getDate()).padStart(2, '0')}`;
write('feed_info.txt', ['feed_publisher_name', 'feed_publisher_url', 'feed_lang', 'feed_version'],
  [{ feed_publisher_name: 'Hellenic Train (collected by Transitous)', feed_publisher_url: 'https://transitous.org', feed_lang: 'el', feed_version: ymd }]);

console.log(`Proastiakos: ${outTrips.length} trips (${Object.entries(perLine).map(([k, n]) => `${k} ${n}`).join(', ')}), ` +
  `${usedStops.size} stations, ${usedShapes.size} shapes → ${OUT}`);
