#!/usr/bin/env python3
"""Build a small GSI elevation grid to drape the regional driving scene.

Requires Pillow: python -m pip install Pillow
Uses GSI's public DEM10B PNG elevation tiles. Read the current GSI tile-use rules before redistributing data.
"""
from __future__ import annotations
import argparse, json, math, sys, time, urllib.error, urllib.request
from datetime import datetime, timezone
from pathlib import Path
from download_japan_region import PLACES

TILE_TEMPLATE = "https://cyberjapandata.gsi.go.jp/xyz/dem10b_png/{z}/{x}/{y}.png"

def lonlat_to_tile(lon: float, lat: float, zoom: int) -> tuple[float,float]:
    n=2**zoom
    x=(lon+180.0)/360.0*n
    lat=max(-85.05112878,min(85.05112878,lat))
    rad=math.radians(lat)
    y=(1.0-math.asinh(math.tan(rad))/math.pi)/2.0*n
    return x,y

def download_tile(zoom: int, x: int, y: int):
    url=TILE_TEMPLATE.format(z=zoom,x=x,y=y)
    req=urllib.request.Request(url,headers={"User-Agent":"JapanDriveUniverse-GSIElevation/1.0"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req,timeout=45) as res:
                payload=res.read()
            from PIL import Image
            import io
            img=Image.open(io.BytesIO(payload)).convert("RGB")
            return img.load()
        except (urllib.error.URLError,TimeoutError,OSError) as exc:
            if attempt==2: raise RuntimeError(f"Could not download/decode GSI tile {zoom}/{x}/{y}: {exc}") from exc
            time.sleep(1.5*(attempt+1))

def main() -> int:
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--place",choices=sorted(PLACES),default="tokyo")
    ap.add_argument("--radius-m",type=float,default=1200)
    ap.add_argument("--center-lat",type=float)
    ap.add_argument("--center-lon",type=float)
    ap.add_argument("--game-origin-x",type=float)
    ap.add_argument("--game-origin-z",type=float)
    ap.add_argument("--zoom",type=int,default=14,help="GSI tile zoom; 14 is a reasonable starting point")
    ap.add_argument("--grid-step-m",type=float,default=20,help="Grid spacing in metres; use 10-30 for regional tiles")
    ap.add_argument("--vertical-scale",type=float,default=0.35,help="Vertical multiplier applied by the game")
    ap.add_argument("--out",default=None,help="Output JSON path; default: assets/data/regions/{place}-elevation.json")
    a=ap.parse_args()
    if not 250<=a.radius_m<=2500: ap.error("--radius-m must be 250-2500")
    if a.grid_step_m<8 or a.grid_step_m>50: ap.error("--grid-step-m must be 8-50")
    try:
        from PIL import Image  # noqa: F401
    except ImportError:
        print("Pillow is required. Install it with: python -m pip install Pillow",file=sys.stderr);return 2
    place=PLACES[a.place];lat0=a.center_lat if a.center_lat is not None else place["lat"];lon0=a.center_lon if a.center_lon is not None else place["lon"]
    radius=a.radius_m;step=a.grid_step_m
    count=round(radius*2/step)+1
    actual_step=radius*2/(count-1)
    print(f"Sampling GSI DEM10B: {a.place}, grid {count}×{count}, approx {actual_step:.1f}m spacing")
    requests=[]
    for j in range(count):
        z=-radius+j*actual_step
        lat=lat0-z/111320.0
        for i in range(count):
            x=-radius+i*actual_step
            lon=lon0+x/(111320.0*math.cos(math.radians(lat0)))
            tx,ty=lonlat_to_tile(lon,lat,a.zoom)
            requests.append((i,j,x,z,lat,lon,int(math.floor(tx)),int(math.floor(ty)),int((tx-math.floor(tx))*256),int((ty-math.floor(ty))*256)))
    tile_xy=sorted({(r[6],r[7]) for r in requests})
    tiles={}
    for n,(tx,ty) in enumerate(tile_xy,1):
        print(f"  tile {n}/{len(tile_xy)}: {a.zoom}/{tx}/{ty}")
        tiles[(tx,ty)]=download_tile(a.zoom,tx,ty)
    heights=[None]*(count*count)
    valid=[]
    for row in requests:
        i,j,x,z,lat,lon,tx,ty,px,py=row
        R,G,B=tiles[(tx,ty)][max(0,min(255,px)),max(0,min(255,py))]
        packed=(R<<16)|(G<<8)|B
        if packed==0x800000:
            h=None
        elif packed<0x800000:
            h=packed*0.01
        else:
            h=(packed-0x1000000)*0.01
        heights[j*count+i]=None if h is None else round(h,2)
        if h is not None:valid.append(h)
    if not valid: raise RuntimeError("The downloaded tiles contained no valid elevation samples for this region")
    base=heights[(count//2)*count+(count//2)]
    if base is None:base=sum(valid)/len(valid)
    heights=[round(v,2) if v is not None else round(base,2) for v in heights]
    output={
        "schemaVersion":1,"generatedAt":datetime.now(timezone.utc).isoformat(),
        "attribution":"Elevation data © Geospatial Information Authority of Japan (GSI)",
        "source":"GSI DEM10B PNG elevation tiles","tileTemplate":TILE_TEMPLATE,"zoom":a.zoom,"verticalScale":a.vertical_scale,
        "region":{"name":place["name"],"placeProfile":a.place,"center":{"lat":lat0,"lon":lon0},
                  "boundsMeters":{"minX":-radius,"maxX":radius,"minZ":-radius,"maxZ":radius},
                  "gameOrigin":{"x":a.game_origin_x if a.game_origin_x is not None else place["origin_x"],"z":a.game_origin_z if a.game_origin_z is not None else place["origin_z"]}},
        "grid":{"width":count,"height":count,"spacingMeters":actual_step,"baseHeight":round(base,2),"heights":heights},
    }
    out=Path(a.out or f"assets/data/regions/{a.place}-elevation.json");out.parent.mkdir(parents=True,exist_ok=True);temp=out.with_suffix(out.suffix+".tmp")
    temp.write_text(json.dumps(output,separators=(",",":")),encoding="utf-8");temp.replace(out)
    print(f"Wrote {out} ({out.stat().st_size/1_000_000:.2f} MB), valid samples {len(valid):,}/{len(heights):,}; base {base:.2f}m")
    print("Attribution: Geospatial Information Authority of Japan (GSI). Review GSI tile-use rules before redistribution.")
    return 0

if __name__=="__main__":
    try: raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}",file=sys.stderr);raise SystemExit(1)
