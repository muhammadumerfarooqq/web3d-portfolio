"""The AI twin: Muhammad Umer Farooq as a stylized animated-film character.

Units: metres, Z up, the character faces -Y (Blender front view).
Run: python character.py <out_dir>   -> one .npz mesh per part + skeleton.json
"""
import json
import sys
from pathlib import Path

import numpy as np

from sdf import (F, v, norm, smin, smax, ssub, sphere, ellipsoid, round_cone, chain,
                 rbox, torus, frame, rot, mesh_sdf, surface_y)

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "parts")
OUT.mkdir(parents=True, exist_ok=True)
FAST = "--fast" in sys.argv          # coarser voxels for quick iteration

def vox(h):
    return h * (1.8 if FAST else 1.0)

# ============================================================== skeleton (A-pose)
H = v(0.0, 0.0, 1.648)                     # head centre
ARM_DEG = 50.0                             # arm angle from vertical
J = {
    "hips": v(0, 0.010, 0.960),
    "spine": v(0, 0.010, 1.100),
    "chest": v(0, 0.005, 1.280),
    "neck": v(0, 0.020, 1.455),
    "head": v(0, 0.015, 1.545),
    "head_end": v(0, 0.015, 1.815),
}
for side, s in (("L", 1.0), ("R", -1.0)):
    sh = v(s * 0.198, 0.020, 1.410)
    d = norm(v(s * np.sin(np.radians(ARM_DEG)), -0.06, -np.cos(np.radians(ARM_DEG))))
    el = sh + 0.285 * d
    d2 = norm(d + v(0, -0.10, 0))          # slight forward bend at the elbow
    wr = el + 0.255 * d2
    J[f"clavicle.{side}"] = v(s * 0.030, 0.010, 1.420)
    J[f"upper_arm.{side}"] = sh
    J[f"forearm.{side}"] = el
    J[f"hand.{side}"] = wr
    J[f"hand_end.{side}"] = wr + 0.175 * d2
    J[f"thigh.{side}"] = v(s * 0.092, 0.010, 0.935)
    J[f"shin.{side}"] = v(s * 0.096, -0.002, 0.520)
    J[f"foot.{side}"] = v(s * 0.099, 0.030, 0.088)
    J[f"toe.{side}"] = v(s * 0.102, -0.115, 0.022)
    J[f"toe_end.{side}"] = v(s * 0.104, -0.185, 0.022)
    J[f"_armdir.{side}"] = d
    J[f"_handdir.{side}"] = d2


def hl(p):
    """head-local -> world"""
    return H + np.asarray(p, F)


# ============================================================== head (skin)
EYE_R = 0.0205
EYE_C = {s: hl(v(s * 0.0350, -0.0700, 0.017)) for s in (1, -1)}


