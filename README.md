# athens-bus-map

Interactive web map of Athens public transport (OASA) in the visual logic of a
classic printed network map: **283 bus & trolleybus lines (OSY), metro M1–M3
and tram T6/T7 (STASY) plus the Proastiakos suburban railway A1–A4 (Hellenic
Train)** drawn exactly along roadways, tracks and tunnels (own
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
- **Proastiakos (11.09.2026)** — see the section below.
- KMK-style rendering: one stroke per roadway, aggregated line numbers rotated
  parallel to streets, shared corridors get a single two-color number segment,
  termini labeled with their lines.
- Panel with mode visibility filters and a clickable line list (click a line to
  see its route with all stops).
- Poster-grade PNG export: the current view re-rendered in tiles at ~+3 zoom
  levels of extra detail (street and stop names become legible as you zoom into
  the image).
- GTFS shapes.txt quality report (`npm run report` → `data/gtfs-gaps-report.md`).

## Proastiakos — the suburban railway

Since 11.09.2026 the map carries the four Attica lines of Hellenic Train, under
the designations and in the legend colours of the operator's own network map
(hellenictrain.gr/proastiakes-grammes-athinas):

| line | route | colour | length |
|---|---|---|---|
| **A1** | Πειραιάς – Αθήνα – Αεροδρόμιο (+ Ταύρος – Αεροδρόμιο) | `#3c5494` | 48.2 km |
| **A2** | Άνω Λιόσια – Αεροδρόμιο | `#6e6f73` | 33.4 km |
| **A3** | Αθήνα – Χαλκίδα (+ Αθήνα – Αφίδνες, Οινόη – Χαλκίδα) | `#3bb464` | 82.6 km |
| **A4** | Πειραιάς – Αθήνα – Κιάτο (+ Κιάτο – Ταύρος) | `#f09635` | 121.2 km |

- **Source.** Hellenic Train publishes no GTFS. Transitous collects one
  (`jbb.ghsq.de/gtfs/gr-hellenic-train.gtfs.zip`, refreshed daily): every train
  of the country as its own route (the train number), shapes drawn on OSM.
  `pipeline/proastiakos.mjs` cuts the four lines out of it by the stations each
  train calls at, gives one stop pattern one shape (the feed repeats a shape per
  train), prefixes every id with `P:` and writes `data/gtfs-p/`. Kiato – Aigio,
  the Kalavryta rack railway and the Patras line stay out.
- **One pass with STASY.** The rail mode reads `data/gtfs-t` and `data/gtfs-p`
  together (`gtfsDirs`): M3 shares the suburban tracks from Doukissis Plakentias
  to the airport, and five stations are one place for both operators. Stations
  merge by name *within 450 m* (Ηράκλειο of M1 and of the suburban line are
  1.3 km apart), through an alias table for the names STASY shortens
  (Δ. Πλακεντίας, Κάντζα, Ελ. Βενιζέλος); the merged disc takes the suburban
  railway's full name.
- **Drawing.** A1–A4 are metro-class (full-disc stations, no street numbers)
  but drawn as a narrower, near-opaque ribbon, so the metro's wide translucent
  one stays distinct and A4's orange does not melt into the motorway beside it.
  Where lines of different colours share a track the corridor is split into
  one ribbon per line, side by side (`off`/`n` on the feature, `line-offset` in
  the frontend and in the PDF export); every split run is drawn outward from
  Athens central station, so a line keeps its side from one stretch to the next.
  A station served by lines of different colours wears a neutral dark rim — the
  metro interchanges too, which used to wear the tram red.
- **Crossovers.** The rail graph now keeps `service=crossover` on plain rail at
  the restricted-road cost: A2 and A4 change track on them at the Acharnes rail
  centre and at Agioi Anargyroi, and without them the matched routes broke
  there. Metro and tram tracks still leave them out.
- The rail extract (`athens-rail.json`) reaches Kiato and Chalkida:
  37.82–38.50 N, 22.70–23.98 E.

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

**The series so far:** 29.06.2026 — the OSY feed of 29 June (timetable 25.05–25.08,
the last dataset MobilityDatabase keeps before July: 836 and Χ19 still running,
Χ21 not yet), 8.07.2026 — the OSY feed of 8 July (timetable 6.07–6.10), the
network as first published — and 10.09.2026 — the OSY feed of 6 August,
which data.gov.gr publishes as a `.rar` under the same resource id (the `.zip`
there is the frozen July file; `download.sh` fetches the rar now, 7-Zip or
`unar` unpacks it). Between the two: 242, 250, Ε90 and Χ21 gone, 801, 836, Χ23
and Χ80 new, several lines with extra service patterns (Χ96 EXPRESS, 115 to
Ακαδημία, 740 to ΟΑΚΑ), the network 7 022 → 7 476 km. STASY's feed is unchanged
since 1.07. 509 runs the same route in both feeds (Ζηρίνειο – Άγ. Στέφανος –
Κρυονέρι, 54 stops); 508 was already gone in July. The 10.09 build was
replaced on 11.09.2026 by the same two feeds **plus Proastiakos** (Hellenic
Train, feed of 10.09): the timeline reads 29 Jun · 8 Jul · 11 Sep, and the two
older versions show the network without the suburban railway.

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
OASA/OSY/STASY via data.gov.gr · Hellenic Train (Proastiakos) as collected by
Transitous.
