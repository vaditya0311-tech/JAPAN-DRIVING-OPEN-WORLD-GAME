#public url to play the game demo 
https://moonlit-puppy-5e03ab.netlify.app


# Regional map data directory

The browser loads regional files from this folder only when a matching file has been generated:

- `regions/tokyo.json`, `regions/hakone.json`, `regions/fuji.json`, `regions/kyoto.json`, `regions/osaka.json` — roads, building footprints and named destinations.
- `regions/tokyo-elevation.json` (and matching place names) — optional GSI terrain height grid.

Run these commands from the project root:

```bash
python tools/download_japan_region.py --place tokyo --radius-m 550
python -m pip install Pillow
python tools/download_gsi_elevation.py --place tokyo --radius-m 550 --grid-step-m 20
```

The defaults create `assets/data/regions/tokyo.json` and `assets/data/regions/tokyo-elevation.json`. Choose `--place hakone`, `fuji`, `kyoto`, or `osaka` to build those regions instead. Keep the same profile, radius, and custom center in both commands. Elevation is especially recommended for the Hakone/Fuji profiles; without it, Hakone uses the existing approximate heightfield where it overlaps.

After generating files, return to the game's title menu, choose the **REGIONAL MAP TILE**, and click **LOAD SELECTED REGION**. The page reloads so nearby chunks and collision caches are rebuilt. One regional tile is loaded per session; this is not a full-Japan database. Keep the radius modest (about 550–1200 metres to begin) and inspect file size before increasing it.

## OSM schema

`regions/{place}.json` uses `schemaVersion: 1` and contains:

- `region`: name, place profile, center, bounds, local projection and game-world anchor.
- `roads[]`: mapped way IDs, road class/tags and `coords` as local metre coordinates (X east, Z south).
- `buildings[]`: mapped footprint rings and height/floor estimates.
- `pois[]`: named places which can become selectable GPS destinations.
- `attribution` and `license`: source/ODbL metadata.

The importer clips long road ways to the regional bounds plus a small edge pad so the browser does not render a road several kilometres away just because its OSM way intersects the query region.

## Elevation schema

`regions/{place}-elevation.json` uses `schemaVersion: 1`, matching center/bounds, a `grid` size/spacing/base elevation, and a row-major `heights` array. The script uses the GSI DEM10B PNG encoding documented at <https://maps.gsi.go.jp/development/demtile.html>.

## Attribution / use conditions

- OpenStreetMap road/building/place data is © OpenStreetMap contributors under ODbL 1.0: <https://www.openstreetmap.org/copyright>.
- The optional height grid is derived from GSI elevation tiles. Keep source/processing attribution and review the applicable terms at <https://maps.gsi.go.jp/help/use.html> before redistributing processed elevation data.
