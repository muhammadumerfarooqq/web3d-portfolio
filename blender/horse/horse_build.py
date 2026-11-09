"""Assemble, colour, rig and animate the horse; save horse.blend and export horse.glb (Draco).
python horse_build.py <parts_dir> <out_dir> [--render]
Clips (in place, 30 fps): Idle, Walk, Trot, Gallop, HeadShake.
"""
import json, math, sys
from pathlib import Path
import bpy, numpy as np
from mathutils import Vector, Quaternion

PARTS, OUT = Path(sys.argv[1]), Path(sys.argv[2]); OUT.mkdir(parents=True, exist_ok=True)
RENDER = "--render" in sys.argv
SK = json.loads((PARTS / "skeleton.json").read_text()); J = {k: Vector(v) for k, v in SK.items()}
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene; sc.render.fps = 30
coll = bpy.data.collections.new("Horse"); sc.collection.children.link(coll)

def srgb(c): return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)
def material(name, col, rough=0.5, metal=0.0, sheen=0.0, coat=0.0, vcol=False, spec=0.5):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*srgb(col), 1); b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal; b.inputs["Sheen Weight"].default_value = sheen
    b.inputs["Coat Weight"].default_value = coat; b.inputs["Specular IOR Level"].default_value = spec
    if vcol:
        a = m.node_tree.nodes.new("ShaderNodeVertexColor"); a.layer_name = "Col"
        m.node_tree.links.new(a.outputs["Color"], b.inputs["Base Color"])
    return m
MAT = {"coat": material("Horse_Coat", (0.4, 0.2, 0.1), 0.68, sheen=0.8, vcol=True, spec=0.25),
       "hair": material("Horse_Hair", (0.028, 0.022, 0.018), 0.55, sheen=0.5),
       "hoof": material("Horse_Hoof", (0.035, 0.03, 0.028), 0.38, coat=0.3),
       "eye": material("Horse_Eye", (0.01, 0.008, 0.006), 0.05, coat=1.0, spec=0.8),
       "saddle": material("Saddle_Leather", (0.26, 0.12, 0.05), 0.48, coat=0.25),
       "blanket": material("Saddle_Blanket", (0.5, 0.1, 0.06), 0.9, sheen=0.6, vcol=True),
       "steel": material("Stirrup_Steel", (0.62, 0.62, 0.64), 0.3, metal=1.0),
       "bridle": material("Bridle_Leather", (0.09, 0.045, 0.02), 0.5)}
TRIS = {"horse": 9000, "mane": 2600, "tail": 2200, "saddle": 2600, "blanket": 1400, "stirrups": 400, "bridle": 1300, "hooves": 600, "eyes": 240}
PMAT = {"horse": "coat", "mane": "hair", "tail": "hair", "saddle": "saddle", "blanket": "blanket", "stirrups": "steel", "bridle": "bridle", "hooves": "hoof", "eyes": "eye"}

def apply_mods(o):
    dg = bpy.context.evaluated_depsgraph_get(); new = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    old = o.data; o.modifiers.clear(); o.data = new; bpy.data.meshes.remove(old)
objs = {}
for name, target in TRIS.items():
    d = np.load(PARTS / f"{name}.npz"); me = bpy.data.meshes.new(name)
    me.from_pydata(d["verts"].tolist(), [], d["faces"].tolist())
    o = bpy.data.objects.new(name, me); coll.objects.link(o)
    sm = o.modifiers.new("s", "SMOOTH"); sm.factor, sm.iterations = 0.5, 2
    if len(d["faces"]) > target:
        dec = o.modifiers.new("d", "DECIMATE"); dec.ratio = target / len(d["faces"]); dec.use_collapse_triangulate = True
    apply_mods(o); o.data.shade_smooth(); o.data.materials.append(MAT[PMAT[name]]); objs[name] = o

def coords(o):
    n = len(o.data.vertices); a = np.empty(n * 3, np.float32); o.data.vertices.foreach_get("co", a); return a.reshape(n, 3)
def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)
def set_cols(o, c):
    attr = o.data.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    attr.data.foreach_set("color", np.concatenate([c, np.ones((len(c), 1))], 1).astype(np.float32).ravel())
    o.data.color_attributes.active_color = attr

