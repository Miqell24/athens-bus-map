// Frontend: MapLibre GL + OpenFreeMap vector tiles (positron) + OASA line layers
// in the visual logic of the official KMK-style network map.
const KMK = '#0059a9';
const KMK_DARK = '#00294f';
const TROLLEY_GREEN = '#149a3f';
// Narrow label face. Arial Narrow itself cannot be used: MapLibre text comes from
// pre-rendered glyph PBFs on a font server, and no server hosts that licensed
// font — Roboto Condensed is the hosted narrow equivalent (with Greek coverage).
const NARROW = 'roboto_condensed_regular';
const NARROW_BOLD = 'roboto_condensed_bold';

let map;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function init() {
  // The OpenFreeMap glyph server only hosts Noto Sans, so the style is fetched
  // and its glyphs endpoint swapped to VersaTiles, which serves BOTH Noto Sans
  // (for the base style) and Roboto Condensed (for our labels). VersaTiles names
  // stacks in snake_case and has no Noto Sans Italic — remap the base style's
  // fonts (italic degrades to regular, cosmetic only).
  const style = await (await fetch('https://tiles.openfreemap.org/styles/positron')).json();
  style.glyphs = 'https://tiles.versatiles.org/assets/glyphs/{fontstack}/{range}.pbf';
  const FONT_MAP = {
    'Noto Sans Regular': 'noto_sans_regular',
    'Noto Sans Bold': 'noto_sans_bold',
    'Noto Sans Italic': 'noto_sans_regular',
  };
  // "Paper map" recolor of the pale positron base — the look of the printed KMK
  // poster: warm tinted districts, green parks, real-blue water, pale-yellow
  // motorways, darker street names, brown-gray railways.
  const BASE_RECOLOR = {
    background: { 'background-color': '#e8e4d8' },
    landuse_residential: { 'fill-color': '#e6d2c2' },
    park: { 'fill-color': '#c4dfa4' },
    landcover_wood: { 'fill-color': '#b3d295' },
    water: { 'fill-color': '#9dc2e0' },
    waterway: { 'line-color': '#9dc2e0' },
    building: { 'fill-color': '#dccdb9', 'fill-outline-color': '#c9b8a2' },
    road_area_pier: { 'fill-color': '#e8e4d8' },
    road_pier: { 'line-color': '#e8e4d8' },
    'aeroway-area': { 'fill-color': '#f0ece0' },
    'aeroway-runway': { 'line-color': '#f0ece0' },
    'aeroway-taxiway': { 'line-color': '#d8d2c2' },
    'aeroway-runway-casing': { 'line-color': '#d8d2c2' },
    highway_path: { 'line-color': '#d9d3c3' },
    highway_minor: { 'line-color': '#fdfcf6' },
    highway_major_casing: { 'line-color': '#c8bfab' },
    highway_major_inner: { 'line-color': '#fffdf6' },
    highway_major_subtle: { 'line-color': 'hsla(38,25%,74%,0.69)' },
    highway_motorway_casing: { 'line-color': '#c2b28e' },
    highway_motorway_inner: { 'line-color': '#f8e9b0' },
    highway_motorway_subtle: { 'line-color': 'hsla(45,45%,70%,0.55)' },
    highway_motorway_bridge_casing: { 'line-color': '#c2b28e' },
    highway_motorway_bridge_inner: { 'line-color': '#f8e9b0' },
    tunnel_motorway_casing: { 'line-color': '#d3cab4' },
    tunnel_motorway_inner: { 'line-color': '#efe8d2' },
    railway: { 'line-color': '#a2968a' },
    railway_dashline: { 'line-color': '#f4efe2' },
    railway_service: { 'line-color': '#a2968a' },
    railway_service_dashline: { 'line-color': '#f4efe2' },
    railway_transit: { 'line-color': '#a2968a' },
    railway_transit_dashline: { 'line-color': '#f4efe2' },
    boundary_3: { 'line-color': '#a89f8e' },
    boundary_2: { 'line-color': '#a89f8e' },
    'highway-name-minor': { 'text-color': '#3c3a34', 'text-halo-color': '#f4efe2' },
    'highway-name-major': { 'text-color': '#3c3a34', 'text-halo-color': '#f4efe2' },
    'highway-name-path': { 'text-color': '#8a8171' },
  };
  for (const l of style.layers) {
    const tf = l.layout && l.layout['text-font'];
    if (Array.isArray(tf)) l.layout['text-font'] = tf.map((f) => FONT_MAP[f] || f);
    const o = BASE_RECOLOR[l.id];
    if (o) l.paint = { ...l.paint, ...o };
  }
  map = new maplibregl.Map({
    container: 'map',
    style,
    center: [23.73, 37.98],
    zoom: 11.5,
    attributionControl: false,
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 120 }), 'bottom-left');
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Timetables: GTFS OASA (data.gov.gr)' }));

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

  // Trams/trolleybuses drawn with the same logic as buses (both tracks at their
  // true OSM positions). Metro is the exception: a WIDE translucent ribbon with
  // no white casing, laid over the street network like on printed transit maps.
  const metroC = ['==', ['get', 'metro'], 1];
  map.addLayer({
    id: 'route-casing', type: 'line', source: 'streets',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.2, 14, 4.6, 17, 9],
      'line-opacity': ['case', metroC, 0, 1],
    },
  }, firstSymbol);
  map.addLayer({
    id: 'route-line', type: 'line', source: 'streets',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': ['coalesce', ['get', 'color'], KMK],
      'line-width': ['interpolate', ['linear'], ['zoom'],
        10, ['case', metroC, 3, 1.1],
        14, ['case', metroC, 7, 2.3],
        17, ['case', metroC, 14, 4.5]],
      'line-opacity': ['case', metroC, 0.4, 1],
    },
  }, firstSymbol);
  // Shared bus+trolleybus roadways: green dashes over the navy stroke, so the
  // alternation reads as "both ride here". Trolleybus-only roadways are simply
  // green via properties.color from the pipeline.
  map.addLayer({
    id: 'route-trolley-dash', type: 'line', source: 'streets',
    filter: ['==', ['get', 'trolley'], 'mix'],
    layout: { 'line-join': 'round', 'line-cap': 'butt' },
    paint: {
      'line-color': TROLLEY_GREEN,
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.1, 14, 2.3, 17, 4.5],
      'line-dasharray': [1.6, 2.2],
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
  const numbersLayout = {
    'text-field': numberField,
    'text-font': [NARROW_BOLD],
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
  };
  const numbersPaint = { 'text-color': ['coalesce', ['get', 'color'], KMK], 'text-halo-color': '#ffffff', 'text-halo-width': 2 };
  // Every label is collision-managed (allow-overlap turned whole districts into
  // digit soup — user report, twice). Numbers still win against stop names
  // because their layers sit ABOVE them in the style: MapLibre places symbols
  // top-most layer first, so numbers claim their spot and names yield. Repeats
  // (extra:1) exist only on very long avenues, emitted sparsely by the pipeline,
  // and rank BELOW the once-per-street anchors.
  const NUM_LAYERS = [
    { id: 'street-numbers-low', minzoom: 11, maxzoom: 13, cond: ['!', ['has', 'extra']] },
    { id: 'street-numbers', minzoom: 13, cond: ['!', ['has', 'extra']] },
    { id: 'street-numbers-extra', minzoom: 13.5, cond: ['has', 'extra'] },
  ];
  for (const d of NUM_LAYERS) {
    const def = {
      id: d.id, type: 'symbol', source: 'labels',
      minzoom: d.minzoom,
      filter: d.cond,
      layout: { ...numbersLayout },
      paint: { ...numbersPaint },
    };
    if (d.maxzoom) def.maxzoom = d.maxzoom;
    map.addLayer(def);
  }

  // Stops as HALF-DISCS: flat edge lying on the line, bulge pointing to the
  // pole's side of the street (angle from the pipeline). Canvas-drawn icon per
  // color pair — regular: white fill + colored rim; terminus: filled + dark rim.
  const PALETTE = [
    [KMK, KMK_DARK], [TROLLEY_GREEN, '#0a5121'],
    ['#009550', '#00512b'], ['#e30613', '#7c060e'], ['#1e9cd7', '#0d567a'],
    ['#7d2b8b', '#45164e'], ['#d6212b', '#7c1116'],
  ];
  const discIcon = (fill, rim, half) => {
    const S = 48;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const x = c.getContext('2d');
    x.beginPath();
    // half: upper semicircle (bulge up at angle 0); full: whole disc (metro)
    x.arc(S / 2, S / 2, 15, half ? Math.PI : 0, 2 * Math.PI);
    if (half) x.closePath();
    x.fillStyle = fill; x.fill();
    x.lineWidth = 5; x.lineJoin = 'round'; x.strokeStyle = rim; x.stroke();
    return x.getImageData(0, 0, S, S);
  };
  // Terminus badge box: translucent rounded rectangle rimmed in the line color;
  // registered as a STRETCHABLE image so icon-text-fit wraps it around any number.
  const badgeBox = (rim) => {
    const W = 26, H = 20, LW = 2.5;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.beginPath();
    x.roundRect(LW / 2 + 0.5, LW / 2 + 0.5, W - LW - 1, H - LW - 1, 5);
    x.fillStyle = 'rgba(255,255,255,0.72)'; x.fill();
    x.lineWidth = LW; x.strokeStyle = rim; x.stroke();
    return x.getImageData(0, 0, W, H);
  };
  const addStopIcons = (m) => {
    for (const [c, cd] of PALETTE) {
      m.addImage('stop-' + c, discIcon('#ffffff', c, true), { pixelRatio: 2 });
      m.addImage('stop-' + c + '-t', discIcon(c, cd, true), { pixelRatio: 2 });
      m.addImage('dot-' + c, discIcon('#ffffff', c, false), { pixelRatio: 2 });
      m.addImage('dot-' + c + '-t', discIcon(c, cd, false), { pixelRatio: 2 });
      m.addImage('badge-' + c, badgeBox(c), {
        pixelRatio: 2,
        stretchX: [[10, 16]], stretchY: [[8, 12]], content: [6, 4, 20, 16],
      });
    }
  };
  addStopIcons(map);
  map.addLayer({
    id: 'stops-dots', type: 'symbol', source: 'stops',
    minzoom: 11,
    layout: {
      // metro stations and TERMINI are ALWAYS full discs; ordinary street stops
      // are half-discs with the bulge on the pole's side of the roadway
      'icon-image': ['concat',
        ['case', ['any', ['==', ['get', 'metro'], 1], ['==', ['get', 'terminus'], 1]], 'dot-', 'stop-'],
        ['coalesce', ['get', 'color'], KMK],
        ['case', ['==', ['get', 'terminus'], 1], '-t', '']],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.34, 14, 0.62, 17, 1.05],
      'icon-rotate': ['get', 'angle'],
      'icon-rotation-alignment': 'map',
      // same MapLibre pitfall as rotated text: pitch-alignment must be explicit
      'icon-pitch-alignment': 'viewport',
      'icon-allow-overlap': true,
    },
  });
  map.addLayer({
    id: 'stops-names', type: 'symbol', source: 'stops',
    minzoom: 13,
    // metro station names live in their own top-priority layer (see below)
    filter: ['all', ['!=', ['get', 'terminus'], 1], ['!=', ['get', 'metro'], 1], ['==', ['get', 'label'], 1]],
    layout: {
      'text-field': ['get', 'name'],
      'text-font': [NARROW],
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
    filter: ['all', ['==', ['get', 'terminus'], 1], ['!=', ['get', 'metro'], 1], ['==', ['get', 'label'], 1]],
    layout: {
      // terminus: name only — the terminating lines render as boxed badges in
      // their own layer (grid under the dot)
      'text-field': ['get', 'name'],
      'text-font': [NARROW_BOLD],
      'text-size': ['interpolate', ['linear'], ['zoom'], 10.5, 11, 17, 14.5],
      'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
      'text-radial-offset': 0.9,
      'text-justify': 'auto',
    },
    paint: { 'text-color': '#000000', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
  });
  // Every metro station is labeled, always: the tunnels run under busy avenues,
  // so in the shared stop-name layer their names lost the collision fight against
  // bus stops and street numbers. Own layer + moveLayer to the very top = first in
  // symbol placement, so these names are never dropped.
  map.addLayer({
    id: 'stops-metro-names', type: 'symbol', source: 'stops',
    minzoom: 11.5,
    filter: ['all', ['==', ['get', 'metro'], 1], ['==', ['get', 'label'], 1]],
    layout: {
      'text-field': ['get', 'name'],
      'text-font': [NARROW_BOLD],
      'text-size': ['interpolate', ['linear'], ['zoom'], 11.5, 10.5, 17, 14],
      'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
      'text-radial-offset': 0.9,
      'text-justify': 'auto',
    },
    paint: { 'text-color': '#000000', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
  });
  // Terminus line badges: one small translucent box per line, laid out as a
  // centered grid below the loop (offsets precomputed by the pipeline). The same
  // badges exist in several ZOOM BANDS — in each band the pipeline fused the grids
  // that would collide at that scale into one complex, so only the band matching
  // the current zoom is drawn.
  map.addSource('badges', { type: 'geojson', data: 'data/badges.geojson' });
  const BADGE_BANDS = meta.badgeBands || [[13, 14], [14, 15], [15, 16.5], [16.5, 22]];
  // legacy data without `band` passes every band filter — the disjoint zoom
  // ranges still draw it exactly once, so a stale badges.geojson degrades to the
  // unfused layout instead of an empty map
  const bandC = (b) => ['any', ['!', ['has', 'band']], ['==', ['get', 'band'], b]];
  const BADGE_LAYERS = BADGE_BANDS.map(([z0, z1], b) => {
    const id = 'stops-terminus-badges-' + b;
    map.addLayer({
      id, type: 'symbol', source: 'badges',
      minzoom: z0, maxzoom: z1,
      filter: bandC(b),
      layout: {
        'text-field': ['get', 'line'],
        'text-font': [NARROW_BOLD],
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 9.5, 17, 12.5],
        'text-offset': ['get', 'off'],
        'icon-image': ['concat', 'badge-', ['coalesce', ['get', 'color'], KMK]],
        'icon-text-fit': 'both',
        'icon-text-fit-padding': [2, 5, 2, 5],
        // a grid must stay complete — a collision-hidden middle badge would read
        // as a data bug, so badges win overlap unconditionally (the pipeline is
        // what keeps separate grids from landing on top of each other)
        'text-allow-overlap': true,
        'icon-allow-overlap': true,
      },
      paint: { 'text-color': ['coalesce', ['get', 'colorDark'], KMK_DARK] },
    });
    return id;
  });
  // line numbers move ABOVE stop symbols — symbol placement runs top-first, so
  // this gives numbers collision priority over stop names. Reversed order: the
  // once-per-street anchors end up on top of the extras, so where both compete
  // for space the main label wins.
  for (const d of [...NUM_LAYERS].reverse()) map.moveLayer(d.id);
  // terminus badges go topmost: being placed first, the street numbers route
  // around the boxes instead of printing across them
  for (const id of BADGE_LAYERS) map.moveLayer(id);
  // and the metro station names top everything — they must never be dropped
  map.moveLayer('stops-metro-names');

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
    map.setFilter('route-trolley-dash', ['all', ['==', ['get', 'trolley'], 'mix'], modeC, selC]);
    map.setFilter('stops-dots', ['all', modeC, selC]);
    // with a line selected, names of ALL its stops (no label clustering)
    const lblC = state.selected ? true : ['==', ['get', 'label'], 1];
    map.setFilter('stops-names', ['all', ['!=', ['get', 'terminus'], 1], ['!=', ['get', 'metro'], 1], modeC, selC, lblC]);
    map.setFilter('stops-terminus-names', ['all', ['==', ['get', 'terminus'], 1], ['!=', ['get', 'metro'], 1], modeC, selC, lblC]);
    map.setFilter('stops-metro-names', ['all', ['==', ['get', 'metro'], 1], modeC, selC, lblC]);
    // with a line selected only ITS badge stays at the loop
    BADGE_LAYERS.forEach((id, b) => {
      map.setFilter(id, ['all', bandC(b), modeC,
        state.selected ? ['==', ['get', 'line'], state.selected] : true]);
    });
    let numC, numField;
    if (state.bus && !state.tram) {
      // trams hidden: shared corridor labels (mode=tram with busLines) must stay,
      // but they show only the bus part
      numC = ['all', ['any', ['==', ['get', 'mode'], 'bus'], ['has', 'busLines']], selC];
      numField = busOnlyNumbers;
    } else {
      numC = ['all', modeC, selC];
      numField = state.tram && !state.bus ? tramOnlyNumbers : numberField;
    }
    for (const d of NUM_LAYERS) {
      map.setFilter(d.id, ['all', d.cond, numC]);
      map.setLayoutProperty(d.id, 'text-field', numField);
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
      // canvas-drawn stop icons are not part of the style — re-register them
      addStopIcons(m2);
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

  // NOT fitBounds(meta.bbox): the OASA network reaches Elefsina, Rafina and Kapandriti, so fitting the data
  // bbox would open on countryside with the city as a blob. Open on the city — the
  // whole network is one zoom out.
  map.jumpTo({ center: [23.727, 37.983], zoom: 11.3 });
}

init().catch((err) => {
  console.error(err);
  document.getElementById('footer').textContent = 'Data loading error: ' + err.message;
});
