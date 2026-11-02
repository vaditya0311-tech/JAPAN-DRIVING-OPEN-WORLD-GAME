#!/usr/bin/env python3
"""Reproduces every measurement in docs/SUPRA_RIG_SPEC.md from the GLB (numpy only, no network).

  python3 tools/inspect_glb.py [path.glb]

Prints: overall bounds, wheel assemblies (hub, radius, width), steering-wheel plane/axis/radius,
and driver-eye ray clearances. Coordinates are the glTF world frame after the file's own node
transforms (+Z forward, +Y up, +X = car LEFT). The game then subtracts (0, -0.0013, +0.1432)
to centre/ground the model (uniform scale 1.00011 is ignored here, it is < 0.02 %).
"""
import sys, os
from pathlib import Path
import json, struct
import numpy as np
def load(path):
    d=open(path,'rb').read()
    magic,ver,length=struct.unpack('<4sII',d[:12]); off=12; js=None; bn=None
    while off<len(d):
        cl,ct=struct.unpack('<II',d[off:off+8]); body=d[off+8:off+8+cl]; off+=8+cl
        if ct==0x4E4F534A: js=json.loads(body)
        elif ct==0x004E4942: bn=body
    return js,bn
def mat_of(n):
    if 'matrix' in n: return np.array(n['matrix'],float).reshape(4,4).T
    t=np.array(n.get('translation',[0,0,0]),float); q=n.get('rotation',[0,0,0,1]); s=np.array(n.get('scale',[1,1,1]),float)
    x,y,z,w=q
    R=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
    M=np.eye(4); M[:3,:3]=R*s; M[:3,3]=t; return M
def accessor(js,bn,i):
    a=js['accessors'][i]; bv=js['bufferViews'][a['bufferView']]
    comp={5120:('b',1),5121:('B',1),5122:('h',2),5123:('H',2),5125:('I',4),5126:('f',4)}[a['componentType']]
    nc={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]
    stride=bv.get('byteStride') or comp[1]*nc
    base=bv.get('byteOffset',0)+a.get('byteOffset',0)
    dt=np.dtype([('v',np.dtype(comp[0]).newbyteorder('<'),(nc,))]) 
    if stride==comp[1]*nc:
        arr=np.frombuffer(bn,dtype=np.dtype(comp[0]).newbyteorder('<'),count=a['count']*nc,offset=base).reshape(a['count'],nc)
    else:
        arr=np.stack([np.frombuffer(bn,dtype=np.dtype(comp[0]).newbyteorder('<'),count=nc,offset=base+k*stride) for k in range(a['count'])])
    return arr

GLB = sys.argv[1] if len(sys.argv) > 1 else str(Path(__file__).resolve().parents[1] / "assets/vehicles/toyota_supra.glb")
js,bn=load(GLB)

nodes=js['nodes']; meshes=js['meshes']
world={}; parent={}
def walk(i,P):
    M=P@mat_of(nodes[i]); world[i]=M
    for c in nodes[i].get('children',[]): parent[c]=i; walk(c,M)
for r in js['scenes'][0]['nodes']: walk(r,np.eye(4))
cache={}
def verts(i):
    n=nodes[i]
    if 'mesh' not in n: return None
    out=[]
    for p in meshes[n['mesh']]['primitives']:
        out.append(accessor(js,bn,p['attributes']['POSITION']))
    V=np.concatenate(out).astype(float)
    return (np.c_[V,np.ones(len(V))]@world[i].T)[:,:3]
def subtree(i):
    r=[i]
    for c in nodes[i].get('children',[]): r+=subtree(c)
    return r
def bounds(i):
    pts=[v for j in subtree(i) for v in [verts(j)] if v is not None]
    if not pts: return None
    P=np.concatenate(pts); return P.min(0),P.max(0),len(P)

def all_tris(skip_nodes=()):
    T=[];owner=[]
    for i in range(len(nodes)):
        if 'mesh' not in nodes[i] or i in skip_nodes: continue
        for p in meshes[nodes[i]['mesh']]['primitives']:
            pos=accessor(js,bn,p['attributes']['POSITION']).astype(float)
            W=(np.c_[pos,np.ones(len(pos))]@world[i].T)[:,:3]
            idx=accessor(js,bn,p['indices']).reshape(-1,3).astype(int)
            T.append(W[idx]); owner+= [i]*len(idx)
    return np.concatenate(T),np.array(owner)
TRI,OWN=all_tris()
def ray(o,d,tmax=5.0,two_sided=True):
    d=np.array(d,float); d/=np.linalg.norm(d)
    v0=TRI[:,0];e1=TRI[:,1]-v0;e2=TRI[:,2]-v0
    pv=np.cross(d,e2); det=(e1*pv).sum(1)
    ok=np.abs(det)>1e-12
    inv=np.where(ok,1/np.where(ok,det,1),0)
    tv=o-v0; u=(tv*pv).sum(1)*inv
    qv=np.cross(tv,e1); v=(qv*d).sum(1)*inv
    t=(e2*qv).sum(1)*inv
    hit=ok&(u>=0)&(v>=0)&(u+v<=1)&(t>1e-4)&(t<tmax)
    if not hit.any(): return None
    k=np.where(hit)[0]; j=k[np.argmin(t[k])]
    return t[j],OWN[j],nodes[OWN[j]]['name']


def main():
    np.set_printoptions(precision=3, suppress=True)
    allv = np.concatenate([verts(i) for i in range(len(nodes)) if verts(i) is not None])
    mn, mx = allv.min(0), allv.max(0)
    print("BOUNDS  size", mx - mn, " game offset (x,y,z):", -(mn[0]+mx[0])/2, -mn[1], -(mn[2]+mx[2])/2)
    print("\nWHEEL ASSEMBLIES (material 'tire')")
    for i, n in enumerate(nodes):
        if 'mesh' in n and 'tire' in meshes[n['mesh']].get('name',''):
            par = parent[i]; b = bounds(par); ctr = (b[0]+b[1])/2; sz = b[1]-b[0]
            print(f"  {nodes[par]['name']:10s} hub {ctr}  radius {(sz[1]+sz[2])/4:.4f}  width {sz[0]:.3f}")
    sw = np.array([0.3745, 0.7935, 0.1395])
    V = verts(142); c = V.mean(0); U, S_, Vt = np.linalg.svd(V - c, full_matrices=False)
    print("\nSTEERING WHEEL RIM (Plane.024): centre", c, " axis", Vt[2], " outer radius %.3f" % np.percentile(np.hypot(*((V-c)@Vt[:2].T).T), 99))
    print("\nDRIVER EYE CLEARANCES at model-space (0.370, 1.020, -0.420):")
    eye = np.array([0.37, 1.02, -0.42])
    for nm, d in [('up',(0,1,0)),('down',(0,-1,0)),('back',(0,0,-1)),('forward',(0,0,1)),('left(+x)',(1,0,0))]:
        r = ray(eye, d); print(f"  {nm:8s}", None if r is None else (round(float(r[0]), 3), r[2]))
    print("\nHOOD surface below (0, 1.6, z):", [(z, round(1.6 - ray(np.array([0,1.6,z]),(0,-1,0))[0], 3)) for z in (0.9, 1.1, 1.3, 1.5)])

if __name__ == '__main__':
    main()