def head_core(P):
    q = P - H
    d = ellipsoid(q, v(0, 0.012, 0.035), (0.080, 0.098, 0.100))                    # cranium
    d = smin(d, ellipsoid(q, v(0, -0.020, -0.030), (0.071, 0.082, 0.086)), 0.035)  # face mass
    d = smin(d, ellipsoid(q, v(0, -0.022, -0.080), (0.060, 0.064, 0.042)), 0.030)  # jaw
    d = smin(d, ellipsoid(q, v(0, -0.069, -0.105), (0.026, 0.020, 0.019)), 0.014)  # chin
    for s in (1, -1):
        d = smin(d, ellipsoid(q, v(s * 0.053, 0.018, -0.080), (0.014, 0.022, 0.020)), 0.010)  # jaw angle
        d = smin(d, ellipsoid(q, v(s * 0.049, -0.058, -0.002), (0.025, 0.022, 0.016)), 0.016)  # cheekbone
        d = smin(d, round_cone(q, v(s * 0.054, 0.012, -0.086), v(s * 0.020, -0.062, -0.110), 0.010, 0.012), 0.012)  # jawline
    d = smin(d, round_cone(q, v(-0.054, -0.077, 0.041), v(0.054, -0.077, 0.041), 0.016, 0.016), 0.020)  # brow
    for s in (1, -1):                                                                # eye sockets
        d = ssub(d, ellipsoid(q, v(s * 0.0350, -0.087, 0.016), (0.0262, 0.021, 0.0212)), 0.011)
    # nose: long and straight
    d = smin(d, round_cone(q, v(0, -0.0865, 0.014), v(0, -0.1090, -0.027), 0.0072, 0.0105), 0.010)
    d = smin(d, ellipsoid(q, v(0, -0.1095, -0.032), (0.0118, 0.0112, 0.0108)), 0.008)
    for s in (1, -1):
        d = smin(d, ellipsoid(q, v(s * 0.0130, -0.0970, -0.0365), (0.0098, 0.0088, 0.0086)), 0.008)
        d = ssub(d, sphere(q, v(s * 0.0066, -0.1020, -0.0430), 0.0040), 0.003)        # nostrils
    # lips
    d = smin(d, round_cone(q, v(-0.019, -0.0965, -0.0575), v(0.019, -0.0965, -0.0575), 0.0066, 0.0066), 0.008)
    for s in (1, -1):
        d = smin(d, ellipsoid(q, v(s * 0.0055, -0.0985, -0.0570), (0.0070, 0.0050, 0.0052)), 0.004)  # cupid's bow
    d = smin(d, ellipsoid(q, v(0, -0.0930, -0.0690), (0.0175, 0.0090, 0.0078)), 0.008)
    d = ssub(d, rbox(q, v(0, -0.104, -0.0633), (0.0215, 0.009, 0.0006), 0.0010), 0.0022)  # mouth line
    for s in (1, -1):
        d = ssub(d, sphere(q, v(s * 0.0235, -0.0915, -0.0633), 0.0038), 0.004)        # mouth corners
    # ears
    for s in (1, -1):
        R = rot(v(0, 0, 1), s * -12.0)
        d = smin(d, ellipsoid(q, v(s * 0.0825, 0.010, 0.004), (0.011, 0.020, 0.031), R), 0.008)
        d = ssub(d, ellipsoid(q, v(s * 0.0905, 0.008, 0.004), (0.0055, 0.012, 0.020), R), 0.004)
    # neck
    d = smin(d, round_cone(q, v(0, 0.014, -0.080), v(0, 0.020, -0.225), 0.047, 0.053), 0.022)
    return d


def eyelids(P):
    d = None
    for s in (1, -1):
        c = EYE_C[s]
        shell = np.abs(sphere(P, c, EYE_R + 0.0016)) - 0.0011
        front = (P[:, 1] - (c[1] + 0.004))                     # keep front half
        upper = smax(shell, -(P[:, 2] - (c[2] + 0.0080)), 0.0015)
        lower = smax(shell, (P[:, 2] - (c[2] - 0.0130)), 0.0015)
        lid = smax(np.minimum(upper, lower), front, 0.002)
        d = lid if d is None else np.minimum(d, lid)
    return d


def head(P):
    return smin(head_core(P), eyelids(P), 0.0025)


# ============================================================== hair (spiky, swept up/forward)
def hairline(P):
    """>0 above the hairline (where hair grows)."""
    q = P - H
    x, y, z = q[:, 0], q[:, 1], q[:, 2]
    ax = np.abs(x)
    front = 0.064 - 0.018 * (ax / 0.07) ** 2 + 0.0035 * np.sin(x * 190.0) * (1 - ax / 0.09)           # forehead line with temple recession
    side = -0.006 + 0.0 * ax                            # above the ears
    back = -0.070
    t = np.clip((y + 0.06) / 0.16, 0, 1)                # 0 front .. 1 back
    zfront = front * (1 - t) + back * t
    tz = np.clip((ax - 0.045) / 0.035, 0, 1)            # towards the sides go lower
    zl = zfront * (1 - tz) + np.minimum(zfront, side + 0.03 * (1 - t)) * tz
    return z - zl


rng = np.random.default_rng(21)
SPIKES = []
for i in range(420):
    u = rng.uniform(-1, 1)
    th = rng.uniform(0, 2 * np.pi)
    dirv = v(np.sqrt(1 - u * u) * np.cos(th), np.sqrt(1 - u * u) * np.sin(th), u)
    if dirv[2] < 0.18 or dirv[1] > 0.80:
        continue
    if len(SPIKES) >= 150:
        break
    base = v(0, 0.012, 0.040) + dirv * v(0.083, 0.100, 0.103)
    out = norm(dirv * v(1, 1, 1.3))
    top = np.clip(dirv[2], 0, 1)
    front = np.clip(-dirv[1] + 0.15, 0, 1.15)
    # swept up and forward on top and front, back-and-up on the sides/crown
    flow = v(0.0, -0.85, 0.65) * front + v(0, 0.3, 0.9) * (1 - front)
    sweep = norm(out * 0.55 + norm(flow) * 0.75 + v(rng.normal(0, 0.12), rng.normal(0, 0.10), rng.normal(0, 0.06)))
    length = rng.uniform(0.024, 0.040) * (1.0 + 0.55 * front) * (0.55 if abs(dirv[0]) > 0.78 else 1.0) * (1.0 - 0.35 * top)
    r0 = rng.uniform(0.014, 0.022)
    mid = base + sweep * length * 0.55
    tip = mid + norm(sweep + v(rng.normal(0, 0.18), rng.normal(0, 0.12), -0.10)) * length * 0.50
    SPIKES.append((H + base, H + mid, H + tip, r0))