# --- coat: bay with black points, darker topline, lighter belly, dark muzzle, white blaze
P = coords(objs["horse"]); x, y, z = P[:, 0], P[:, 1], P[:, 2]
bay = np.array(srgb((0.42, 0.20, 0.09))); dark = np.array(srgb((0.05, 0.035, 0.025))); belly = np.array(srgb((0.55, 0.32, 0.17)))
rng = np.random.default_rng(1); C = np.tile(bay, (len(P), 1))
C *= (1.0 + 0.06 * np.sin(x * 40) * np.sin(y * 31) * np.sin(z * 23))[:, None]                     # soft dapple variation
C = C * (1 - 0.18 * sstep(1.25, 1.42, z))[:, None]                                                  # topline darker
C = C + (belly - C) * (sstep(1.02, 0.86, z) * (np.abs(x) < 0.2) * (z > 0.8) * 0.35)[:, None]
legs = sstep(0.62, 0.42, z) * (z < 0.7); C = C * (1 - legs)[:, None] + dark * legs[:, None]         # black stockings
muzzle = sstep(-1.12, -1.20, y); C = C * (1 - 0.75 * muzzle)[:, None] + dark * (0.75 * muzzle)[:, None]
blaze = (np.abs(x) < 0.032) * (z > 1.57) * (z < 1.90) * (y < -0.96) * (y > -1.24)
C[blaze > 0] = np.array(srgb((0.86, 0.82, 0.76)))
set_cols(objs["horse"], np.clip(C, 0, 1))
Pb = coords(objs["blanket"]); stripes = (np.sin(Pb[:, 1] * 38) > 0.55) | (np.abs(Pb[:, 2] - 1.12) < 0.02)
Cb = np.tile(np.array(srgb((0.52, 0.09, 0.05))), (len(Pb), 1)); Cb[stripes] = np.array(srgb((0.86, 0.72, 0.46)))
set_cols(objs["blanket"], Cb)

# --- armature
arm_d = bpy.data.armatures.new("HorseRig"); arm = bpy.data.objects.new("HorseRig", arm_d); coll.objects.link(arm)
bpy.context.view_layer.objects.active = arm; arm.select_set(True); bpy.ops.object.mode_set(mode="EDIT"); eb = arm_d.edit_bones
BONES = []
def add(n, h, t, parent=None, up=Vector((0, -1, 0))):
    b = eb.new(n); b.head, b.tail = Vector(h), Vector(t); b.align_roll(up)
    if parent: b.parent = eb[parent]
    BONES.append(n)
add("root", (0, 0, 0), (0, 0.3, 0), up=Vector((0, 0, 1)))
add("hips", J["hips"], J["spine"], "root", Vector((0, 0, 1))); add("spine", J["spine"], J["chest"], "hips", Vector((0, 0, 1)))
add("chest", J["chest"], J["neck"], "spine", Vector((0, 0, 1))); add("neck", J["neck"], J["neck2"], "chest", Vector((0, 0, 1)))
add("neck2", J["neck2"], J["head"], "neck", Vector((0, 0, 1))); add("head", J["head"], J["head_end"], "neck2", Vector((0, 0, 1)))
add("tail", J["tail"], J["tail2"], "hips", Vector((0, 0, 1))); add("tail2", J["tail2"], J["tail3"], "tail", Vector((0, 0, 1)))
add("tail3", J["tail3"], J["tail_end"], "tail2", Vector((0, 0, 1)))
for s in "LR":
    add(f"ear.{s}", J[f"ear.{s}"], J[f"ear_end.{s}"], "head", Vector((0, -1, 0)))
    for p, par in (("f", "chest"), ("h", "hips")):
        add(f"{p}_upper.{s}", J[f"{p}_upper.{s}"], J[f"{p}_lower.{s}"], par)
        add(f"{p}_lower.{s}", J[f"{p}_lower.{s}"], J[f"{p}_cannon.{s}"], f"{p}_upper.{s}")
        add(f"{p}_cannon.{s}", J[f"{p}_cannon.{s}"], J[f"{p}_hoof.{s}"], f"{p}_lower.{s}")
        add(f"{p}_hoof.{s}", J[f"{p}_hoof.{s}"], J[f"{p}_end.{s}"], f"{p}_cannon.{s}")
bpy.ops.object.mode_set(mode="OBJECT"); REST = {b.name: b.matrix_local.copy() for b in arm_d.bones}

# --- weights
def seg(n): b = arm_d.bones[n]; return np.array(b.head_local), np.array(b.tail_local)
def sdist(P, a, b):
    ab = b - a; t = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1); return np.linalg.norm(P - (a + t[:, None] * ab), axis=1)
def dist_w(P, bones, sharp=7.0):
    out = {}
    for n in bones:
        a, b = seg(n); w = (sdist(P, a, b) + 0.004) ** -sharp
        if n.endswith(".L"): w = w * sstep(-0.02, 0.03, P[:, 0])
        if n.endswith(".R"): w = w * sstep(0.02, -0.03, P[:, 0])
        out[n] = w
    return out
