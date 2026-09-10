# athens-bus-map

Interactive web map of Athens public transport (OASA) in the visual logic of a
classic printed network map: **283 bus & trolleybus lines (OSY) plus metro M1–M3
and tram T6/T7 (STASY)** drawn exactly along roadways, tracks and tunnels (own
HMM/Viterbi map matching on an OSM graph), line numbers written parallel to every
street they use, labeled stops, true roundabout arcs.

**Live map:** https://miqell24.github.io/athens-bus-map/

Sibling of [krakow-bus-map](https://github.com/Miqell24/krakow-bus-map) — same
pipeline, different city and feeds.

## Features

- GTFS (data.gov.gr: `osy_gtfs.zip`, `stasy_gtfs.zip`, updated ~monthly) matched
  onto the OSM road/rail network — bus mean error ~3 m; sparse OSY shapes
  (~100 m point spacing, holes up to 3 km) bridged by graph routing.
- The STASY feed ships **no shapes.txt at all** — metro/tram geometry is
  reconstructed by the HMM from stop sequences alone, routed along OSM tracks and
  tunnels (station platforms become sparse observations).
- KMK-style rendering: one stroke per roadway, aggregated line numbers rotated
  parallel to streets, shared corridors get a single two-color number segment,
  termini labeled with their lines.
- Panel with mode visibility filters and a clickable line list (click a line to
  see its route with all stops).
- Poster-grade PNG export: the current view re-rendered in tiles at ~+3 zoom
  levels of extra detail (street and stop names become legible as you zoom into
  the image).
- GTFS shapes.txt quality report (`npm run report` → `data/gtfs-gaps-report.md`).

## Timeline — the map's versions

The panel's **Map version** row (10.09.2026, the Kraków mechanism of 3.09)
switches between dated versions of the network in place: the camera, the base,
the picked line, the label sizes, the density and the mode filters all stay as
they are — only the data changes. Each version is a build of `data/out/`,
archived by `pipeline/snapshot.mjs` under `data/out/versions/<YYYY-MM-DD>/`
(the corridor view only — the archives carry no `route.geojson`, so the journey
planner works on the current build and says so) and listed in
`data/out/versions.json` with the feeds it came from and its line list; the row
shows the lines added and removed since the previous version. `#v=2026-07-08`
in the URL opens a given version. `npm run build` archives its predecessor
(prebuild) and stamps the new build (postbuild).

**The series so far:** 8.07.2026 — the OSY feed of 8 July (timetable 6.07–6.10),
the network as first published — and 10.09.2026 — the OSY feed of 6 August,
which data.gov.gr publishes as a `.rar` under the same resource id (the `.zip`
there is the frozen July file; `download.sh` fetches the rar now, 7-Zip or
`unar` unpacks it). Between the two: 242, 250, Ε90 and Χ21 gone, 801, 836, Χ23
and Χ80 new, several lines with extra service patterns (Χ96 EXPRESS, 115 to
Ακαδημία, 740 to ΟΑΚΑ), the network 7 022 → 7 476 km. STASY's feed is unchanged
since 1.07. 509 runs the same route in both feeds (Ζηρίνειο – Άγ. Στέφανος –
Κρυονέρι, 54 stops); 508 was already gone in July.

## Requirements

Node ≥ 18 (no npm dependencies), `curl`, `unzip`, internet on first run.

## Usage

```bash
npm run download   # OASA GTFS + OSM (Overpass) + MapLibre (cached in data/ and web/vendor/)
npm run build      # extraction + map matching + GeoJSON files into data/out/
npm run serve      # http://localhost:8125
```

## Structure

- `pipeline/download.sh` — input data download
- `pipeline/build.mjs` — GTFS → OSM graph → HMM/Viterbi → `data/out/*.geojson`
- `pipeline/lib/` — csv (streaming), geo (local projection), graph (graph + Dijkstra), hmm (Viterbi)
- `pipeline/report-gaps.mjs` — GTFS shapes.txt gap report
- `web/` — MapLibre GL frontend (vendored, OpenFreeMap positron tiles)
- `docs/` — static bundle published via GitHub Pages (web + data/out copies)

Full plan and roadmap: [PLAN.md](PLAN.md).

## Data attribution

Map data © OpenStreetMap contributors · tiles by OpenFreeMap · timetables: GTFS
OASA/OSY/STASY via data.gov.gr.
