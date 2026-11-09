"""Signed-distance-field modelling kit used to sculpt the avatar in code.

Every body part is described as a smooth combination of simple shapes
(ellipsoids, round cones, rounded boxes, tori). The field is sampled on a
voxel grid and turned into a triangle mesh with marching cubes. Blender then
cleans, decimates, colours, rigs and animates the meshes.
"""
import numpy as np
from skimage import measure

F = np.float32


def v(*a):
    return np.array(a, dtype=F)


def norm(a):
    a = np.asarray(a, dtype=F)
    return a / np.linalg.norm(a)


# ---------------------------------------------------------------- operators
def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1.0 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def ssub(a, b, k):
    """a minus b, smooth."""
    return smax(a, -b, k)


# ---------------------------------------------------------------- primitives
def sphere(P, c, r):
    return np.linalg.norm(P - c, axis=1) - r


def ellipsoid(P, c, r, R=None):
    q = P - c
    if R is not None:
        q = q @ R  # columns of R are the local axes
    r = np.asarray(r, dtype=F)
    k0 = np.linalg.norm(q / r, axis=1)
    k1 = np.linalg.norm(q / (r * r), axis=1)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


def round_cone(P, a, b, r1, r2):
    """Capsule whose radius goes from r1 at a to r2 at b (Inigo Quilez)."""
    a = np.asarray(a, F)
    b = np.asarray(b, F)
    ba = b - a
    l2 = float(ba @ ba)
    rr = r1 - r2
    a2 = l2 - rr * rr
    il2 = 1.0 / l2
    pa = P - a
    y = pa @ ba
    z = y - l2
    x = pa * l2 - y[:, None] * ba
    x2 = np.einsum("ij,ij->i", x, x)
    y2 = y * y * l2
    z2 = z * z * l2
    k = np.sign(rr) * rr * rr * x2
    d3 = (np.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1
    d1 = np.sqrt(x2 + z2) * il2 - r2
    d2 = np.sqrt(x2 + y2) * il2 - r1
    out = d3
    out = np.where(np.sign(y) * a2 * y2 < k, d2, out)
    out = np.where(np.sign(z) * a2 * z2 > k, d1, out)
    return out.astype(F)


def chain(P, pts, radii, k=0.0):
    d = None
    for i in range(len(pts) - 1):
        s = round_cone(P, pts[i], pts[i + 1], radii[i], radii[i + 1])
        d = s if d is None else smin(d, s, k)
    return d


def rbox(P, c, half, r, R=None):
    q = P - c
    if R is not None:
        q = q @ R
    q = np.abs(q) - np.asarray(half, F)
    outside = np.linalg.norm(np.maximum(q, 0.0), axis=1)
    inside = np.minimum(np.max(q, axis=1), 0.0)
    return outside + inside - r


def torus(P, c, axis, R_major, r_minor):
    axis = norm(axis)
    q = P - c
    h = q @ axis
    radial = q - h[:, None] * axis
    rl = np.linalg.norm(radial, axis=1)
    return np.sqrt((rl - R_major) ** 2 + h * h) - r_minor


def frame(u, hint):
    """Orthonormal basis (columns) with first axis u."""
    u = norm(u)
    w = np.cross(u, hint)
    w = norm(w)
    vv = np.cross(w, u)
    return np.stack([u, vv, w], axis=1).astype(F)


def rot(axis, deg):
    axis = norm(axis)
    a = np.radians(deg)
    x, y, z = axis
    c, s, C = np.cos(a), np.sin(a), 1 - np.cos(a)
    return np.array(
        [
            [c + x * x * C, x * y * C - z * s, x * z * C + y * s],
            [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
            [z * x * C - y * s, z * y * C + x * s, c + z * z * C],
        ],
        dtype=F,
    )


# ---------------------------------------------------------------- meshing
def mesh_sdf(fn, lo, hi, h, chunk=48):
    """Sample fn on a grid over [lo, hi] with voxel size h and mesh the zero level."""
    lo = np.asarray(lo, F)
    hi = np.asarray(hi, F)
    n = np.ceil((hi - lo) / h).astype(int) + 1
    xs = lo[0] + np.arange(n[0], dtype=F) * h
    ys = lo[1] + np.arange(n[1], dtype=F) * h
    zs = lo[2] + np.arange(n[2], dtype=F) * h
    vol = np.empty((n[0], n[1], n[2]), dtype=F)
    X, Y = np.meshgrid(xs, ys, indexing="ij")
    for z0 in range(0, n[2], chunk):
        zz = zs[z0 : z0 + chunk]
        Xc = np.repeat(X[:, :, None], len(zz), axis=2)
        Yc = np.repeat(Y[:, :, None], len(zz), axis=2)
        Zc = np.broadcast_to(zz[None, None, :], Xc.shape)
        P = np.stack([Xc.ravel(), Yc.ravel(), Zc.ravel()], axis=1).astype(F)
        vol[:, :, z0 : z0 + len(zz)] = fn(P).reshape(len(xs), len(ys), len(zz))
    # make sure the field is closed at the box border
    vol[0, :, :] = vol[-1, :, :] = np.maximum(vol[0, :, :], h)
    vol[:, 0, :] = np.maximum(vol[:, 0, :], h)
    vol[:, -1, :] = np.maximum(vol[:, -1, :], h)
    vol[:, :, 0] = np.maximum(vol[:, :, 0], h)
    vol[:, :, -1] = np.maximum(vol[:, :, -1], h)
    verts, faces, normals, _ = measure.marching_cubes(vol, level=0.0, spacing=(h, h, h))
    verts = verts.astype(F) + lo
    # skimage winding is inward for this sign convention; flip to outward normals
    faces = faces[:, ::-1].copy()
    return verts, faces


def surface_y(fn, x, z, y_out=-0.40, y_in=0.10, iters=40):
    """Front surface (smallest y) of a field at (x, z), by bisection along +y."""
    lo, hi = y_out, y_in
    # march to find first inside sample
    ys = np.linspace(y_out, y_in, 400, dtype=F)
    P = np.stack([np.full_like(ys, x), ys, np.full_like(ys, z)], axis=1)
    d = fn(P)
    idx = np.argmax(d < 0)
    if d[idx] >= 0:
        return None
    lo, hi = ys[max(idx - 1, 0)], ys[idx]
    for _ in range(iters):
        mid = 0.5 * (lo + hi)
        if fn(np.array([[x, mid, z]], F))[0] > 0:
            lo = mid
        else:
            hi = mid
    return float(0.5 * (lo + hi))
