# PLAN — Interactive OASA Athens map

Target: an interactive (zoom/pan) web map of Athens public transport in the visual
logic of a printed network map: lines drawn **exactly along roadways and tracks**,
line numbers written along every street they use, stops labeled, correct roundabout
arcs and intersection turns. Port of the krakow-bus-map pipeline to Athens data.

## Architecture

- **Plain JavaScript**: pipeline in Node ≥ 18 (no npm dependencies), frontend in the browser.
- **Input data**: OASA GTFS from data.gov.gr — `osy_gtfs.zip` (buses + trolleybuses)
  and `stasy_gtfs.zip` (metro M1–M3, tram T6/T7) — plus the OSM road and rail
  network via the Overpass API (bbox of all Attica served by OSY).
- **Map matching**: own HMM/Viterbi implementation (Newson–Krumm 2009) on a directed
  graph — the heart of the project.
- **Frontend**: MapLibre GL JS (vendored) + OSM vector tiles from OpenFreeMap
  (`positron` style). Static server on port **8125**.

## Athens-specific data quirks (vs Kraków)

1. **OSY shapes are sparse**: ~100 m between points (Kraków: ~20 m), with real holes
   up to 3 km. `GAP_MIN` raised to 250 m; longer jumps are treated as data gaps and
   bridged by graph routing.
2. **STASY has no shapes.txt**: the stop sequence of the representative trip becomes
   the HMM observation list. Pseudo-shape matching uses one wide candidate radius
   (150 m), `sigma` 20, `beta` 64, `maxCand` 24 and `perWay` 2 — see below.
3. **Candidate diversity (`perWay`)**: at interchange stations the dense trackage of
   one line (many short station segments) can fill the whole candidate list before a
   parallel line's tunnel appears (M1 vs M3 at Monastiraki). Candidates are capped
   per OSM way instead of enlarging the list.
4. **Radii array is a fallback, not a union**: `[60, 150]` never casts the wide net
   when the narrow one catches anything — pseudo-shapes must use a single `[150]`.
5. **Rail graph** built from `railway=subway|tram|light_rail|rail` (metro tunnels
   included; suburban rail is harmless extra — Viterbi keeps each line on its own
   connected network). Depot tracks (`service=yard|siding|spur|crossover`) excluded.
6. **Feed hygiene**: stray whitespace in `route_short_name` ("14 ") and double
   spaces in stop names are normalized on read.

## Pipeline stages

1. `pipeline/download.sh` — GTFS zips, Overpass roads (bbox 37.70–38.34, 23.31–24.05),
   Overpass rails (bbox 37.82–38.11, 23.61–23.98), MapLibre vendored.
2. `build.mjs` — routes → representative shape per line+direction (most trips);
   stop sequences from streamed `stop_times.txt`.
3. Directed graph from OSM (`lib/graph.mjs`): oneway/roundabout rules, bus-gate
   access, penalty-weighted contraflow; rail mode for STASY.
4. HMM/Viterbi (`lib/hmm.mjs`): emission σ, transition |route − straight|/β via
   capped Dijkstra; controlled breaks bridged by routing; raw-trace fallback when
   OSM lacks the road.
5. Data products (`data/out/`): `streets.geojson` (merged strokes per roadway),
   `labels.geojson` (one rotated number label per street × line set),
   `stops.geojson` (snapped, termini flagged), `route.geojson`, `meta.json`.
6. Frontend (`web/`): KMK-style strokes (bus navy, metro/tram red), rotated number
   labels beside streets, two-color shared-corridor segments, black stop names,
   mode filters + clickable line list, poster PNG export (tiled hidden-map render).

## Current state

- 283 bus/trolleybus lines + M1, M2, M3, T6, T7 — full network matched.
- Bus mean error ~3 m; 17 Viterbi breaks total (~1.1 km drawn from raw GTFS, mostly
  depot loop stubs); STASY: zero breaks, all five lines routed fully along OSM rails.
- Verified in browser: rendering, filters, line selection, PNG export (5826×6561,
  4 tiles), no console errors.

## Roadmap

1. ~~Per-line metro colors~~ done: M1 green `#009550`, M2 red `#e30613`, M3 azure
   `#1e9cd7` (official blue would blend with the navy bus strokes), tram T6/T7
   purple `#7d2b8b`; strokes, stops, termini, number labels, shared-corridor
   segments and panel chips are all per-line colored.
2. KMK-style corridors: merging twin carriageways into one stroke — deferred
   ("corridor axes" preprocessing).
3. Route variants + one-way arrows; line/stop search; GTFS-RT (live positions).
4. ~~Hosting~~ done: GitHub Pages from `main:/docs` at
   https://miqell24.github.io/athens-bus-map/.
