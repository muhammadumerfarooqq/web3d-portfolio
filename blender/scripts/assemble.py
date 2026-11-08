"""Assemble the sculpted parts in Blender 5.2: clean-up, decimation, materials,
skin tones, eyes, studio lights; saves avatar.blend and renders a turnaround.

python assemble.py <parts_dir> <out_dir> [--no-render] [--samples N]
"""
import json
import math
import sys
from pathlib import Path

import bpy
import bmesh
import numpy as np
from mathutils import Vector, Matrix

PARTS = Path(sys.argv[1])
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
RENDER = "--no-render" not in sys.argv
SAMPLES = int(sys.argv[sys.argv.index("--samples") + 1]) if "--samples" in sys.argv else 48
VIEWS = sys.argv[sys.argv.index("--views") + 1].split(",") if "--views" in sys.argv else ["front", "threequarter", "side", "face"]

SK = json.loads((PARTS / "skeleton.json").read_text())
H = np.array([0.0, 0.0, 1.648])


def srgb(c):
    c = np.asarray(c, dtype=float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ scene reset
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
coll = bpy.data.collections.new("Avatar")
scene.collection.children.link(coll)

# ------------------------------------------------------------------ materials
def material(name, base, rough=0.5, metal=0.0, coat=0.0, sheen=0.0, sss=0.0, use_vcol=False, spec=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*srgb(base), 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Coat Weight"].default_value = coat
    bsdf.inputs["Sheen Weight"].default_value = sheen
    bsdf.inputs["Specular IOR Level"].default_value = spec
    if sss > 0:
        bsdf.inputs["Subsurface Weight"].default_value = sss
        bsdf.inputs["Subsurface Radius"].default_value = (1.0, 0.35, 0.2)
        bsdf.inputs["Subsurface Scale"].default_value = 0.004
    if use_vcol:
        ca = nt.nodes.new("ShaderNodeVertexColor")
        ca.layer_name = "Col"
        nt.links.new(ca.outputs["Color"], bsdf.inputs["Base Color"])
    return m


MAT = {
    "skin": material("Skin", (0.84, 0.63, 0.50), rough=0.52, sss=0.12, use_vcol=True, spec=0.45),
    "hair": material("Hair", (0.050, 0.042, 0.038), rough=0.58, use_vcol=True, spec=0.35),
    "brow": material("Brows", (0.06, 0.05, 0.045), rough=0.7),
    "suit": material("Suit_Charcoal", (0.205, 0.207, 0.222), rough=0.78, sheen=0.35),
    "shirt": material("Shirt_Black", (0.060, 0.060, 0.066), rough=0.62, sheen=0.2),
    "tie": material("Tie_Satin", (0.030, 0.030, 0.034), rough=0.26, coat=0.35, spec=0.6),
    "silver": material("Silver", (0.80, 0.81, 0.83), rough=0.22, metal=1.0),
    "steel": material("Steel", (0.70, 0.71, 0.73), rough=0.30, metal=1.0),
    "shoe": material("Shoe_Leather", (0.022, 0.022, 0.024), rough=0.16, coat=0.6),
    "sole": material("Sole", (0.03, 0.028, 0.026), rough=0.8),
    "button": material("Button", (0.035, 0.035, 0.038), rough=0.35),
    "eye": material("Eye", (1, 1, 1), rough=0.06, use_vcol=True, coat=0.8, spec=0.6),
}

# ------------------------------------------------------------------ mesh import
TARGET_TRIS = {
    "head": 11000, "hair": 7500, "eyebrows": 700, "jacket": 8000, "shirt": 2400, "tie": 900,
    "tie_clip": 120, "button": 80, "trousers": 3200, "shoes": 1800, "soles": 700,
    "hand_L": 2600, "hand_R": 2600, "watch": 500,
}
PART_MAT = {
    "head": "skin", "hair": "hair", "eyebrows": "brow", "jacket": "suit", "shirt": "shirt", "tie": "tie",
    "tie_clip": "silver", "button": "button", "trousers": "suit", "shoes": "shoe", "soles": "sole",
    "hand_L": "skin", "hand_R": "skin", "watch": "steel",
}


def mesh_from_arrays(name, verts, faces):
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(verts))
    me.vertices.foreach_set("co", verts.astype(np.float32).ravel())
    me.loops.add(faces.size)
    me.loops.foreach_set("vertex_index", faces.astype(np.int32).ravel())
    me.polygons.add(len(faces))
    me.polygons.foreach_set("loop_start", np.arange(0, faces.size, 3, dtype=np.int32))
    me.update(calc_edges=True)
    me.validate()
    return me


def apply_modifiers(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    new = bpy.data.meshes.new_from_object(ev)
    old = obj.data
    obj.modifiers.clear()
    obj.data = new
    bpy.data.meshes.remove(old)


def import_part(name):
    data = np.load(PARTS / f"{name}.npz")
    me = mesh_from_arrays(name, data["verts"], data["faces"])
    obj = bpy.data.objects.new(name, me)
    coll.objects.link(obj)
    # light smoothing then decimate to the triangle budget
    sm = obj.modifiers.new("smooth", "SMOOTH")
    sm.factor, sm.iterations = 0.5, 2
    tris = len(data["faces"])
    target = TARGET_TRIS.get(name, 2000)
    if tris > target:
        dec = obj.modifiers.new("decimate", "DECIMATE")
        dec.ratio = target / tris
        dec.use_collapse_triangulate = True
    apply_modifiers(obj)
    obj.data.shade_smooth()
    obj.data.materials.append(MAT[PART_MAT[name]])
    return obj


objs = {}
for name in TARGET_TRIS:
    if (PARTS / f"{name}.npz").exists():
        objs[name] = import_part(name)

# ------------------------------------------------------------------ vertex colours
def set_colors(obj, cols):
    me = obj.data
    attr = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    rgba = np.concatenate([cols, np.ones((len(cols), 1))], axis=1).astype(np.float32)
    attr.data.foreach_set("color", rgba.ravel())
    me.color_attributes.active_color = attr


def coords(obj):
    n = len(obj.data.vertices)
    a = np.empty(n * 3, dtype=np.float32)
    obj.data.vertices.foreach_get("co", a)
    return a.reshape(n, 3)


SKIN = srgb((0.84, 0.63, 0.50))
STUBBLE = srgb((0.55, 0.45, 0.40))
LIPS = srgb((0.78, 0.50, 0.46))
WARM = srgb((0.90, 0.62, 0.52))


def skin_colors(P, is_head):
    col = np.tile(SKIN, (len(P), 1))
    if not is_head:
        return col
    q = P - H
    x, y, z = q[:, 0], q[:, 1], q[:, 2]
    ax = np.abs(x)
    # stubble: jaw, chin, upper lip, lower cheeks; not on lips or nose
    m = smoothstep(-0.020, -0.050, z) * smoothstep(0.045, 0.010, y)
    m *= 1 - smoothstep(-0.150, -0.118, z) * 0           # keep chin underside
    m *= 1 - smoothstep(0.050, 0.075, ax) * smoothstep(-0.07, -0.02, z) * 0.6
    neck = smoothstep(-0.135, -0.165, z)                  # fade out down the neck
    m *= 1 - neck * 0.85
    lipsmask = np.exp(-(((x / 0.022) ** 2) + ((z + 0.063) / 0.011) ** 2 + ((y + 0.097) / 0.02) ** 2))
    nose = smoothstep(-0.045, -0.040, z) * smoothstep(0.02, 0.0, ax)
    m = np.clip(m * (1 - lipsmask * 1.6), 0, 1) * (1 - nose)
    # moustache band above the lip gets a bit more
    m = np.maximum(m, 0.9 * np.exp(-(((x / 0.024) ** 2) + ((z + 0.050) / 0.006) ** 2)) * smoothstep(-0.07, -0.09, y))
    rnd = np.random.default_rng(3).uniform(0.75, 1.0, len(P))
    col = col * (1 - (m * 0.45 * rnd)[:, None]) + STUBBLE * (m * 0.45 * rnd)[:, None]
    col = col * (1 - lipsmask[:, None] * 0.75) + LIPS * lipsmask[:, None] * 0.75
    cheeks = np.exp(-(((ax - 0.048) / 0.02) ** 2 + ((z + 0.02) / 0.02) ** 2)) * smoothstep(-0.03, -0.07, y)
    col = col * (1 - cheeks[:, None] * 0.25) + WARM * cheeks[:, None] * 0.25
    # hairline shadow (scalp darkening under the hair edge)
    scalp = smoothstep(0.050, 0.085, z) + smoothstep(0.02, 0.07, y) * smoothstep(-0.02, 0.02, z)
    col = col * (1 - np.clip(scalp, 0, 1)[:, None] * 0.55) + STUBBLE * 0.6 * np.clip(scalp, 0, 1)[:, None] * 0.55
    return col


for n in ("head", "hand_L", "hand_R"):
    if n in objs:
        set_colors(objs[n], skin_colors(coords(objs[n]), n == "head"))

if "hair" in objs:
    P = coords(objs["hair"])
    rnd = np.random.default_rng(5).uniform(0.7, 1.15, len(P))
    base = srgb((0.055, 0.045, 0.042))
    set_colors(objs["hair"], np.clip(base[None, :] * rnd[:, None], 0, 1))

# ------------------------------------------------------------------ eyes
def make_eye(side, c, r):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=32, radius=r)
    me = bpy.data.meshes.new(f"eye_{side}")
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(f"eye_{side}", me)
    coll.objects.link(obj)
    P = coords(obj)
    fwd = np.array([0.0, -1.0, 0.0])
    cosang = (P @ fwd) / r
    ang = np.degrees(np.arccos(np.clip(cosang, -1, 1)))
    sclera, iris, iris_dark, pupil = srgb((0.93, 0.90, 0.86)), srgb((0.24, 0.14, 0.08)), srgb((0.10, 0.06, 0.04)), srgb((0.01, 0.01, 0.01))
    col = np.tile(sclera, (len(P), 1))
    t = np.clip(ang / 30.0, 0, 1)[:, None]
    irisc = iris * (1 - t ** 3) + iris_dark * (t ** 3)
    col = np.where((ang < 30.0)[:, None], irisc, col)
    col = np.where((ang < 13.0)[:, None], pupil, col)
    set_colors(obj, col)
    me.shade_smooth()
    me.materials.append(MAT["eye"])
    obj.location = Vector(c)
    return obj


for s, c in SK["_eyes"].items():
    side = "L" if float(s) > 0 else "R"
    objs[f"eye_{side}"] = make_eye(side, c, SK["_eye_r"])

# ------------------------------------------------------------------ stats
total = 0
for n, o in objs.items():
    t = sum(len(p.vertices) - 2 for p in o.data.polygons)
    total += t
print("triangles total:", total, flush=True)

bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "avatar_model.blend"))

