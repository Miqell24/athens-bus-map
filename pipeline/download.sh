#!/usr/bin/env bash
# Downloads input data: OASA GTFS feeds (data.gov.gr), OSM network (Overpass), MapLibre GL.
# Everything is cached — re-running only fetches what is missing.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/gtfs data/gtfs-t data/osm web/vendor

# A downloaded extract is only accepted if it PARSES and carries a plausible
# number of elements. `grep -q '"elements"'` — the guard this family used
# everywhere — passes on a truncated response too: Brașov's roads arrived as a
# 65 kB fragment that still contained the string, was taken for complete, and
# silently skipped the city (16.08.2026).
# The minimum differs by extract: a road network runs to tens of thousands of
# ways, a city rail network to a few hundred, so the caller passes its own floor
# rather than sharing one.
# A rejected file is deleted rather than left behind — the `[ ! -f … ]` gates
# below only ask whether the file exists, so a fragment on disk would be taken
# for a finished download on the next run.
ok_json () { # $1=file  $2=minimum element count
  python3 - "$1" "$2" <<'PYEOF' 2>/dev/null
import json, sys
try:
    sys.exit(0 if len(json.load(open(sys.argv[1])).get("elements", [])) >= int(sys.argv[2]) else 1)
except Exception:
    sys.exit(1)
PYEOF
}

# 1) GTFS — OSY (buses + trolleybuses), published on data.gov.gr
if [ ! -f data/gtfs/routes.txt ]; then
  echo "== osy_gtfs.zip =="
  curl -fL --retry 3 --max-time 600 -o data/osy_gtfs.zip "https://data.gov.gr/dataset/fb049bb1-aea6-4443-95fa-8b941dd6a057/resource/119db488-16ea-4c76-b560-41c472872390/download/osy_gtfs.zip"
  unzip -o data/osy_gtfs.zip -d data/gtfs
fi

# 1b) GTFS — STASY (metro M1-M3 + tram T6/T7); the feed has NO shapes.txt —
#     the pipeline reconstructs geometry from stop sequences routed on OSM rails.
if [ ! -f data/gtfs-t/routes.txt ]; then
  echo "== stasy_gtfs.zip =="
  curl -fL --retry 3 --max-time 600 -o data/stasy_gtfs.zip "https://data.gov.gr/dataset/4e897a75-975a-4ce7-af65-f32ea01f93b9/resource/5e3858ee-d9ba-48c2-9015-744ea160976d/download/stasy_gtfs.zip"
  unzip -o data/stasy_gtfs.zip -d data/gtfs-t
fi

# 2) OSM — roadways in the bbox of the whole OSY network (GTFS shapes extent + margin:
#    Elefsina - Rafina - Kapandriti - Varkiza), incl. highway=construction
if [ ! -f data/osm/athens.json ]; then
  echo "== Overpass (roads) =="
  Q='[out:json][timeout:600];way(37.70,23.31,38.34,24.05)["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|busway|construction|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"];out geom;'
  ok=0
  for EP in "https://overpass-api.de/api/interpreter" \
            "https://maps.mail.ru/osm/tools/overpass/api/interpreter" \
            "https://overpass.kumi.systems/api/interpreter"; do
    echo "-- $EP"
    if curl -fsS --max-time 600 -o data/osm/athens.json --data-urlencode "data=$Q" "$EP" \
       && ok_json "data/osm/athens.json" 2000; then
      ok=1; break
    fi
  done
  [ "$ok" = 1 ] || { rm -f data/osm/athens.json; echo "Overpass: all mirrors failed" >&2; exit 1; }
fi

# 2b) OSM — every NAMED feature in the same bbox, tags only. Not geometry: this
#     is the accent dictionary. The GTFS shouts its stop names in capitals, and
#     Greek writes accents only in lowercase, so the feed cannot tell us that
#     ΑΤΤΙΚΗΣ is Αττικής — but OSM spells the same words properly on streets,
#     squares, districts and churches. See pipeline/lib/greek.mjs.
if [ ! -f data/osm/athens-names.json ]; then
  echo "== Overpass (names for the Greek dictionary) =="
  QN='[out:json][timeout:600];nwr(37.70,23.31,38.34,24.05)[name][~"^(amenity|place|tourism|leisure|shop|building|railway|public_transport|natural|waterway|landuse|historic|office|man_made)$"~"."];out tags;'
  ok=0
  for EP in "https://overpass-api.de/api/interpreter" \
            "https://maps.mail.ru/osm/tools/overpass/api/interpreter" \
            "https://overpass.kumi.systems/api/interpreter"; do
    echo "-- $EP"
    if curl -fsS --max-time 600 -o data/osm/athens-names.json --data-urlencode "data=$QN" "$EP" \
       && ok_json "data/osm/athens-names.json" 2000; then
      ok=1; break
    fi
  done
  # not fatal: without it the stop names simply come out unaccented
  [ "$ok" = 1 ] || { rm -f data/osm/athens-names.json; echo "Overpass (names): all mirrors failed — stop names will lose their accents" >&2; }
fi

# 2c) OSM — rail network for STASY (separate graph): metro tunnels (subway),
#     tram tracks and surface rail (parts of M1 and shared corridors).
if [ ! -f data/osm/athens-rail.json ]; then
  echo "== Overpass (rail) =="
  QT='[out:json][timeout:300];way(37.82,23.61,38.11,23.98)["railway"~"^(subway|tram|light_rail|rail)$"];out geom;'
  ok=0
  for EP in "https://maps.mail.ru/osm/tools/overpass/api/interpreter" \
            "https://overpass-api.de/api/interpreter" \
            "https://overpass.kumi.systems/api/interpreter"; do
    echo "-- $EP"
    if curl -fsS --max-time 300 -o data/osm/athens-rail.json --data-urlencode "data=$QT" "$EP" \
       && ok_json "data/osm/athens-rail.json" 40; then
      ok=1; break
    fi
  done
  [ "$ok" = 1 ] || { rm -f data/osm/athens-rail.json; echo "Overpass (rail): all mirrors failed" >&2; exit 1; }
fi

# 3) MapLibre GL (vendored, no CDN at runtime)
if [ ! -f web/vendor/maplibre-gl.js ]; then
  echo "== MapLibre GL =="
  curl -fL --retry 3 -o web/vendor/maplibre-gl.js  https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.js
  curl -fL --retry 3 -o web/vendor/maplibre-gl.css https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.css
fi

echo "OK — data ready:"
du -sh data/osy_gtfs.zip data/osm/athens.json data/osm/athens-rail.json web/vendor/maplibre-gl.js 2>/dev/null || true