def hair(P):
    q = P - H
    cap = ellipsoid(q, v(0, 0.013, 0.041), (0.0880, 0.1080, 0.1085))
    cap = smin(cap, ellipsoid(q, v(0, -0.010, 0.086), (0.080, 0.096, 0.056)), 0.03)  # volume on top
    d = cap
    for a, m, t, r0 in SPIKES:
        d = smin(d, chain(P, [a, m, t], [r0, r0 * 0.72, 0.0070]), 0.015)
    d = smax(d, -hairline(P) + 0.0, 0.004)                 # only above the hairline
    for s in (1, -1):                                       # keep ears free
        d = ssub(d, ellipsoid(q, v(s * 0.086, 0.008, 0.000), (0.03, 0.03, 0.034)), 0.006)
    d = ssub(d, ellipsoid(q, v(0, -0.06, -0.03), (0.075, 0.07, 0.085)), 0.01)  # face stays clear
    return d


BROWS = None


def eyebrows(P):
    global BROWS
    if BROWS is None:
        BROWS = {}
        for s in (1, -1):
            pts, rad = [], []
            for x, dz, r in [(0.013, 0.039, 0.0038), (0.027, 0.0435, 0.0045),
                             (0.043, 0.0445, 0.0040), (0.058, 0.0385, 0.0024)]:
                z = H[2] + dz
                y = surface_y(head_core, s * x, z)
                pts.append(v(s * x, y + 0.0022, z))
                rad.append(r)
            BROWS[s] = (pts, rad)
    d = None
    for s in (1, -1):
        pts, rad = BROWS[s]
        c = chain(P, pts, rad, 0.002)
        d = c if d is None else np.minimum(d, c)
    return d


# ============================================================== torso / clothing
def shoulder_line(P, r=0.062):
    return round_cone(P, J["upper_arm.R"], J["upper_arm.L"], r, r)


def torso_shape(P, inset=0.0):
    d = ellipsoid(P, v(0, 0.010, 1.300), (0.168 - inset, 0.104 - inset, 0.175 - inset))
    d = smin(d, ellipsoid(P, v(0, 0.012, 1.110), (0.138 - inset, 0.092 - inset, 0.150 - inset)), 0.07)
    d = smin(d, ellipsoid(P, v(0, 0.014, 0.930), (0.158 - inset, 0.105 - inset, 0.130 - inset)), 0.06)
    d = smin(d, shoulder_line(P, 0.061 - inset), 0.045)
    for s in (1, -1):
        d = smin(d, ellipsoid(P, J[f"upper_arm.{'L' if s > 0 else 'R'}"] + v(-s * 0.010, 0, 0.016),
                              (0.066 - inset, 0.068 - inset, 0.050 - inset)), 0.025)
    return d


def sleeve(P, side, r_scale=1.0):
    sh, el, wr = J[f"upper_arm.{side}"], J[f"forearm.{side}"], J[f"hand.{side}"]
    hd = J[f"_handdir.{side}"]
    cuff = wr - hd * 0.012
    d = chain(P, [sh, el, cuff], [0.063 * r_scale, 0.053 * r_scale, 0.046 * r_scale], 0.02)
    return d


V_BOTTOM = 1.150


def v_opening(P):
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    half = (z - V_BOTTOM) * 0.66 + 0.004
    d = np.maximum(np.abs(x) - half, V_BOTTOM - z)
    d = np.maximum(d, z - 1.62)
    return np.maximum(d, y + 0.030)        # only the front