if not RENDER:
    sys.exit(0)

# ------------------------------------------------------------------ studio
world = bpy.data.worlds.new("Studio")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (*srgb((0.040, 0.032, 0.075)), 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0

floor_me = bpy.data.meshes.new("floor")
bm = bmesh.new()
bmesh.ops.create_circle(bm, cap_ends=True, radius=4.0, segments=64)
bm.to_mesh(floor_me)
bm.free()
floor = bpy.data.objects.new("floor", floor_me)
scene.collection.objects.link(floor)
fm = material("Floor", (0.035, 0.032, 0.055), rough=0.8)
floor_me.materials.append(fm)


def area_light(name, loc, target, power, color, size):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy = power
    ld.color = tuple(srgb(color))
    ld.size = size
    lo = bpy.data.objects.new(name, ld)
    scene.collection.objects.link(lo)
    lo.location = Vector(loc)
    d = Vector(target) - Vector(loc)
    lo.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return lo


area_light("key", (-2.0, -3.2, 3.0), (0, 0, 1.3), 330, (1.0, 0.95, 0.90), 2.2)
area_light("fill", (2.6, -2.6, 1.6), (0, 0, 1.2), 90, (0.85, 0.90, 1.0), 2.5)
area_light("rim_magenta", (-2.4, 2.6, 2.4), (0, 0, 1.3), 170, (1.0, 0.50, 0.78), 1.5)
area_light("rim_cyan", (2.4, 2.4, 2.6), (0, 0, 1.4), 220, (0.35, 0.85, 0.95), 1.5)
area_light("top", (0.0, 0.3, 4.2), (0, 0, 1.4), 70, (0.80, 0.70, 1.0), 2.0)

cam_d = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_d)
scene.collection.objects.link(cam)
scene.camera = cam

scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 6
scene.render.film_transparent = False
scene.view_settings.view_transform = "AgX"
try:
    scene.view_settings.look = "AgX - Medium High Contrast"
except Exception:
    pass
scene.render.image_settings.file_format = "PNG"


def shoot(name, angle_deg, target, dist, focal, res):
    a = math.radians(angle_deg)
    t = Vector(target)
    cam.location = t + Vector((math.sin(a) * dist, -math.cos(a) * dist, 0.05))
    cam.rotation_euler = (t - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam_d.lens = focal
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.filepath = str(OUT / f"{name}.png")
    bpy.ops.render.render(write_still=True)
    print("rendered", name, flush=True)


full = (0, 0, 0.93)
if "front" in VIEWS:
    shoot("turn_front", 0, full, 6.0, 70, (640, 1100))
if "threequarter" in VIEWS:
    shoot("turn_34", -35, full, 6.0, 70, (640, 1100))
if "side" in VIEWS:
    shoot("turn_side", -90, full, 6.0, 70, (640, 1100))
if "face" in VIEWS:
    shoot("face_34", -28, (0, -0.02, 1.640), 1.25, 85, (800, 800))
if "facefront" in VIEWS:
    shoot("face_front", 0, (0, -0.02, 1.640), 1.25, 85, (800, 800))
