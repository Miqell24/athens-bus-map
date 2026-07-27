# krakow-bus-map

Interactive web map of Kraków public transport (KMK) in the visual logic of the
official KMK network map: **164 bus lines and 23 tram lines** drawn exactly along
roadways and tracks (own HMM/Viterbi map matching on an OSM graph), line numbers
written parallel to every street they use, labeled stops, true roundabout arcs.

**Live map:** https://miqell24.github.io/krakow-bus-map/

## Features

- GTFS (ZTP Kraków) matched onto the OSM road/tram network — mean error ~0.3 m,
  data gaps in the feed bridged by graph routing, unmapped construction sites drawn
  from the raw trace.
- KMK-style rendering: one stroke per roadway, aggregated line numbers rotated
  parallel to streets, shared bus+tram corridors get a single two-color number
  segment, termini labeled with their lines.
- Panel with bus/tram visibility filters and a clickable line list (click a line to
  see its route with all stops).
- Poster-grade PNG export: the current view re-rendered in tiles at ~+3 zoom levels
  of extra detail (street and stop names become legible as you zoom into the image).
- GTFS shapes.txt quality report (`npm run report` → `data/gtfs-gaps-report.md`).

## Requirements

Node ≥ 18 (no npm dependencies), `curl`, `unzip`, internet on first run.

## Usage

```bash
npm run download   # ZTP GTFS + OSM (Overpass) + MapLibre (cached in data/ and web/vendor/)
npm run build      # extraction + map matching + GeoJSON files into data/out/
npm run serve      # http://localhost:8124
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

Map data © OpenStreetMap contributors · tiles by OpenFreeMap · timetables: GTFS ZTP Kraków.