def jacket(P):
    d = torso_shape(P)
    for side in ("L", "R"):
        d = smin(d, sleeve(P, side), 0.035)
    d = smax(d, 0.772 - P[:, 2], 0.004)                           # hem
    d = ssub(d, round_cone(P, v(0, 0.024, 1.40), v(0, 0.024, 1.70), 0.058, 0.058), 0.008)  # neck hole
    back_collar = np.abs(round_cone(P, v(0, 0.026, 1.43), v(0, 0.026, 1.49), 0.060, 0.056)) - 0.0035
    back_collar = smax(back_collar, np.maximum(1.425 - P[:, 2], P[:, 2] - 1.484), 0.002)
    back_collar = smax(back_collar, -(P[:, 1] + 0.010), 0.01)
    d = smin(d, back_collar, 0.01)
    d = ssub(d, v_opening(P), 0.004)
    # front cutaway below the button (classic open hem)
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    cutaway = np.maximum(np.maximum(np.abs(x) - (1.090 - z) * 0.36, z - 1.090), y + 0.030)
    d = ssub(d, cutaway, 0.006)
    # cuff opening (so the hand appears to come out of the sleeve)
    for side in ("L", "R"):
        wr, hd = J[f"hand.{side}"], J[f"_handdir.{side}"]
        d = ssub(d, round_cone(P, wr - hd * 0.030, wr + hd * 0.05, 0.034, 0.034), 0.004)
    return d


def _lapel_paths():
    out = {}
    for s in (1, -1):
        top = v(s * 0.092, 0.0, 1.455)
        bot = v(s * 0.006, 0.0, V_BOTTOM + 0.006)
        pts = []
        for t in np.linspace(0, 1, 6):
            p = bot + (top - bot) * t
            x_out = p[0] + s * (0.022 + 0.014 * t)
            y = surface_y(torso_shape, float(x_out), float(p[2]))
            pts.append(v(x_out, y - 0.002, p[2]))
        out[s] = pts
    return out


LAPELS = None


def lapels(P):
    global LAPELS
    if LAPELS is None:
        LAPELS = _lapel_paths()
    d = None
    for s in (1, -1):
        for k, off in enumerate((0.0, 0.009, 0.018, 0.027)):
            pts = [p + v(s * off * (0.6 + 0.4 * i / 5), off * 0.15, 0) for i, p in enumerate(LAPELS[s])]
            c = chain(P, pts, [0.0055] * 6, 0.003)
            d = c if d is None else smin(d, c, 0.006)
    return d


def jacket_full(P):
    return smin(jacket(P), lapels(P), 0.006)


def shirt(P):
    d = torso_shape(P, inset=0.010)
    d = smax(d, 1.0 - P[:, 2], 0.01)
    # collar band + points
    band = np.abs(round_cone(P, v(0, 0.028, 1.440), v(0, 0.026, 1.506), 0.0515, 0.0470)) - 0.0026
    band = smax(band, np.maximum(1.447 - P[:, 2], P[:, 2] - 1.503), 0.002)
    d = smin(d, band, 0.004)
    for s in (1, -1):
        for off in np.linspace(0.0, 0.020, 6):
            a = v(s * (0.012 + off * 0.5), -0.047 - off * 0.25, 1.497 - off * 0.35)
            b = v(s * (0.036 + off * 0.9), -0.071 - off * 0.2, 1.447 - off * 0.2)
            d = smin(d, round_cone(P, a, b, 0.0050, 0.0036), 0.005)
    d = ssub(d, round_cone(P, v(0, 0.028, 1.43), v(0, 0.028, 1.60), 0.044, 0.044), 0.004)  # neck hole
    # shirt cuffs peeking from the sleeves
    for side in ("L", "R"):
        wr, hd = J[f"hand.{side}"], J[f"_handdir.{side}"]
        d = np.minimum(d, round_cone(P, wr - hd * 0.030, wr + hd * 0.006, 0.035, 0.034))
        d = ssub(d, round_cone(P, wr - hd * 0.0, wr + hd * 0.05, 0.028, 0.028), 0.003)
    return d


def tie_path():
    pts = []
    for z in np.linspace(1.440, 1.100, 9):
        y = surface_y(lambda P: torso_shape(P, inset=0.010), 0.0, float(z))
        pts.append(v(0, y - 0.0055, z))
    return pts


TIE = tie_path()


