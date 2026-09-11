// The map's TIMELINE (3.09.2026): every finished build of data/out/ can be kept
// as a dated VERSION, and the panel's timeline switches between them in place
// (same camera, same view, same picked line — only the data changes).
//
//   node pipeline/snapshot.mjs            archive data/out/ as a version (if not yet) + rebuild the index
//   node pipeline/snapshot.mjs --archive  archive only            (npm's prebuild hook: the build about
//                                                                  to overwrite data/out/ keeps its predecessor)
//   node pipeline/snapshot.mjs --stamp    write data/out/version.json (the feeds this build came from)
//                                          + rebuild the index    (npm's postbuild hook)
//   node pipeline/snapshot.mjs --index    rebuild the index only
//   node pipeline/snapshot.mjs --src DIR --id 2026-08-21 [--note "…"] [--label "…"] [--feeds data/gtfs,data/gtfs-t]
//                                         import an outside file set as a version (e.g. docs/data extracted
//                                         from an old commit: git archive <sha> docs/data | tar -x -C /tmp/x)
//   --note / --label without --src annotate the CURRENT build (data/out/version.json); --force overwrites;
//   --full keeps every file of the build in the archive (default: the slim set, see ARCHIVE_FILES);
//   --slim trims every existing archive to that set.
//
// Layout (all inside data/out/, so the docs sync carries it as it is):
//   data/out/versions.json             the index the frontend reads: {current, versions:[…]}
//   data/out/versions/<id>/            a full copy of one build (geojson + meta + lines + schematic)
//   data/out/versions/<id>/version.json  {id, label, note, generatedAt, feeds, archivedAt}
//   data/out/version.json              the same record for the current build (written by --stamp)
//
// A version's id is the build date (meta.generatedAt, local time) — the timeline
// picks among DATES, not calendar days. Two builds of one day: the later one
// replaces the earlier archive. Two builds of the SAME feed on different days
// both end up in the timeline; delete the redundant directory by hand and run
// --index.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, cpSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename, resolve } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data/out');
const VDIR = join(OUT, 'versions');

// Per-city table: the GTFS directories a build reads, and how the panel names
// them. Only directories that exist are recorded.
const FEED_TAGS = {
  'data/gtfs': 'OASA buses & trolleybuses (OSY)',
  'data/gtfs-t': 'STASY metro & tram',
  'data/gtfs-p': 'Hellenic Train Proastiakos',
};

// ---- CLI ----
const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const src = opt('--src');
const optId = opt('--id');
const optNote = opt('--note');
const optLabel = opt('--label');
const optFeeds = opt('--feeds');
const force = flag('--force');
const full = flag('--full');
const mode = src ? 'import' : flag('--slim') ? 'slim' : flag('--index') ? 'index' : flag('--stamp') ? 'stamp' : flag('--archive') ? 'archive' : 'default';

