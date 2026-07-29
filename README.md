# athens-bus-map

Interactive web map of Athens public transport (OASA) in the visual logic of a
classic printed network map: **283 bus & trolleybus lines (OSY) plus metro M1–M3
and tram T6/T7 (STASY)** drawn exactly along roadways, tracks and tunnels (own
HMM/Viterbi map matching on an OSM graph), line numbers written parallel to every
street they use, labeled stops, true roundabout arcs.

**Live map:** https://miqell24.github.io/krakow-bus-map/

Successor of the Kraków map previously published here — same pipeline, different
city and feeds (the repository keeps its historical name so the published URL
stays stable; the Kraków version lives on in the git history).

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