def tie(P):
    # knot
    ky = surface_y(lambda P: torso_shape(P, inset=0.010), 0.0, 1.462)
    kq = P.copy()
    kq[:, 1] = (P[:, 1] - (ky - 0.010)) * 1.6 + (ky - 0.010)
    d = round_cone(kq, v(0, ky - 0.010, 1.478), v(0, ky - 0.010, 1.452), 0.0175, 0.0115) / 1.6
    # blade: flattened chain, widening downwards
    widths = np.linspace(0.0135, 0.0300, len(TIE))
    q = P.copy()
    blade = None
    for i in range(len(TIE) - 1):
        a, b = TIE[i], TIE[i + 1]
        # anisotropic: squash y by 4x around the path
        qq = q.copy()
        mid_y = (a[1] + b[1]) / 2
        qq[:, 1] = (q[:, 1] - mid_y) * 5.0 + mid_y
        s = round_cone(qq, a, b, widths[i], widths[i + 1]) / 5.0
        blade = s if blade is None else np.minimum(blade, s)
    # pointed tip
    tip_z = float(TIE[-1][2]) - 0.028
    blade = smax(blade, (tip_z + np.abs(P[:, 0]) * 1.05 - P[:, 2]) * 0.69, 0.0015)   # pointed tip
    return smin(d, blade, 0.004)


def tie_clip(P):
    y = surface_y(lambda P: torso_shape(P, inset=0.010), 0.0, 1.265)
    return rbox(P, v(0, y - 0.0115, 1.265), (0.024, 0.0012, 0.0026), 0.0008)


def button(P):
    y = surface_y(torso_shape, 0.0, 1.135)
    R = frame(v(0, -1, 0), v(0, 0, 1))
    return rbox(P, v(0, y - 0.0015, 1.135), (0.0012, 0.0085, 0.0085), 0.0018, R)


def trousers(P):
    d = ellipsoid(P, v(0, 0.012, 0.935), (0.136, 0.094, 0.110))
    for side in ("L", "R"):
        th, kn, an = J[f"thigh.{side}"], J[f"shin.{side}"], J[f"foot.{side}"]
        d = smin(d, chain(P, [th, kn, an + v(0, -0.005, -0.012)], [0.075, 0.058, 0.051], 0.03), 0.03)
    d = smax(d, 0.062 - P[:, 2], 0.004)                  # hem
    gap = np.maximum(np.abs(P[:, 0]) - 0.012, P[:, 2] - 0.835)   # inseam separation
    d = ssub(d, gap, 0.02)
    return d


def shoes(P):
    d = None
    for side, s in (("L", 1), ("R", -1)):
        x = J[f"foot.{side}"][0]
        e = ellipsoid(P, v(x, 0.040, 0.052), (0.040, 0.050, 0.050))
        e = smin(e, ellipsoid(P, v(x, -0.040, 0.046), (0.046, 0.090, 0.044)), 0.03)
        e = smin(e, ellipsoid(P, v(x + s * 0.002, -0.128, 0.034), (0.041, 0.065, 0.034)), 0.03)
        e = smax(e, 0.004 - P[:, 2], 0.002)                # flat sole
        d = e if d is None else np.minimum(d, e)
    return d


def soles(P):
    d = None
    for side, s in (("L", 1), ("R", -1)):
        x = J[f"foot.{side}"][0]
        e = ellipsoid(P, v(x, -0.045, 0.006), (0.049, 0.150, 0.010))
        e = smax(e, -P[:, 2], 0.001)
        d = e if d is None else np.minimum(d, e)
    return d


# ============================================================== hands
def hand(P, side):
    s = 1.0 if side == "L" else -1.0
    wr, hd = J[f"hand.{side}"], J[f"_handdir.{side}"]
    fwd = v(0, -1, 0)
    Rf = frame(hd, fwd)              # u = along hand, v = forward-ish (thumb side), w = palm normal
    u, fv, w = Rf[:, 0], Rf[:, 1], Rf[:, 2]

    def L(a, b, c):
        return wr + u * a + fv * b + w * c

    palm_c = L(0.048, 0.0, 0.0)
    d = rbox(P, palm_c, (0.044, 0.037, 0.011), 0.011, Rf)
    d = smin(d, round_cone(P, L(-0.02, 0, 0), L(0.012, 0, 0), 0.026, 0.028), 0.015)  # wrist
    curl = s                          # curl towards the palm side (palms down/in)
    fingers = [(0.028, 0.081, 0.0088), (0.0095, 0.090, 0.0090), (-0.0095, 0.086, 0.0086), (-0.028, 0.068, 0.0077)]
    for fo, ln, r in fingers:
        k1 = L(0.094, fo, 0.0)
        k2 = k1 + u * ln * 0.45 + w * curl * 0.004
        k3 = k2 + norm(u + w * curl * 0.45) * ln * 0.32
        k4 = k3 + norm(u + w * curl * 1.1) * ln * 0.23
        d = smin(d, chain(P, [k1, k2, k3, k4], [r, r * 0.95, r * 0.86, r * 0.78], 0.003), 0.006)
    t1 = L(0.020, 0.030, curl * 0.004)
    t2 = t1 + norm(u * 0.7 + fv * 0.6 + w * curl * 0.25) * 0.040
    t3 = t2 + norm(u * 0.9 + fv * 0.15 + w * curl * 0.45) * 0.030
    d = smin(d, chain(P, [t1, t2, t3], [0.0135, 0.0106, 0.0092], 0.004), 0.008)
    return d


