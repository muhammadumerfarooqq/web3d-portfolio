"""Byte Island horse: a stylized bay horse sculpted as signed distance fields (same kit as the avatar).
Units: metres, Z up, faces -Y. Run: python horse.py <out_dir> [part ...] [--fast]
"""
import json, sys
from pathlib import Path
import numpy as np
from sdf import F, v, norm, smin, smax, ssub, sphere, ellipsoid, round_cone, chain, rbox, torus, frame, mesh_sdf

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "parts"); OUT.mkdir(parents=True, exist_ok=True)
FAST = "--fast" in sys.argv
def vox(h): return h * (1.8 if FAST else 1.0)

# ------------------------------------------------------------ skeleton (standing square)
J = {
    "root": v(0, 0.05, 0.0),
    "hips": v(0, 0.50, 1.18), "spine": v(0, 0.05, 1.22), "chest": v(0, -0.40, 1.20),
    "neck": v(0, -0.62, 1.34), "neck2": v(0, -0.78, 1.62), "head": v(0, -0.88, 1.86), "head_end": v(0, -1.24, 1.56),
    "tail": v(0, 0.86, 1.30), "tail2": v(0, 0.98, 1.05), "tail3": v(0, 1.04, 0.80), "tail_end": v(0, 1.06, 0.55),
}
for side, s in (("L", 1.0), ("R", -1.0)):
    # front leg: shoulder -> elbow -> knee -> fetlock -> hoof
    J[f"f_upper.{side}"] = v(s * 0.15, -0.50, 1.02); J[f"f_lower.{side}"] = v(s * 0.15, -0.47, 0.78)
    J[f"f_cannon.{side}"] = v(s * 0.145, -0.48, 0.48); J[f"f_hoof.{side}"] = v(s * 0.145, -0.50, 0.15); J[f"f_end.{side}"] = v(s * 0.145, -0.535, 0.0)
    # hind leg: hip -> stifle -> hock -> fetlock -> hoof
    J[f"h_upper.{side}"] = v(s * 0.16, 0.56, 1.06); J[f"h_lower.{side}"] = v(s * 0.17, 0.40, 0.76)
    J[f"h_cannon.{side}"] = v(s * 0.15, 0.68, 0.50); J[f"h_hoof.{side}"] = v(s * 0.15, 0.63, 0.15); J[f"h_end.{side}"] = v(s * 0.15, 0.60, 0.0)
    J[f"ear.{side}"] = v(s * 0.055, -0.86, 1.95); J[f"ear_end.{side}"] = v(s * 0.075, -0.84, 2.07)

def legs(P, front, side):
    p = "f" if front else "h"
    pts = [J[f"{p}_upper.{side}"], J[f"{p}_lower.{side}"], J[f"{p}_cannon.{side}"], J[f"{p}_hoof.{side}"], J[f"{p}_end.{side}"] + v(0, 0, 0.06)]
    radii = [0.125, 0.092, 0.062, 0.056, 0.058] if front else [0.16, 0.10, 0.064, 0.056, 0.058]
    d = chain(P, pts, radii, 0.02)
    if not front:   # gaskin muscle + hock point
        d = smin(d, ellipsoid(P, (J[f"h_lower.{side}"] + J[f"h_cannon.{side}"]) / 2 + v(0, 0.02, 0.02), (0.075, 0.10, 0.15)), 0.04)
        d = smin(d, sphere(P, J[f"h_cannon.{side}"] + v(0, 0.045, 0.02), 0.055), 0.03)
    else:           # forearm muscle + knee
        d = smin(d, ellipsoid(P, (J[f"f_lower.{side}"] + J[f"f_cannon.{side}"]) / 2 + v(0, 0, 0.04), (0.07, 0.075, 0.14)), 0.04)
        d = smin(d, sphere(P, J[f"f_cannon.{side}"], 0.06), 0.025)
    d = smin(d, sphere(P, J[f"{p}_hoof.{side}"], 0.058), 0.02)   # fetlock joint
    return d

