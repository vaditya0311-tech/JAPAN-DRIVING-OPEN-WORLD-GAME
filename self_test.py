#!/usr/bin/env python3
"""Offline smoke tests for the regional coordinate/data utilities. No network required."""
from __future__ import annotations
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import download_japan_region as osm  # noqa: E402


def check(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    x, z = osm.project_local(35.6595, 139.7004, 35.6595, 139.7004)
    check(abs(x) < 1e-9 and abs(z) < 1e-9, "center should project to local origin")

    segment = osm.clip_segment_to_square([-100, 0], [100, 0], 50, pad=0)
    check(segment is not None, "crossing segment should intersect the square")
    assert segment is not None
    check(segment[0] == [-50.0, 0.0] and segment[1] == [50.0, 0.0], "segment should clip at bounds")
    check(osm.clip_segment_to_square([80, 80], [100, 100], 50, pad=0) is None, "outside segment should be discarded")

    parts = osm.clip_polyline_to_square([[-100, 0], [0, 0], [100, 0]], 50, pad=0)
    check(len(parts) == 1 and len(parts[0]) >= 2, "polyline crossing square should return one section")
    check(parts[0][0][0] == -50 and parts[0][-1][0] == 50, "polyline section should respect bounds")
    check(osm.within_square([[-60, 0], [-55, 2]], 50, pad=0) is False, "nonintersecting bounding box should be rejected")
    check(osm.within_square([[-60, 0], [-40, 2]], 50, pad=0) is True, "intersecting bounding box should be retained")

    html = (ROOT / "index.html").read_text(encoding="utf-8")
    for marker in ("osmBuildScene", "osmCollisionHit", "osmAddRoadMarkings", "osmFindRoute", "loadOpenStreetMapRegion", "worldStatus"):
        check(marker in html, f"expected code integration missing: {marker}")
    check((ROOT / "assets/data/README.md").exists(), "data instructions missing")

    # Validate the exact supplied model is bundled and the app points at that local asset.
    glb_path = ROOT / "assets/vehicles/toyota_supra.glb"
    check(glb_path.exists(), "supplied Toyota Supra GLB not bundled")
    blob = glb_path.read_bytes()
    check(len(blob) >= 20, "GLB is unexpectedly small")
    magic, version, declared_length = struct.unpack_from("<4sII", blob, 0)
    check(magic == b"glTF" and version == 2, "invalid GLB header/version")
    check(declared_length == len(blob), "GLB declared length does not match file bytes")
    json_length, json_type = struct.unpack_from("<II", blob, 12)
    check(json_type == 0x4E4F534A, "GLB first chunk is not JSON")
    gltf = json.loads(blob[20:20 + json_length].decode("utf-8").rstrip("\x00 "))
    check(gltf.get("asset", {}).get("extras", {}).get("title") == "Toyota Supra", "bundled GLB metadata is not Toyota Supra")
    check(len(gltf.get("nodes", [])) == 155, "unexpected Toyota Supra node count")
    check(len(gltf.get("meshes", [])) == 87, "unexpected Toyota Supra mesh count")
    check(len(gltf.get("materials", [])) == 19, "unexpected Toyota Supra source material count")
    check(len(gltf.get("images", [])) == 4 and all("bufferView" in image for image in gltf["images"]), "GLB images are not all embedded")
    check("./assets/vehicles/toyota_supra.glb" in html, "HTML loader does not reference the bundled Toyota Supra GLB")
    check("SupraRig.build(THREE, modelWrapper" in html and 'src="./supra_rig.js"' in html, "Supra rig (supra_rig.js) is not wired into the loader")
    check((ROOT / "supra_rig.js").exists() and (ROOT / "verify_panel.js").exists(), "supra_rig.js / verify_panel.js missing")
    check("Material.032" not in html and "./assets/bmw_m3_competition/scene.gltf" not in html, "obsolete BMW-specific model wiring remains")
    check("function loadToyotaSupraModel()" in html and "loadToyotaSupraModel();" in html, "Toyota-specific model loader not wired")
    check("lengthM: 4.370" in html and "widthM: 1.994" in html and "heightM: 1.256" in html, "measured metre-scale Supra reference dimensions missing")
    check("const scale = SUPRA_SPEC.lengthM / sourceSize.z" in html and "rawModel.scale.setScalar(scale)" in html, "uniform dimensions-based scale missing")
    check("correctedBox.min.y" in html and "rawModel.position.set(-sourceCenter.x * scale, -sourceBox.min.y * scale, -sourceCenter.z * scale)" in html, "vehicle centering/ground normalization check missing")
    check("function vehicleFootprint()" in html and "function vehicleCollisionAt(" in html, "dimension-based collision footprint missing")
    check("const wheelRadius = (P.glbReady" in html, "measured wheel spin radius not used")
    check("P.rig.eyeAnchor" in html and "walkMinRadius" in html, "body-mounted cockpit camera / walkaround camera missing")
    check("P.m.visible = false" in html and "P.modelState = 'loading'" in html, "procedural body should stay hidden while supplied Supra loads")
    check('id="bWalk">SUPRA WALKAROUND<' in html, "walkaround launch label does not identify the Supra")
    check("title=\"Custom Green\"" in html and "title=\"Brooklyn Grey\"" not in html, "BMW-specific paint names remain in customization controls")
    for marker in ("createVehicleReflectionEnvironment", "adaptiveLevel", "dCalls", "dTris", "dP95", "dGeo", "dTex"):
        check(marker in html, f"expected graphics/diagnostics integration missing: {marker}")

    print("PASS: local coordinate projection")
    print("PASS: segment/polyline clipping")
    print("PASS: in-region footprint filtering")
    print("PASS: project HTML integration points")
    print("PASS: bundled Toyota Supra GLB header and embedded image metadata")
    print("PASS: Toyota GLB path, metadata and embedded images")
    print("PASS: Toyota loader, uniform metre-scale normalization and ground-centering markers")
    print("PASS: measured collision footprint, wheel-spin radius and camera framing markers")
    print("PASS: load-state fallback, Supra rig wiring and non-BMW adapter markers")
    print("PASS: reflection/adaptive-graphics/diagnostics integration markers")

    data_file = ROOT / "assets/data/osm_region.json"
    if data_file.exists():
        data = json.loads(data_file.read_text(encoding="utf-8"))
        check(data.get("schemaVersion") == 1, "unsupported OSM schema")
        check(isinstance(data.get("roads"), list) and isinstance(data.get("buildings"), list), "OSM roads/buildings missing")
        print("PASS: bundled OSM JSON schema")
    else:
        print("INFO: no real OSM dataset bundled; generate assets/data/regions/{place}.json with the download utility")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