def watch(P):
    wr, hd = J["hand.L"], J["_handdir.L"]
    c = wr + hd * 0.004
    band = torus(P, c, hd, 0.0285, 0.0050)
    Rf = frame(hd, v(0, -1, 0))
    outward = Rf[:, 2]
    face = rbox(P, c + outward * 0.029, (0.0045, 0.012, 0.012), 0.003, Rf)
    return smin(band, face, 0.003)


# ============================================================== eyes (UV spheres, built in Blender)
# ============================================================== export
PARTS = {
    # name: (fn, lo, hi, voxel)
    "head": (head, H + v(-0.105, -0.135, -0.250), H + v(0.105, 0.125, 0.150), 0.0016),
    "hair": (hair, H + v(-0.115, -0.150, -0.090), H + v(0.115, 0.135, 0.205), 0.0016),
    "eyebrows": (eyebrows, H + v(-0.07, -0.110, 0.025), H + v(0.07, -0.060, 0.060), 0.0007),
    "jacket": (jacket_full, v(-0.70, -0.20, 0.76), v(0.70, 0.17, 1.52), 0.0040),
    "shirt": (shirt, v(-0.70, -0.20, 0.98), v(0.70, 0.14, 1.52), 0.0035),
    "tie": (tie, v(-0.04, -0.13, 1.08), v(0.04, -0.03, 1.48), 0.0012),
    "tie_clip": (tie_clip, v(-0.035, -0.13, 1.25), v(0.035, -0.04, 1.28), 0.0006),
    "button": (button, v(-0.02, -0.14, 1.11), v(0.02, -0.05, 1.16), 0.0008),
    "trousers": (trousers, v(-0.20, -0.13, 0.04), v(0.20, 0.13, 1.06), 0.0040),
    "shoes": (shoes, v(-0.17, -0.22, -0.005), v(0.17, 0.11, 0.12), 0.0025),
    "soles": (soles, v(-0.17, -0.21, -0.006), v(0.17, 0.12, 0.02), 0.0025),
    "hand_L": (lambda P: hand(P, "L"), None, None, 0.0014),
    "hand_R": (lambda P: hand(P, "R"), None, None, 0.0014),
    "watch": (watch, None, None, 0.0008),
}


def auto_box(name):
    if name.startswith("hand"):
        side = name[-1]
        c = J[f"hand.{side}"] + J[f"_handdir.{side}"] * 0.07
        return c - 0.13, c + 0.13
    if name == "watch":
        c = J["hand.L"]
        return c - 0.06, c + 0.06
    raise KeyError(name)


if __name__ == "__main__":
    only = [a for a in sys.argv[2:] if not a.startswith("--")]
    for name, (fn, lo, hi, h) in PARTS.items():
        if only and name not in only:
            continue
        if lo is None:
            lo, hi = auto_box(name)
        verts, faces = mesh_sdf(fn, lo, hi, vox(h))
        np.savez_compressed(OUT / f"{name}.npz", verts=verts, faces=faces)
        print(f"{name:10s} verts={len(verts):7d} faces={len(faces):7d}", flush=True)
    joints = {k: [float(x) for x in val] for k, val in J.items()}
    joints["_eyes"] = {str(s): [float(x) for x in c] for s, c in EYE_C.items()}
    joints["_eye_r"] = EYE_R
    (OUT / "skeleton.json").write_text(json.dumps(joints, indent=1))
    print("done")
