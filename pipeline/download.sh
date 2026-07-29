#!/usr/bin/env bash
# Downloads input data: OASA GTFS feeds (data.gov.gr), OSM network (Overpass), MapLibre GL.
# Everything is cached — re-running only fetches what is missing.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/gtfs data/gtfs-t data/osm web/vendor

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
       && grep -q '"elements"' data/osm/athens.json; then
      ok=1; break
    fi
  done
  [ "$ok" = 1 ] || { echo "Overpass: all mirrors failed" >&2; exit 1; }
fi

# 2b) OSM — rail network for STASY (separate graph): metro tunnels (subway),
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
       && grep -q '"elements"' data/osm/athens-rail.json; then
      ok=1; break
    fi
  done
  [ "$ok" = 1 ] || { echo "Overpass (rail): all mirrors failed" >&2; exit 1; }
fi

# 3) MapLibre GL (vendored, no CDN at runtime)
if [ ! -f web/vendor/maplibre-gl.js ]; then
  echo "== MapLibre GL =="
  curl -fL --retry 3 -o web/vendor/maplibre-gl.js  https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.js
  curl -fL --retry 3 -o web/vendor/maplibre-gl.css https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.css
fi

echo "OK — data ready:"
du -sh data/osy_gtfs.zip data/osm/athens.json data/osm/athens-rail.json web/vendor/maplibre-gl.js 2>/dev/null || true
