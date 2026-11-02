#!/usr/bin/env python3
"""Download a small OpenStreetMap road/building/POI tile for Japan Drive Universe.

The output is intentionally regional. Do not try to load Japan's entire OSM extract into a browser tab.
OpenStreetMap data is licensed under ODbL 1.0; preserve attribution and the license when redistributing it.
"""
from __future__ import annotations
import argparse
import json
import math
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PLACES = {
    "tokyo": {"name": "Tokyo / Shibuya", "lat": 35.6595, "lon": 139.7004, "origin_x": 0.0, "origin_z": 0.0},
    "hakone": {"name": "Hakone / Yumoto", "lat": 35.2325, "lon": 139.1069, "origin_x": -1100.0, "origin_z": 950.0},
    "fuji": {"name": "Fuji foothills", "lat": 35.3606, "lon": 138.7274, "origin_x": -2380.0, "origin_z": 1750.0},
    "kyoto": {"name": "Kyoto / Station", "lat": 34.9858, "lon": 135.7588, "origin_x": 2650.0, "origin_z": -1800.0},
    "osaka": {"name": "Osaka / Umeda", "lat": 34.7055, "lon": 135.4983, "origin_x": 4600.0, "origin_z": -2050.0},
}
OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]


def project_local(lat: float, lon: float, center_lat: float, center_lon: float) -> tuple[float, float]:
    # Local tangent-plane approximation; acceptable for a few kilometres, not a geodesic engine.
    x = (lon - center_lon) * 111_320.0 * math.cos(math.radians(center_lat))
    z = -(lat - center_lat) * 111_320.0
    return x, z


def parse_number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        txt = str(value).strip().lower().replace(",", "")
        digits = "".join(c for c in txt if c.isdigit() or c in ".-")
        return float(digits) if digits not in ("", ".", "-") else None
    except (TypeError, ValueError):
        return None


def fetch_overpass(query: str) -> dict[str, Any]:
    body = urllib.parse.urlencode({"data": query}).encode("utf-8")
    last_error: Exception | None = None
    for endpoint in OVERPASS_ENDPOINTS:
        req = urllib.request.Request(
            endpoint, data=body, method="POST",
            headers={"User-Agent": "JapanDriveUniverse-RegionalBuilder/1.0 (local development tool)",
                     "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"},
        )
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=150) as res:
                    payload = res.read()
                return json.loads(payload.decode("utf-8"))
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                last_error = exc
                time.sleep(2.5 * (attempt + 1))
        time.sleep(2)
    raise RuntimeError(f"Overpass API failed after retries: {last_error}")


def way_coords(geometry: list[dict[str, Any]], lat0: float, lon0: float) -> list[list[float]]:
    coords: list[list[float]] = []
    for n in geometry:
        if "lat" not in n or "lon" not in n:
            continue
        x, z = project_local(float(n["lat"]), float(n["lon"]), lat0, lon0)
        if not coords or math.hypot(x - coords[-1][0], z - coords[-1][1]) > 0.05:
            coords.append([round(x, 2), round(z, 2)])
    if len(coords) > 2 and math.dist(coords[0], coords[-1]) < 0.2:
        coords.pop()
    return coords


def clip_segment_to_square(a: list[float], b: list[float], radius: float, pad: float = 30.0) -> tuple[list[float], list[float]] | None:
    """Liang–Barsky clip of a projected road segment to the region plus a small border pad."""
    lo, hi = -radius - pad, radius + pad
    x0, z0 = a; dx, dz = b[0] - x0, b[1] - z0
    t0, t1 = 0.0, 1.0
    for p, q in ((-dx, x0-lo), (dx, hi-x0), (-dz, z0-lo), (dz, hi-z0)):
        if abs(p) < 1e-12:
            if q < 0: return None
            continue
        t = q / p
        if p < 0:
            if t > t1: return None
            t0 = max(t0, t)
        else:
            if t < t0: return None
            t1 = min(t1, t)
    if t0 > t1: return None
    return ([round(x0 + t0*dx, 2), round(z0 + t0*dz, 2)],
            [round(x0 + t1*dx, 2), round(z0 + t1*dz, 2)])