def body(P):
    d = ellipsoid(P, v(0, 0.06, 1.13), (0.255, 0.70, 0.30))                    # barrel
    d = smin(d, ellipsoid(P, v(0, -0.42, 1.12), (0.235, 0.27, 0.31)), 0.12)      # chest
    d = smin(d, ellipsoid(P, v(0, 0.52, 1.17), (0.275, 0.34, 0.31)), 0.12)       # hindquarters
    d = smin(d, ellipsoid(P, v(0, -0.38, 1.30), (0.14, 0.22, 0.16)), 0.10)       # withers
    for s in (1, -1):
        d = smin(d, ellipsoid(P, v(s * 0.11, -0.45, 1.05), (0.12, 0.17, 0.22)), 0.08)   # shoulders
        d = smin(d, ellipsoid(P, v(s * 0.14, 0.58, 1.10), (0.13, 0.22, 0.24)), 0.08)    # haunches
    d = smin(d, round_cone(P, J["neck"], J["neck2"], 0.235, 0.150), 0.12)        # neck
    d = smin(d, round_cone(P, J["neck2"], J["head"], 0.150, 0.110), 0.07)
    d = smin(d, ellipsoid(P, v(0, -0.72, 1.62), (0.07, 0.14, 0.20), None), 0.06)  # crest
    # head: skull + cheeks + tapering muzzle
    d = smin(d, ellipsoid(P, v(0, -0.94, 1.80), (0.095, 0.13, 0.115)), 0.05)
    d = smin(d, round_cone(P, v(0, -0.98, 1.76), J["head_end"] + v(0, 0.02, 0.02), 0.090, 0.068), 0.05)
    for s in (1, -1):
        d = smin(d, ellipsoid(P, v(s * 0.05, -0.93, 1.73), (0.06, 0.09, 0.08)), 0.03)       # cheeks
        d = ssub(d, sphere(P, v(s * 0.040, -1.255, 1.575), 0.018), 0.008)                    # nostrils
        d = smin(d, round_cone(P, J[f"ear.{side_name(s)}"], J[f"ear_end.{side_name(s)}"], 0.030, 0.008), 0.012)  # ears
    d = ssub(d, ellipsoid(P, v(0, -1.24, 1.515), (0.05, 0.035, 0.008)), 0.006)                # mouth line
    for front in (True, False):
        for side in ("L", "R"):
            d = smin(d, legs(P, front, side), 0.06)
    d = smax(d, 0.06 - P[:, 2], 0.004)                                                         # hooves are separate
    return d

def side_name(s): return "L" if s > 0 else "R"

def hooves(P):
    d = None
    for p in ("f", "h"):
        for side in ("L", "R"):
            e = J[f"{p}_end.{side}"]
            h = round_cone(P, e + v(0, 0, 0.012), e + v(0, 0.015, 0.085), 0.060, 0.050)
            h = smax(h, -P[:, 2], 0.003)
            d = h if d is None else np.minimum(d, h)
    return d

rng = np.random.default_rng(5)
MANE = []
for i in range(64):                         # along the crest, poll -> withers
    t = i / 63
    a = J["head"] * (1 - t) + v(0, -0.40, 1.36) * t + v(0, 0, 0.11 - 0.05 * t)
    a = a + v(rng.uniform(-0.02, 0.02), rng.uniform(-0.02, 0.02), 0)
    side = 1 if i % 2 else -1
    b = a + v(side * rng.uniform(0.07, 0.13), rng.uniform(0.0, 0.06), -rng.uniform(0.14, 0.26))
    MANE.append((a, b, rng.uniform(0.030, 0.044)))
FORELOCK = [(J["head"] + v(0, -0.05, 0.04), J["head"] + v(rng.uniform(-0.02, 0.02), -0.12, -0.08), 0.03) for _ in range(3)]

def mane(P):
    d = None
    for a, b, r in MANE + FORELOCK:
        c = round_cone(P, a, b, r, 0.006)
        d = c if d is None else smin(d, c, 0.012)
    return d

def tail(P):
    d = chain(P, [J["tail"], J["tail2"], J["tail3"], J["tail_end"]], [0.065, 0.075, 0.07, 0.035], 0.02)
    trng = np.random.default_rng(8)
    for k in range(18):
        a = J["tail2"] + v(trng.uniform(-0.03, 0.03), trng.uniform(-0.02, 0.03), 0)
        b = J["tail_end"] + v(trng.uniform(-0.08, 0.08), trng.uniform(-0.02, 0.10), trng.uniform(-0.15, 0.05))
        d = smin(d, round_cone(P, a, b, 0.03, 0.008), 0.02)
    return d

def eyes(P):
    return np.minimum(sphere(P, v(0.088, -0.985, 1.81), 0.022), sphere(P, v(-0.088, -0.985, 1.81), 0.022))