const pad = (n) => String(n).padStart(2, '0');
const idOf = (generatedAt) => {
  const d = new Date(generatedAt);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
// the label follows the version's DATE — its id — never the build time: a
// historical feed rebuilt today must not read as today
const labelOf = (id) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(id);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(id);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
const readJSON = (f) => JSON.parse(readFileSync(f, 'utf8'));

// one-row CSV (feed_info.txt): header + first record, quotes honoured
const parseCsvLine = (line) => {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
};
// "20260722_20260725" → 22.07.2026, "23.07.2026 07:20" → 23.07.2026, else as is
const fmtFeedDate = (s) => {
  let m = /^(\d{4})(\d{2})(\d{2})/.exec(s);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(s);
  if (m) return `${m[1]}.${m[2]}.${m[3]}`;
  return s;
};
const readFeeds = (dirs) => {
  const feeds = [];
  for (const dir of dirs) {
    const abs = resolve(ROOT, dir);
    if (!existsSync(join(abs, 'routes.txt'))) continue;
    const tag = FEED_TAGS[dir] || FEED_TAGS['data/' + basename(dir)] || basename(dir);
    const rec = { dir, tag, publisher: '', version: '', start: '', end: '' };
    const fi = join(abs, 'feed_info.txt');
    if (existsSync(fi)) {
      const lines = readFileSync(fi, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
      if (lines.length >= 2) {
        const h = parseCsvLine(lines[0]).map((s) => s.trim()), r = parseCsvLine(lines[1]);
        const col = (k) => { const i = h.indexOf(k); return i >= 0 ? (r[i] || '').trim() : ''; };
        rec.publisher = col('feed_publisher_name');
        rec.version = col('feed_version');
        rec.start = col('feed_start_date');
        rec.end = col('feed_end_date');
      }
    }
    // no feed_info: the newest timetable file's date stands in for the version
    if (!rec.version && !rec.start) {
      const mt = Math.max(...['routes.txt', 'trips.txt', 'stop_times.txt'].map((f) => (existsSync(join(abs, f)) ? statSync(join(abs, f)).mtimeMs : 0)));
      rec.version = idOf(mt);
      rec.mtime = 1;
    }
    const shown = fmtFeedDate(rec.version || rec.start);
    rec.label = shown ? `${tag} ${shown}` : tag;
    feeds.push(rec);
  }
  return feeds;
};

// the record kept beside meta.json in every version directory
// a stored record counts only for the build it describes: after a rebuild the
// version.json in data/out/ is a leftover of the PREVIOUS build (its id, feeds
// and note must not leak onto the new one)
const storedRecord = (dir, meta) => {
  const vf = join(dir, 'version.json');
  if (!existsSync(vf)) return null;
  const rec = readJSON(vf);
  return rec.generatedAt === meta.generatedAt ? rec : null;
};
const versionRecord = (dir, id, extra) => {
  const meta = readJSON(join(dir, 'meta.json'));
  const prev = storedRecord(dir, meta) || {};
  const vid = id || idOf(meta.generatedAt); // never from the record: the date of THIS build (an archive's id is its directory name anyway)
  const rec = {
    id: vid,
    label: extra.label || prev.label || labelOf(vid),
    generatedAt: meta.generatedAt,
    ...(extra.note !== undefined ? { note: extra.note } : prev.note ? { note: prev.note } : {}),
    feeds: extra.feeds || prev.feeds || [],
    archivedAt: prev.archivedAt || new Date().toISOString(),
  };
  return rec;
};
const writeRecord = (dir, rec) => writeFileSync(join(dir, 'version.json'), JSON.stringify(rec, null, 2) + '\n');

// An archived version keeps what the map DRAWS: the corridor view (streets,
// labels, stops, street names, badges, meta) and the lines view (the three
// strand files + lines-meta) — 17 MB, 2 MB on the wire. Left out (user
// decision, 3.09.2026, to keep docs/ small): route.geojson (12 MB, only the
// journey planner reads it — the planner works on the current build), the raw
// GTFS trace (QA) and the network diagram (it draws the current build anyway).
// --full archives everything.
const ARCHIVE_FILES = [
  'meta.json', 'version.json', 'streets.geojson', 'labels.geojson', 'stops.geojson', 'street-names.geojson', 'badges.geojson',
  'lines-meta.json', 'lines-strands.geojson', 'lines-corridors.geojson', 'lines-rows.geojson',
];
const SKIP = new Set(['versions', 'versions.json', '.DS_Store']);
const copyBuild = (from, to, full) => {
  mkdirSync(to, { recursive: true });
  // entry by entry: cpSync refuses a directory into its own subdirectory even
  // when a filter would skip that subdirectory
  for (const name of readdirSync(from)) {
    if (SKIP.has(name) || /\.log$/.test(name)) continue;
    if (!full && !ARCHIVE_FILES.includes(name)) continue;
    cpSync(join(from, name), join(to, name), { recursive: true });
  }
};
// trims an archive made before the slim rule (or with --full) down to it
const slimDir = (dir) => {
  let freed = 0;
  for (const name of readdirSync(dir)) {
    if (ARCHIVE_FILES.includes(name)) continue;
    const p = join(dir, name);
    freed += statSync(p).isDirectory() ? 0 : statSync(p).size;
    rmSync(p, { recursive: true, force: true });
  }
  return freed;
};

// ---- the index ----
const REQUIRED = ['meta.json', 'streets.geojson', 'stops.geojson', 'labels.geojson', 'street-names.geojson', 'badges.geojson'];
const entryOf = (dir, path, idFromDir) => {
  const missing = REQUIRED.filter((f) => !existsSync(join(dir, f)));
  if (missing.length) { console.warn(`snapshot: ${dir}: missing ${missing.join(', ')} — skipped`); return null; }
  const meta = readJSON(join(dir, 'meta.json'));
  const rec = storedRecord(dir, meta) || {};
  const modes = {};
  for (const l of meta.lines) modes[l.mode] = (modes[l.mode] || 0) + 1;
  const vid = idFromDir || rec.id || idOf(meta.generatedAt);
  return {
    id: vid,
    label: rec.label || labelOf(vid),
    ...(rec.note ? { note: rec.note } : {}),
    generatedAt: meta.generatedAt,
    path,
    nLines: meta.lines.length,
    modes,
    lines: meta.lines.map((l) => l.line),
    feeds: (rec.feeds || []).map((f) => f.label || f.tag),
    hasLines: existsSync(join(dir, 'lines-meta.json')),
    hasRoutes: existsSync(join(dir, 'route.geojson')),
  };
};
const writeIndex = () => {
  const versions = [];
  if (existsSync(join(OUT, 'meta.json'))) {
    const cur = entryOf(OUT, '', null);
    if (cur) versions.push({ ...cur, current: true });
  }
  if (existsSync(VDIR)) {
    for (const name of readdirSync(VDIR).sort()) {
      const d = join(VDIR, name);
      if (!statSync(d).isDirectory()) continue;
      const e = entryOf(d, `versions/${name}/`, name);
      if (!e) continue;
      const same = versions.find((v) => v.id === e.id);
      if (same) {
        // the current build already archived (the state between prebuild and
        // the new build) is silent; an OLDER build of the same day is shadowed
        if (same.generatedAt !== e.generatedAt) console.warn(`snapshot: versions/${name} is an older build of the same day as the current one — shadowed; delete it and rerun --index if it is stale`);
        continue;
      }
      versions.push(e);
    }
  }
  versions.sort((a, b) => (a.id + a.generatedAt).localeCompare(b.id + b.generatedAt));
  const current = versions.find((v) => v.current);
  const index = { generatedAt: new Date().toISOString(), current: current ? current.id : null, versions };
  writeFileSync(join(OUT, 'versions.json'), JSON.stringify(index) + '\n');
  console.log(`snapshot: index — ${versions.length} version${versions.length === 1 ? '' : 's'}: ${versions.map((v) => v.id + (v.current ? ' (current)' : '')).join(', ')}`);
  return index;
};

// ---- actions ----
const feedDirs = optFeeds ? optFeeds.split(',').map((s) => s.trim()).filter(Boolean) : Object.keys(FEED_TAGS);

const stamp = () => {
  if (!existsSync(join(OUT, 'meta.json'))) { console.log('snapshot: no data/out/meta.json — nothing to stamp'); return; }
  const rec = versionRecord(OUT, optId, { note: optNote, label: optLabel, feeds: readFeeds(feedDirs) });
  writeRecord(OUT, rec);
  console.log(`snapshot: stamped the current build as ${rec.id} (${rec.feeds.map((f) => f.label).join(' · ') || 'no feeds found'})`);
};

const archive = () => {
  if (!existsSync(join(OUT, 'meta.json'))) { console.log('snapshot: no data/out/meta.json — nothing to archive'); return; }
  // no version.json yet (a build older than the timeline): read the feeds now —
  // right only while the GTFS directories still hold that build's inputs
  const hasRec = !!storedRecord(OUT, readJSON(join(OUT, 'meta.json')));
  const rec = versionRecord(OUT, optId, hasRec ? { note: optNote, label: optLabel } : { note: optNote, label: optLabel, feeds: readFeeds(feedDirs) });
  const dest = join(VDIR, rec.id);
  if (existsSync(dest)) {
    const old = existsSync(join(dest, 'meta.json')) ? readJSON(join(dest, 'meta.json')).generatedAt : null;
    if (old === rec.generatedAt && !force) { console.log(`snapshot: ${rec.id} is already archived (same build) — skipped`); return; }
    console.log(`snapshot: ${rec.id} exists from ${old || '?'} — replaced by the build of ${rec.generatedAt}`);
    rmSync(dest, { recursive: true, force: true });
  }
  copyBuild(OUT, dest, full);
  writeRecord(dest, { ...rec, archivedAt: new Date().toISOString() });
  if (!hasRec) writeRecord(OUT, rec);
  console.log(`snapshot: archived the build of ${rec.generatedAt} → data/out/versions/${rec.id}/`);
};

const importDir = () => {
  const from = resolve(src);
  if (!existsSync(join(from, 'meta.json'))) { console.error(`snapshot: ${from} has no meta.json`); process.exit(1); }
  const rec = versionRecord(from, optId, { note: optNote, label: optLabel, feeds: optFeeds ? readFeeds(feedDirs) : undefined });
  const dest = join(VDIR, rec.id);
  if (existsSync(dest) && !force) { console.error(`snapshot: versions/${rec.id} exists — pass --force to replace it`); process.exit(1); }
  rmSync(dest, { recursive: true, force: true });
  copyBuild(from, dest, full);
  writeRecord(dest, { ...rec, archivedAt: new Date().toISOString() });
  console.log(`snapshot: imported ${from} → data/out/versions/${rec.id}/ (build of ${rec.generatedAt})`);
};

if (mode === 'slim') {
  if (existsSync(VDIR)) for (const name of readdirSync(VDIR).sort()) {
    const d = join(VDIR, name);
    if (!statSync(d).isDirectory()) continue;
    const freed = slimDir(d);
    if (freed) console.log(`snapshot: versions/${name} slimmed — ${(freed / 1048576).toFixed(1)} MB removed`);
  }
  writeIndex();
} else if (mode === 'import') { importDir(); writeIndex(); }
else if (mode === 'index') { if (optNote !== undefined || optLabel !== undefined) stamp(); writeIndex(); }
else if (mode === 'stamp') { stamp(); writeIndex(); }
else if (mode === 'archive') { archive(); }
else { archive(); writeIndex(); }