def assign(o, W_):
    names = list(W_); W = np.maximum(np.stack([W_[n] for n in names], 1), 0)
    if W.shape[1] > 4:
        idx = np.argsort(-W, 1)[:, 4:]; np.put_along_axis(W, idx, 0.0, 1)
    W = W / np.maximum(W.sum(1, keepdims=True), 1e-9)
    for j, n in enumerate(names):
        nz = np.nonzero(W[:, j] > 1e-4)[0]
        if len(nz) == 0: continue
        vg = o.vertex_groups.new(name=n)
        for i in nz: vg.add([int(i)], float(W[i, j]), "REPLACE")
    m = o.modifiers.new("Armature", "ARMATURE"); m.object = arm; o.parent = arm
TORSO = ["hips", "spine", "chest", "neck", "neck2", "head"]
LEGS = [f"{p}_{k}.{s}" for p in "fh" for k in ("upper", "lower", "cannon", "hoof") for s in "LR"]
for name, o in objs.items():
    P = coords(o)
    if name == "horse":
        W = dist_w(P, TORSO + LEGS + ["tail", "ear.L", "ear.R"], 6.0)
        core = sstep(0.95, 1.10, P[:, 2]) * (np.abs(P[:, 0]) < 0.30)                      # trunk stays on the spine chain
        for n in LEGS:
            if n.split("_")[1].startswith("upper"): W[n] = W[n] * (1 - 0.7 * core)
            else: W[n] = W[n] * (1 - core)
        ear = (P[:, 2] > 1.93)
        for s in "LR": W[f"ear.{s}"] = W[f"ear.{s}"] * ear * 3
    elif name in ("mane", "eyes"): W = dist_w(P, ["neck", "neck2", "head"], 6.0) if name == "mane" else {"head": np.ones(len(P))}
    elif name == "bridle": W = dist_w(P, ["neck", "neck2", "head", "chest"], 6.0)
    elif name == "tail": W = dist_w(P, ["tail", "tail2", "tail3"], 6.0)
    elif name in ("saddle", "blanket", "stirrups"): W = {"spine": np.ones(len(P))}
    elif name == "hooves":
        W = {}
        for p in "fh":
            for s in "LR":
                e = np.array(J[f"{p}_end.{s}"]); W[f"{p}_hoof.{s}"] = (np.linalg.norm(P[:, :2] - e[:2], axis=1) < 0.12).astype(float)
    assign(o, W)

# --- animation helpers (same conventions as the avatar: faces -Y; swing forward = -X)
pb = arm.pose.bones
for b in pb: b.rotation_mode = "QUATERNION"
X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)
def lq(bone, axis, deg):
    R = REST[bone].to_3x3(); return (R.inverted() @ Quaternion(Vector(axis), math.radians(deg)).to_matrix() @ R).to_quaternion()
def comb(bone, rots):
    q = Quaternion()
    for axis, deg in rots: q = lq(bone, axis, deg) @ q
    return q
ACTS = []
def new_action(n):
    a = bpy.data.actions.new(n); arm.animation_data_create(); arm.animation_data.action = a; return a
def finish(a, frames):
    a.frame_range = (1, frames); a.use_frame_range = True; a.use_fake_user = True
    tr = arm.animation_data.nla_tracks.new(); tr.name = a.name; tr.strips.new(a.name, 1, a); tr.mute = True
    arm.animation_data.action = None; ACTS.append(a.name)
def key(f, rots, root=(0, 0, 0)):
    for b in pb:
        b.rotation_quaternion = comb(b.name, rots.get(b.name, [])); b.keyframe_insert("rotation_quaternion", frame=f)
    pb["root"].location = Vector(root); pb["root"].keyframe_insert("location", frame=f)

def leg_rots(phase, duty, A, F, front, s):
    """phase 0..1. stance: hoof planted, leg sweeps back; swing: joints fold, leg reaches forward"""
    p = "f" if front else "h"; r = {}
    if phase < duty:
        t = phase / duty; swing = -A + 2 * A * t; fold = 0.0
    else:
        t = (phase - duty) / (1 - duty); swing = A - 2 * A * (0.5 - 0.5 * math.cos(math.pi * t)); fold = math.sin(math.pi * t)
    if front:
        r[f"f_upper.{s}"] = [(X, swing * 0.8)]
        r[f"f_lower.{s}"] = [(X, -F * 0.35 * fold)]
        r[f"f_cannon.{s}"] = [(X, F * 1.25 * fold)]
        r[f"f_hoof.{s}"] = [(X, F * 0.55 * fold + (swing * 0.25 if phase < duty else 0))]
    else:
        r[f"h_upper.{s}"] = [(X, swing * 0.75)]
        r[f"h_lower.{s}"] = [(X, F * 0.45 * fold)]
        r[f"h_cannon.{s}"] = [(X, -F * 0.75 * fold)]
        r[f"h_hoof.{s}"] = [(X, F * 0.6 * fold + (swing * 0.2 if phase < duty else 0))]
    return r