# ------------------------------------------------------------ tack: saddle, blanket, horn, stirrups, bridle, reins
BACK_Y = (-0.22, 0.30)
def _back_mask(P, y0, y1, zmin):
    m = np.maximum(np.maximum(y0 - P[:, 1], P[:, 1] - y1), zmin - P[:, 2])
    return m

def blanket(P):
    """thin pad that follows the back (offset shell of the body field)"""
    b = body(P)
    shell = np.abs(b - 0.016) - 0.009
    return smax(shell, _back_mask(P, -0.30, 0.36, 1.12), 0.01)

def saddle(P):
    b = body(P)
    seat = smax(np.abs(b - 0.050) - 0.026, _back_mask(P, -0.22, 0.28, 1.24), 0.015)        # tree/seat on top of the pad
    c = v(0, 0.03, 1.50)
    cantle = ellipsoid(P, c + v(0, 0.25, 0.06), (0.15, 0.055, 0.085))
    pommel = ellipsoid(P, c + v(0, -0.21, 0.06), (0.13, 0.06, 0.08))
    horn = round_cone(P, c + v(0, -0.23, 0.10), c + v(0, -0.26, 0.20), 0.024, 0.036)
    d = smin(seat, smin(cantle, pommel, 0.03), 0.03)
    d = smin(d, horn, 0.015)
    for s in (1, -1):                                                                         # fenders down the sides
        f_ = rbox(P, v(s * 0.262, 0.03, 1.15), (0.012, 0.10, 0.17), 0.012)
        d = np.minimum(d, f_)
    return d

def stirrups(P):
    d = None
    for s in (1, -1):
        t = torus(P, v(s * 0.285, 0.03, 0.90), v(1, 0, 0), 0.055, 0.012)
        strap = rbox(P, v(s * 0.280, 0.03, 1.00), (0.008, 0.02, 0.07), 0.004)
        e = np.minimum(t, strap)
        d = e if d is None else np.minimum(d, e)
    return d

def bridle(P):
    d = torus(P, v(0, -1.12, 1.62), norm(v(0, -0.6, 0.3)) * 0 + v(0, 1, 0.55), 0.090, 0.010)      # noseband
    d = np.minimum(d, torus(P, v(0, -0.90, 1.86), v(0, 1, -0.2), 0.105, 0.010))                  # headpiece behind ears
    for s in (1, -1):
        cheek = round_cone(P, v(s * 0.095, -0.90, 1.86), v(s * 0.075, -1.15, 1.58), 0.010, 0.010)
        rein = chain(P, [v(s * 0.075, -1.17, 1.57), v(s * 0.13, -0.95, 1.40), v(s * 0.12, -0.55, 1.45), v(s * 0.05, -0.30, 1.56)], [0.008] * 4)
        d = np.minimum(d, np.minimum(cheek, rein))
    return d

PARTS = {
    "horse": (body, v(-0.40, -1.36, -0.02), v(0.40, 0.95, 2.15), 0.0042),
    "hooves": (hooves, v(-0.24, -0.66, -0.01), v(0.24, 0.72, 0.12), 0.0025),
    "mane": (mane, v(-0.20, -1.10, 1.10), v(0.20, -0.25, 2.05), 0.0030),
    "tail": (tail, v(-0.20, 0.78, 0.30), v(0.20, 1.25, 1.40), 0.0030),
    "eyes": (eyes, v(-0.12, -1.02, 1.78), v(0.12, -0.95, 1.84), 0.0015),
    "saddle": (saddle, v(-0.34, -0.36, 0.95), v(0.34, 0.40, 1.74), 0.0030),
    "blanket": (blanket, v(-0.34, -0.38, 1.05), v(0.34, 0.44, 1.56), 0.0028),
    "stirrups": (stirrups, v(-0.33, -0.08, 0.84), v(0.33, 0.12, 1.21), 0.0020),
    "bridle": (bridle, v(-0.18, -1.24, 1.36), v(0.18, -0.25, 1.98), 0.0020),
}
if __name__ == "__main__":
    only = [a for a in sys.argv[2:] if not a.startswith("--")]
    for name, (fn, lo, hi, h) in PARTS.items():
        if only and name not in only: continue
        verts, faces = mesh_sdf(fn, lo, hi, vox(h))
        np.savez_compressed(OUT / f"{name}.npz", verts=verts, faces=faces)
        print(f"{name:9s} verts={len(verts):7d} faces={len(faces):7d}", flush=True)
    (OUT / "skeleton.json").write_text(json.dumps({k: [float(x) for x in val] for k, val in J.items()}, indent=1))
    print("done")