def clip_polyline_to_square(coords: list[list[float]], radius: float, pad: float = 30.0) -> list[list[list[float]]]:
    """Clip lengthy OSM ways to a regional viewport, returning disjoint line sections."""
    pieces: list[list[list[float]]] = []
    current: list[list[float]] = []
    for a, b in zip(coords, coords[1:]):
        clipped = clip_segment_to_square(a, b, radius, pad)
        if clipped is None:
            if len(current) >= 2: pieces.append(current)
            current = []
            continue
        ca, cb = clipped
        if not current or math.dist(current[-1], ca) > 0.15:
            if len(current) >= 2: pieces.append(current)
            current = [ca, cb]
        elif math.dist(current[-1], cb) > 0.05:
            current.append(cb)
    if len(current) >= 2: pieces.append(current)
    return [piece for piece in pieces if sum(math.dist(a,b) for a,b in zip(piece,piece[1:])) >= 1.0]


def within_square(coords: list[list[float]], radius: float, pad: float = 30.0) -> bool:
    if not coords: return False
    return not (max(p[0] for p in coords) < -radius-pad or min(p[0] for p in coords) > radius+pad
                or max(p[1] for p in coords) < -radius-pad or min(p[1] for p in coords) > radius+pad)


def build(args: argparse.Namespace) -> dict[str, Any]:
    place = PLACES[args.place]
    lat0 = args.center_lat if args.center_lat is not None else place["lat"]
    lon0 = args.center_lon if args.center_lon is not None else place["lon"]
    label = args.name or place["name"]
    r = float(args.radius_m)
    lat_delta = r / 111_320.0
    lon_delta = r / (111_320.0 * math.cos(math.radians(lat0)))
    south, north = lat0 - lat_delta, lat0 + lat_delta
    west, east = lon0 - lon_delta, lon0 + lon_delta
    bbox = f"{south:.7f},{west:.7f},{north:.7f},{east:.7f}"
    highways = "motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|pedestrian|track|road"
    amenities = "fuel|parking|restaurant|cafe|fast_food|convenience|hospital|police|school|place_of_worship|pharmacy|bank|bus_station"
    query = f"""[out:json][timeout:120];
(
 way[\"highway\"~\"^({highways})$\"]({bbox});
 way[\"building\"]({bbox});
 node[\"amenity\"~\"^({amenities})$\"]({bbox});
 node[\"tourism\"~\"^(attraction|viewpoint|museum|hotel|information)$\"]({bbox});
 node[\"historic\"]({bbox});
);
out body geom;"""
    print(f"Requesting OSM data for {label}: {r:.0f} m radius around {lat0:.5f}, {lon0:.5f}")
    raw = fetch_overpass(query)
    roads: list[dict[str, Any]] = []
    buildings: list[dict[str, Any]] = []
    pois: list[dict[str, Any]] = []
    for element in raw.get("elements", []):
        tags = element.get("tags") or {}
        eid = str(element.get("id", ""))
        typ = element.get("type")
        if typ == "way":
            geom = element.get("geometry") or []
            coords = way_coords(geom, lat0, lon0)
            if len(coords) < 2:
                continue
            if "highway" in tags and len(roads) < args.max_roads:
                # A single OSM way can run far beyond the requested bbox; clip it before the browser sees it.
                for part_index, part in enumerate(clip_polyline_to_square(coords, r)):
                    if len(roads) >= args.max_roads: break
                    roads.append({
                        "id": f"{eid}:{part_index}", "sourceWayId": eid,
                        "name": tags.get("name") or tags.get("name:en") or "",
                        "highway": tags.get("highway", "residential"), "oneway": tags.get("oneway", ""),
                        "lanes": parse_number(tags.get("lanes")), "maxspeed": tags.get("maxspeed", ""),
                        "surface": tags.get("surface", ""), "bridge": tags.get("bridge", ""),
                        "tunnel": tags.get("tunnel", ""), "coords": part,
                    })
            if "building" in tags and len(buildings) < args.max_buildings and len(coords) >= 3 and within_square(coords, r):
                # Make the ring explicit for a closed extruded footprint.
                if len(coords) > 2 and coords[0] != coords[-1]:
                    coords.append(coords[0][:])
                lv = parse_number(tags.get("building:levels"))
                ht = parse_number(tags.get("height"))
                if ht is None and lv is not None:
                    ht = lv * 3.2
                if ht is None:
                    kind = tags.get("building", "yes")
                    ht = 8.5 if kind in {"apartments", "commercial", "retail", "office"} else 6.2 if kind in {"house", "residential", "detached", "terrace"} else 7.5
                buildings.append({
                    "id": eid, "name": tags.get("name") or tags.get("name:en") or "",
                    "kind": tags.get("building", "yes"), "building": tags.get("building", "yes"),
                    "levels": lv, "height": round(max(3.0, min(ht, 110.0)), 2), "coords": coords,
                })
            label = tags.get("name") or tags.get("name:en")
            category = tags.get("amenity") or tags.get("tourism") or tags.get("historic") or tags.get("shop")
            if label and category and len(coords) >= 2 and len(pois) < args.max_pois:
                # Named temples, shops, museums and services are often mapped as ways, not nodes.
                if within_square(coords, r):
                    if "building" in tags and len(coords) > 3:
                        ring = coords[:-1] if coords[0] == coords[-1] else coords
                        x = sum(q[0] for q in ring) / len(ring); z = sum(q[1] for q in ring) / len(ring)
                    else:
                        x = sum(q[0] for q in coords) / len(coords); z = sum(q[1] for q in coords) / len(coords)
                    pois.append({"id": eid, "name": label, "category": category, "x": round(x, 2), "z": round(z, 2)})
        elif typ == "node" and (tags.get("name") or tags.get("name:en")):
            if "lat" not in element or "lon" not in element:
                continue
            x, z = project_local(float(element["lat"]), float(element["lon"]), lat0, lon0)
            category = tags.get("amenity") or tags.get("tourism") or tags.get("historic") or tags.get("shop") or "Mapped place"
            pois.append({"id": eid, "name": tags.get("name") or tags.get("name:en"), "category": category, "x": round(x, 2), "z": round(z, 2)})
    # Prefer named destinations and avoid duplicate feature names in crowded station districts.
    unique_pois = []
    seen_names = set()
    for poi in pois:
        key = str(poi.get("name", "")).strip().casefold()
        if key and key not in seen_names:
            unique_pois.append(poi); seen_names.add(key)
        if len(unique_pois) >= args.max_pois: break
    pois = unique_pois
    output = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "attribution": "© OpenStreetMap contributors",
        "license": "Open Database License 1.0 (ODbL)",
        "region": {
            "name": label,
            "placeProfile": args.place,
            "center": {"lat": lat0, "lon": lon0},
            "boundsMeters": {"minX": -r, "maxX": r, "minZ": -r, "maxZ": r},
            "gameOrigin": {
                "x": args.game_origin_x if args.game_origin_x is not None else place["origin_x"],
                "z": args.game_origin_z if args.game_origin_z is not None else place["origin_z"],
            },
            "projection": "local tangent plane; 1 game unit ~= 1 metre; X east, Z south",
            "sourceBBox": {"south": south, "west": west, "north": north, "east": east},
        },
        "roads": roads,
        "buildings": buildings,
        "pois": pois,
        "stats": {"roads": len(roads), "buildings": len(buildings), "pois": len(pois), "osmElementsReturned": len(raw.get("elements", []))},
    }
    return output


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--place", choices=sorted(PLACES), default="tokyo", help="Regional anchor; data is still regional, not nationwide")
    ap.add_argument("--radius-m", type=float, default=1200, help="Half-width/half-height of square region in metres (suggested 600-1400)")
    ap.add_argument("--center-lat", type=float, help="Override profile latitude")
    ap.add_argument("--center-lon", type=float, help="Override profile longitude")
    ap.add_argument("--name", help="Name displayed in the game UI")
    ap.add_argument("--game-origin-x", type=float, help="World X offset; defaults to the profile's map anchor")
    ap.add_argument("--game-origin-z", type=float, help="World Z offset; defaults to the profile's map anchor")
    ap.add_argument("--max-roads", type=int, default=4500)
    ap.add_argument("--max-buildings", type=int, default=2300)
    ap.add_argument("--max-pois", type=int, default=120)
    ap.add_argument("--out", default=None, help="Output JSON path; default: assets/data/regions/{place}.json")
    args = ap.parse_args()
    if args.radius_m < 250 or args.radius_m > 2500:
        ap.error("--radius-m must be between 250 and 2500 for a manageable browser region")
    out = Path(args.out or f"assets/data/regions/{args.place}.json")
    try:
        data = build(args)
        out.parent.mkdir(parents=True, exist_ok=True)
        temp = out.with_suffix(out.suffix + ".tmp")
        temp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        temp.replace(out)
        print(f"Wrote {out} ({out.stat().st_size / 1_000_000:.1f} MB)")
        print(f"Roads: {data['stats']['roads']:,} | Buildings: {data['stats']['buildings']:,} | named places: {data['stats']['pois']:,}")
        print("Attribution required: © OpenStreetMap contributors. ODbL 1.0 applies to the database.")
        return 0
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
