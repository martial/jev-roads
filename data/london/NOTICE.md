# London launch dataset

Centre: 51.5136, -0.1365 (Soho). Cached on 22 September 2026 using the application's standard map loaders; approximately 1 km square, plus boundary context. Gzip files contain JSON, not executable code.

Streets and scenery: © OpenStreetMap contributors, available under the Open Database License (ODbL). Attribution and licence: https://www.openstreetmap.org/copyright . The application displays attribution with the reconstructed city.

Terrain: sampled from Mapzen Terrarium elevation tiles hosted by AWS (`https://s3.amazonaws.com/elevation-tiles-prod/terrarium`), using the existing terrain loader. Source attribution: https://github.com/tilezen/joerd/blob/master/docs/attribution.md .

Regenerate from `maps/51.5136_-0.1365/*.json` after refreshing that city's server cache; gzip each JSON with Node's `gzipSync` at level 9. Local cache files override these bundled launch files. No credentials are included.
