#!/usr/bin/env bash
# Downloads input data: OASA GTFS feeds (data.gov.gr), OSM network (Overpass), MapLibre GL.
# Everything is cached — re-running only fetches what is missing.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/gtfs data/gtfs-t data/gtfs-p data/osm web/vendor

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

# Since August 2026 data.gov.gr publishes both feeds as .rar (the .zip under the
# same resource id is the frozen July 2026 file — 10.09.2026: OSY zip 8.07,
# rar 6.08). The archive holds one folder (osy_gtfs/, stasy_gtfs/); it is
# flattened into the target directory. Needs 7-Zip (7z) or unar.
unrar_to () {  # <archive> <dir>
  rm -rf "$2.tmp" && mkdir -p "$2.tmp"
  if command -v 7z >/dev/null 2>&1; then 7z x -y -o"$2.tmp" "$1" >/dev/null
  elif [ -x "/c/Program Files/7-Zip/7z.exe" ]; then "/c/Program Files/7-Zip/7z.exe" x -y -o"$2.tmp" "$1" >/dev/null
  elif command -v unar >/dev/null 2>&1; then unar -q -o "$2.tmp" "$1"
  else echo "brak 7z/unar do rozpakowania $1 (brew install sevenzip / apt install p7zip-full)" >&2; exit 1; fi
  rm -rf "$2" && mkdir -p "$2"
  find "$2.tmp" -name 'routes.txt' -exec dirname {} \; | head -1 | while read -r d; do mv "$d"/* "$2"/; done
  rm -rf "$2.tmp"
}

# 1) GTFS — OSY (buses + trolleybuses), published on data.gov.gr
if [ ! -f data/gtfs/routes.txt ]; then
  echo "== osy_gtfs.rar =="
  curl -fL --retry 3 --max-time 600 -o data/osy_gtfs.rar "https://data.gov.gr/dataset/fb049bb1-aea6-4443-95fa-8b941dd6a057/resource/119db488-16ea-4c76-b560-41c472872390/download/osy_gtfs.rar"
  unrar_to data/osy_gtfs.rar data/gtfs
fi

# 1b) GTFS — STASY (metro M1-M3 + tram T6/T7); the feed has NO shapes.txt —
#     the pipeline reconstructs geometry from stop sequences routed on OSM rails.
if [ ! -f data/gtfs-t/routes.txt ]; then
  echo "== stasy_gtfs.rar =="
  curl -fL --retry 3 --max-time 600 -o data/stasy_gtfs.rar "https://data.gov.gr/dataset/4e897a75-975a-4ce7-af65-f32ea01f93b9/resource/5e3858ee-d9ba-48c2-9015-744ea160976d/download/stasy_gtfs.rar"
  unrar_to data/stasy_gtfs.rar data/gtfs-t
fi

# 1c) Proastiakos (Hellenic Train) — the operator publishes no GTFS; Transitous
#     collects one (every train of the country, one route per train number,
#     shapes drawn on OSM). pipeline/proastiakos.mjs cuts the four Attica lines
#     A1–A4 out of it into data/gtfs-p, which the build reads with STASY.
if [ ! -f data/gtfs-p/routes.txt ]; then
  echo "== Hellenic Train (Transitous) =="
  curl -fL --retry 3 --max-time 600 -o data/hellenic-train.zip "https://jbb.ghsq.de/gtfs/gr-hellenic-train.gtfs.zip"
  rm -rf data/hellenic-train && mkdir -p data/hellenic-train
  unzip -q -o data/hellenic-train.zip -d data/hellenic-train
  node pipeline/proastiakos.mjs data/hellenic-train data/gtfs-p
fi

# Overpass down (every public mirror answers 504 for hours at a time — the
# wall Berlin, London, Kraków, Athens and Bucharest all hit): cut the same
# files out of the Geofabrik extract instead. pipeline/pbf-cut.py writes the
# JSON shape Overpass would have returned; needs `pip3 install --user osmium`.
pbf_fallback () {
  echo "== Overpass failed — Geofabrik extract + pipeline/pbf-cut.py ==" >&2
  if [ ! -f data/greece-latest.osm.pbf ]; then
    curl -fL --retry 5 --retry-delay 5 -C - --max-time 3600 -o data/greece-latest.osm.pbf "https://download.geofabrik.de/europe/greece-latest.osm.pbf"
  fi
  python3 pipeline/pbf-cut.py data/greece-latest.osm.pbf road:data/osm/athens.json:37.70,23.31,38.34,24.05 names:data/osm/athens-names.json:37.70,23.31,38.34,24.05 rail:data/osm/athens-rail.json:37.82,22.70,38.50,23.98
}

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
  [ "$ok" = 1 ] || { rm -f data/osm/athens.json; pbf_fallback; }
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
  [ "$ok" = 1 ] || { rm -f data/osm/athens-names.json; pbf_fallback; }
fi

# 2c) OSM — rail network for STASY + Proastiakos (separate graph): metro tunnels
#     (subway), tram tracks and surface rail (parts of M1, the suburban lines).
#     The box reaches Kiato in the west and Chalkida in the north (A4, A3).
if [ ! -f data/osm/athens-rail.json ]; then
  echo "== Overpass (rail) =="
  QT='[out:json][timeout:300];way(37.82,22.70,38.50,23.98)["railway"~"^(subway|tram|light_rail|rail)$"];out geom;'
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
  [ "$ok" = 1 ] || { rm -f data/osm/athens-rail.json; pbf_fallback; }
fi

# 3) MapLibre GL (vendored, no CDN at runtime)
if [ ! -f web/vendor/maplibre-gl.js ]; then
  echo "== MapLibre GL =="
  curl -fL --retry 3 -o web/vendor/maplibre-gl.js  https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.js
  curl -fL --retry 3 -o web/vendor/maplibre-gl.css https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.css
fi

echo "OK — data ready:"
du -sh data/osy_gtfs.zip data/osm/athens.json data/osm/athens-rail.json web/vendor/maplibre-gl.js 2>/dev/null || true
