#!/usr/bin/env python3
"""Static regression checks for Milestone 1.3 world architecture and Supra cluster wiring."""
from pathlib import Path
import hashlib
import json
import re
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
html = (ROOT / "index.html").read_text(encoding="utf-8")
model = ROOT / "assets/vehicles/toyota_supra.glb"
expected_model_sha = "895f91edbb14806935cb82213d07abf461e83de068c3152e8ec1909a6def9cd5"

checks = {
    "procedural Andhra zone": "function isAndhraVillageZone" in html and "Andhra Village Belt" in html,
    "architectural massing replaces building boxes": "function mergeArchitecturalMasses" in html and "mergedGeo=mergeArchitecturalMasses(bl)" in html,
    "stepped and chamfered tower profiles": all(token in html for token in ("setback_tower", "slender_tower", "chamferedFootprint")),
    "instanced facade windows and lighting": all(token in html for token in ("archFrameMat", "archLitGlassMat", "archDarkGlassMat", "archBandMat")),
    "village roads, ground plots and palms": all(token in html for token in ("ruralRoadGeoV", "villagePlots", "villagePalmTrunks", "ruralLane")),
    "city roundabout geometry and collision": all(token in html for token in ("roundaboutRoadGeo", "roundaboutIslandGeo", "function hit(px, pz, r)")),
    "fields do not become collision walls": "if (b.field) continue;" in html,
    "live speed/RPM/gear cluster texture": all(token in html for token in ("function createSupraClusterTexture", "function drawSupraCluster", "P.instrumentDash.texture")),
    "cluster is attached to existing GLB screen material": "largest existing screen-material mesh" in html or "largest existing screen" in html,
    "map destinations for village area": "Andhra Countryside · Gramam" in html and "Village Fields & Palm Road" in html,
}

# The HTML should remain a single-page app with unique identifiers.
ids = re.findall(r'\bid="([^"]+)"', html)
checks["no duplicate HTML IDs"] = len(ids) == len(set(ids))
checks["original Supra asset exists"] = model.exists() and model.stat().st_size == 56_835_680
raw_model = model.read_bytes() if model.exists() else b""
actual_sha = hashlib.sha256(raw_model).hexdigest() if raw_model else "missing"
checks["original Supra asset is byte-identical"] = actual_sha == expected_model_sha
if len(raw_model) >= 20 and raw_model[:4] == b"glTF":
    json_len, json_type = struct.unpack_from("<II", raw_model, 12)
    gltf_json = json.loads(raw_model[20:20 + json_len].decode("utf-8")) if json_type == 0x4E4F534A else {}
else:
    gltf_json = {}
checks["original GLB exposes dashboard screen material"] = any(str(m.get("name", "")).lower() == "screen" for m in gltf_json.get("materials", []))
checks["original GLB contains screen geometry node"] = any("screen" in str(n.get("name", "")).lower() for n in gltf_json.get("nodes", []))

failed = False
for name, ok in checks.items():
    print(("PASS" if ok else "FAIL") + ": " + name)
    failed |= not ok
print(f"Supra asset SHA-256: {actual_sha}")
print(f"{sum(checks.values())}/{len(checks)} static feature checks passed")
sys.exit(1 if failed else 0)