def gait(name, frames, phases, duty, A, F, bob, pitch, neck, tailx):
    a = new_action(name)
    for f in range(1, frames + 1):
        t = (f - 1) / frames; r = {}
        for (leg, ph) in phases.items():
            front, s = leg[0] == "f", leg[-1]; r.update(leg_rots((t + ph) % 1.0, duty, A, F, front, s))
        w = 2 * math.pi * t
        r["hips"] = [(X, pitch * math.sin(w + 0.6))]; r["chest"] = [(X, -pitch * 0.6 * math.sin(w))]
        r["neck"] = [(X, neck * math.sin(w + 1.2))]; r["head"] = [(X, -neck * 0.6 * math.sin(w + 1.2))]
        r["tail"] = [(X, -tailx + 4 * math.sin(w * 2)), (Z, 6 * math.sin(w))]; r["tail2"] = [(X, -tailx * 0.6), (Z, 8 * math.sin(w - 0.6))]
        r["tail3"] = [(Z, 10 * math.sin(w - 1.2))]
        r["ear.L"] = [(X, 8)]; r["ear.R"] = [(X, 8)]
        key(f, r, (0, 0, bob * math.sin(2 * w if name != "Gallop" else w)))
    finish(a, frames)

gait("Walk", 40, {"h_L": 0.0, "f_L": 0.25, "h_R": 0.5, "f_R": 0.75}, 0.64, 16, 38, 0.012, 1.2, 3.0, 6)
gait("Trot", 22, {"f_L": 0.0, "h_R": 0.0, "f_R": 0.5, "h_L": 0.5}, 0.44, 22, 58, 0.035, 1.6, 2.5, 10)
gait("Gallop", 16, {"h_L": 0.0, "h_R": 0.08, "f_L": 0.38, "f_R": 0.48}, 0.32, 32, 82, 0.07, 6.0, 7.0, 28)

a = new_action("Idle")                       # breathing, weight shift, tail swish, ear flicks, head lowers
for f in range(1, 121):
    t = (f - 1) / 120; w = 2 * math.pi * t; r = {}
    r["spine"] = [(X, 0.8 * math.sin(w * 3))]; r["neck"] = [(X, 6 + 4 * math.sin(w))]; r["head"] = [(X, -3 * math.sin(w))]
    r["tail"] = [(X, -6), (Z, 18 * math.sin(w * 2) * (0.5 + 0.5 * math.sin(w)))]; r["tail2"] = [(Z, 14 * math.sin(w * 2 - 0.8))]; r["tail3"] = [(Z, 12 * math.sin(w * 2 - 1.6))]
    flick = math.exp(-((t - 0.35) * 30) ** 2); r["ear.L"] = [(X, -25 * flick), (Z, 10 * flick)]
    flick2 = math.exp(-((t - 0.8) * 30) ** 2); r["ear.R"] = [(X, -25 * flick2), (Z, -10 * flick2)]
    r["h_lower.R"] = [(X, 10 * (0.5 + 0.5 * math.sin(w)))]; r["h_cannon.R"] = [(X, -8 * (0.5 + 0.5 * math.sin(w)))]
    key(f, r)
finish(a, 120)
a = new_action("HeadShake")                  # answers the whistle
for f in range(1, 37):
    t = (f - 1) / 36; e = math.sin(math.pi * t); r = {}
    r["neck"] = [(X, -14 * e)]; r["neck2"] = [(Z, 16 * math.sin(t * 6 * math.pi) * e)]; r["head"] = [(Z, 14 * math.sin(t * 6 * math.pi + 0.5) * e), (X, 10 * e)]
    r["ear.L"] = [(X, -20 * e)]; r["ear.R"] = [(X, -20 * e)]; r["tail"] = [(X, -15 * e)]
    key(f, r)
finish(a, 36)

bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "horse.blend"))
for o in bpy.data.objects: o.select_set(o.users_collection[0].name == "Horse")
bpy.ops.export_scene.gltf(filepath=str(OUT / "horse.glb"), export_format="GLB", use_selection=True, export_apply=False, export_skins=True,
    export_animations=True, export_animation_mode="NLA_TRACKS", export_force_sampling=True, export_vertex_color="ACTIVE",
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6, export_yup=True)
meta = {"clips": ACTS, "saddle_seat_m": [0.0, 0.03, 1.53], "note": "Blender Z-up coords; seat = where the rider's hips sit (three.js: x, z, -y)",
        "tris": sum(len(o.data.polygons) for o in objs.values())}
(OUT / "horse.json").write_text(json.dumps(meta, indent=1)); print("exported", (OUT / "horse.glb").stat().st_size // 1024, "KB", meta, flush=True)
