#!/bin/sh
# Fetch the three places the picker offers, politely, one after another.
cd "$(dirname "$0")/.."
for place in "48.8738 2.2950" "43.5263 5.4454" "43.2860 5.3838"; do
  echo "== $place"
  # shellcheck disable=SC2086
  npx tsx scripts/fetch-map.mts $place
done
