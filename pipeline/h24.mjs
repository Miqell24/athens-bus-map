// Lines running ROUND THE CLOCK print a black "+" after their number, one
// space away: "100 +" (user 18.09.2026: "jeżeli czarne podkreślenie linii 24/7
// jest problematyczne, może być inny symbol — np. czarny + po numerze i
// spacji"). The black underline of 17.09 could be drawn on the panel chips and
// the terminus badges but NOT in the street rows — MapLibre has no text
// decoration — and the rows are where a reader meets the number. One mark
// everywhere instead: rows here, chips / badges / popups in app.js (meta.json
// h24), the PDF export through the same `format` sections.
//
// A post-pass over the written outputs, run LAST (after night.mjs, names.mjs,
// railrows.mjs): a row that carries a 24/7 number gets its text as coloured
// SECTIONS (l0/c0 …, bl/bc for the bus-only view, tl/tc for the tram-only view
// — the properties app.js's colouredRow / sectionRow already read). A row the
// earlier passes have sectioned keeps those sections; the "+" is cut into them.
// Idempotent: a "+" section of an earlier run is dropped before the row is cut.
//
// Usage: import { h24Pass } from './h24.mjs'; h24Pass(dir, new Set(['bus|100']), { log })
//    or: node h24.mjs <dir> 'bus|100' 'tram|6' …
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BLACK = '#000000';
const TROLLEY_GREEN = '#149a3f';
const KMK = '#0059a9';
const MARK = ' +';
const split = (s) => (s ? String(s).split(',').map((x) => x.trim()).filter(Boolean) : []);

export function h24Pass(dir, H24, opts = {}) {
  const log = opts.log || (() => {});
  const file = join(dir, 'labels.geojson');
  if (!H24 || !H24.size || !existsSync(file)) return 0;
  const labels = JSON.parse(readFileSync(file, 'utf8'));
  let rows = 0, maxSlots = 0;

  const read = (p, pre) => {
    const out = [];
    for (let i = 0; p[pre + 'l' + i] !== undefined; i++) out.push([p[pre + 'l' + i], p[pre + 'c' + i]]);
    return out.filter(([t]) => t !== MARK);
  };
  const clear = (p, pre) => { for (const k of Object.keys(p)) if (new RegExp('^' + pre + '[lc]\\d+$').test(k)) delete p[k]; };
  const merge = (secs) => {
    const out = [];
    for (const [t, c] of secs) {
      if (t === '') continue;
      const last = out[out.length - 1];
      if (last && last[1] === c && last[0] !== MARK && t !== MARK) last[0] += t; else out.push([t, c]);
    }
    return out;
  };
  // [[numbers, colour], …] → sections, '\n' between the groups
  const fromGroups = (groups) => {
    const out = [];
    for (const [nums, color] of groups) {
      if (!nums.length) continue;
      if (out.length) out.push(['\n', BLACK]);
      out.push([nums.join(', '), color]);
    }
    return out;
  };
  const cut = (secs, hot) => {
    const out = [];
    for (const [text, color] of secs) {
      for (const tok of String(text).split(/(, |\n)/)) {
        if (tok === '') continue;
        out.push([tok, color]);
        if (hot.has(tok)) out.push([MARK, BLACK]);
      }
    }
    return merge(out);
  };

  for (const f of labels.features) {
    const p = f.properties;
    if (!p || !p.lines) continue;
    const nums = split(p.lines), bus = split(p.busLines);
    const hot = new Set([
      ...nums.filter((n) => H24.has((p.mode || 'bus') + '|' + n)),
      ...bus.filter((n) => H24.has('bus|' + n)),
    ]);
    if (!hot.size) {
      // a "+" left by an earlier run on a row that no longer carries one
      for (const pre of ['', 'b', 't']) {
        const secs = read(p, pre);
        if (secs.length && p[pre + 'l' + secs.length] !== undefined) { clear(p, pre); merge(secs).forEach(([t, c], i) => { p[pre + 'l' + i] = t; p[pre + 'c' + i] = c; }); }
      }
      continue;
    }
    const railColor = p.color || KMK;
    const busGroups = p.tLines ? [[split(p.tLines), TROLLEY_GREEN], [split(p.ntLines || p.nmLines), KMK]] : [[bus, KMK]];
    const defaults = {
      '': p.busLines ? [[nums, railColor], ...busGroups]
        : p.tLines ? [[split(p.tLines), TROLLEY_GREEN], [split(p.ntLines || p.nmLines), KMK]]
          : [[nums, railColor]],
      b: p.busLines ? busGroups : p.mode === 'bus' ? (p.tLines ? [[split(p.tLines), TROLLEY_GREEN], [split(p.ntLines || p.nmLines), KMK]] : [[nums, railColor]]) : null,
      t: p.mode !== 'bus' ? [[nums, railColor]] : null,
    };
    for (const pre of ['', 'b', 't']) {
      let secs = read(p, pre);
      if (!secs.length) { if (!defaults[pre]) continue; secs = fromGroups(defaults[pre]); }
      const done = cut(merge(secs), hot);
      if (!done.some(([t]) => t === MARK)) continue;   // this view's half of the row carries no 24/7 number
      clear(p, pre);
      done.forEach(([t, c], i) => { p[pre + 'l' + i] = t; p[pre + 'c' + i] = c; });
      maxSlots = Math.max(maxSlots, done.length);
    }
    rows++;
  }
  writeFileSync(file, JSON.stringify(labels), 'utf8');
  log(`24/7 lines (${[...H24].join(', ')}): ${rows} number rows carry the black "+" (${maxSlots} sections at most)`);
  return rows;
}

if (process.argv[1] && /h24\.mjs$/.test(process.argv[1]) && process.argv[2]) {
  const [dir, ...keys] = process.argv.slice(2);
  h24Pass(dir, new Set(keys), { log: (m) => console.log(dir, m) });
}
