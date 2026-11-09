"""Rig, skin, shape keys and animation clips for the avatar; exports GLB.

python rig.py <parts_dir> <model.blend> <out_dir> [--render-poses]
"""
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector, Euler

PARTS = Path(sys.argv[1])
MODEL = Path(sys.argv[2])
OUT = Path(sys.argv[3])
OUT.mkdir(parents=True, exist_ok=True)
SK = json.loads((PARTS / "skeleton.json").read_text())
J = {k: Vector(v) for k, v in SK.items() if not k.startswith("_")}
FPS = 30

bpy.ops.wm.open_mainfile(filepath=str(MODEL))
scene = bpy.context.scene
scene.render.fps = FPS
coll = bpy.data.collections["Avatar"]


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ armature
arm_data = bpy.data.armatures.new("AvatarRig")
arm = bpy.data.objects.new("AvatarRig", arm_data)
coll.objects.link(arm)
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
eb = arm_data.edit_bones

BONES = []  # (name, head, tail, parent, roll_hint)


def add(name, head, tail, parent=None, up=Vector((0, -1, 0))):
    b = eb.new(name)
    b.head, b.tail = Vector(head), Vector(tail)
    b.align_roll(up)
    if parent:
        b.parent = eb[parent]
        b.use_connect = False
    BONES.append(name)
    return b


add("root", (0, 0, 0), (0, 0.25, 0), up=Vector((0, 0, 1)))
add("hips", J["hips"], J["spine"], "root")
add("spine", J["spine"], J["chest"], "hips")
add("chest", J["chest"], J["neck"], "spine")
add("neck", J["neck"], J["head"], "chest")
add("head", J["head"], J["head_end"], "neck")
for s in ("L", "R"):
    add(f"eye.{s}", Vector(SK["_eyes"]["1" if s == "L" else "-1"]),
        Vector(SK["_eyes"]["1" if s == "L" else "-1"]) + Vector((0, -0.03, 0)), "head", up=Vector((0, 0, 1)))
    add(f"clavicle.{s}", J[f"clavicle.{s}"], J[f"upper_arm.{s}"], "chest", up=Vector((0, 0, 1)))
    add(f"upper_arm.{s}", J[f"upper_arm.{s}"], J[f"forearm.{s}"], f"clavicle.{s}")
    add(f"forearm.{s}", J[f"forearm.{s}"], J[f"hand.{s}"], f"upper_arm.{s}")
    add(f"hand.{s}", J[f"hand.{s}"], J[f"hand_end.{s}"], f"forearm.{s}")
    add(f"thigh.{s}", J[f"thigh.{s}"], J[f"shin.{s}"], "hips")
    add(f"shin.{s}", J[f"shin.{s}"], J[f"foot.{s}"], f"thigh.{s}")
    add(f"foot.{s}", J[f"foot.{s}"], J[f"toe.{s}"], f"shin.{s}", up=Vector((0, 0, 1)))
    add(f"toe.{s}", J[f"toe.{s}"], J[f"toe_end.{s}"], f"foot.{s}", up=Vector((0, 0, 1)))

bpy.ops.object.mode_set(mode="OBJECT")
REST = {b.name: (b.matrix_local.copy()) for b in arm_data.bones}


# ------------------------------------------------------------------ skin weights
def seg_dist(P, a, b):
    a, b = np.array(a), np.array(b)
    ab = b - a
    t = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(P - (a + t[:, None] * ab), axis=1)


def bone_seg(name):
    b = arm_data.bones[name]
    return np.array(b.head_local), np.array(b.tail_local)


def coords(obj):
    n = len(obj.data.vertices)
    a = np.empty(n * 3, dtype=np.float32)
    obj.data.vertices.foreach_get("co", a)
    return a.reshape(n, 3) + np.array(obj.location)


def assign(obj, weights):
    """weights: dict bone -> array(n). Normalised, top-4."""
    names = list(weights)
    W = np.stack([weights[n] for n in names], axis=1)
    W = np.maximum(W, 0)
    if W.shape[1] > 4:
        idx = np.argsort(-W, axis=1)[:, 4:]
        np.put_along_axis(W, idx, 0.0, axis=1)
    W = W / np.maximum(W.sum(axis=1, keepdims=True), 1e-9)
    for j, n in enumerate(names):
        col = W[:, j]
        nz = np.nonzero(col > 1e-4)[0]
        if len(nz) == 0:
            continue
        vg = obj.vertex_groups.new(name=n)
        for i in nz:
            vg.add([int(i)], float(col[i]), "REPLACE")
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    obj.parent = arm


def distance_weights(P, bones, sharp=7.0, side_lock=True):
    out = {}
    for n in bones:
        a, b = bone_seg(n)
        d = seg_dist(P, a, b) + 0.004
        w = d ** -sharp
        if side_lock and (n.endswith(".L") or n.endswith(".R")):
            sgn = 1 if n.endswith(".L") else -1
            w = w * smoothstep(-0.03, 0.02, sgn * P[:, 0])
        out[n] = w
    return out


def rigid(P, bone):
    return {bone: np.ones(len(P))}


objs = {o.name: o for o in coll.objects if o.type == "MESH"}

ARM_BONES = ["clavicle.{}", "upper_arm.{}", "forearm.{}", "hand.{}"]
LEG_BONES = ["thigh.{}", "shin.{}", "foot.{}"]
TORSO = ["hips", "spine", "chest", "neck"]

for name, obj in objs.items():
    P = coords(obj)
    if name in ("hair", "eyebrows", "hat", "hatband"):
        w = rigid(P, "head")
    elif name.startswith("eye_"):
        w = rigid(P, "eye." + name[-1])
    elif name == "head":
        z = P[:, 2]
        wh = smoothstep(1.505, 1.555, z)
        wn = (1 - wh) * smoothstep(1.43, 1.48, z)
        w = {"head": wh, "neck": wn, "chest": 1 - wh - wn}
    elif name in ("jacket", "shirt"):
        bones = TORSO + [b.format(s) for b in ARM_BONES for s in "LR"]
        w = distance_weights(P, bones, sharp=6.0)
        # torso core stays on the spine chain
        for s in "LR":
            sgn = 1 if s == "L" else -1
            inside = 1 - smoothstep(0.13, 0.19, sgn * P[:, 0])
            for b in ARM_BONES[1:]:
                w[b.format(s)] *= (1 - inside)
            w[f"clavicle.{s}"] *= 0.5
    elif name in ("tie", "tie_clip", "button", "badge"):
        z = P[:, 2]
        wc = smoothstep(1.16, 1.30, z)
        w = {"chest": wc, "spine": 1 - wc}
    elif name == "trousers":
        bones = ["hips"] + [b.format(s) for b in LEG_BONES for s in "LR"]
        w = distance_weights(P, bones, sharp=6.0)
        w["hips"] = w["hips"] * 2.0
    elif name in ("shoes", "soles"):
        w = {}
        for s in "LR":
            sgn = 1 if s == "L" else -1
            on = (sgn * P[:, 0] > 0).astype(float)
            toe_y = J[f"toe.{s}"].y
            wt = smoothstep(toe_y + 0.02, toe_y - 0.02, P[:, 1])
            w[f"toe.{s}"] = on * wt
            w[f"foot.{s}"] = on * (1 - wt)
    elif name.startswith("hand_"):
        s = name[-1]
        wr = np.array(J[f"hand.{s}"])
        hd = np.array(SK[f"_handdir.{s}"])
        t = (P - wr) @ hd
        wh = smoothstep(-0.02, 0.015, t)
        w = {f"hand.{s}": wh, f"forearm.{s}": 1 - wh}
    elif name == "watch":
        w = rigid(P, "forearm.L")
    else:
        w = rigid(P, "chest")
    assign(obj, w)

# ------------------------------------------------------------------ shape keys (head)
head = objs["head"]
P0 = coords(head)
Hc = np.array([0.0, 0.0, 1.648])
q = P0 - Hc
head.shape_key_add(name="Basis")


def add_key(name, newpos):
    k = head.shape_key_add(name=name, from_mix=False)
    k.data.foreach_set("co", (newpos - np.array(head.location)).astype(np.float32).ravel())
    return k


def rot_about(points, pivot, axis, ang):
    R = np.array(Matrix.Rotation(ang, 3, Vector(axis)))
    return (points - pivot) @ R.T + pivot


# Blink: upper-lid shell rotates down over the eyeball
new = P0.copy()
for s in ("1", "-1"):
    c = np.array(SK["_eyes"][s])
    r = np.linalg.norm(P0 - c, axis=1)
    lid = (np.abs(r - (SK["_eye_r"] + 0.0016)) < 0.0035) & (P0[:, 2] > c[2] + 0.002) & (P0[:, 1] < c[1] + 0.006)
    wgt = lid.astype(float) * smoothstep(c[2] + 0.002, c[2] + 0.008, P0[:, 2])
    rp = rot_about(P0, c, (1, 0, 0), math.radians(-48))
    new = np.where(lid[:, None], new * (1 - wgt[:, None]) + rp * wgt[:, None], new)
add_key("Blink", new)

# Mouth_Open: lower lip + chin swing down around the jaw hinge
pivot = Hc + np.array([0.0, 0.010, -0.030])
below = smoothstep(-0.0595, -0.0675, q[:, 2]) * smoothstep(0.03, -0.02, q[:, 1]) * (1 - smoothstep(0.045, 0.075, np.abs(q[:, 0])))
below *= 1 - smoothstep(-0.16, -0.20, q[:, 2])
rp = rot_about(P0, pivot, (1, 0, 0), math.radians(11))
add_key("Mouth_Open", P0 * (1 - below[:, None]) + rp * below[:, None])

# Smile: mouth corners up/back, cheeks lift
corner = np.zeros(len(P0))
for s in (1, -1):
    corner += np.exp(-(((q[:, 0] - s * 0.0235) / 0.011) ** 2 + ((q[:, 2] + 0.0633) / 0.011) ** 2 + ((q[:, 1] + 0.093) / 0.02) ** 2))
cheek = np.zeros(len(P0))
for s in (1, -1):
    cheek += np.exp(-(((q[:, 0] - s * 0.045) / 0.018) ** 2 + ((q[:, 2] + 0.028) / 0.02) ** 2)) * smoothstep(-0.02, -0.07, q[:, 1])
off = np.stack([np.sign(q[:, 0]) * 0.0025 * corner, 0.003 * corner, 0.0045 * corner + 0.0022 * cheek], axis=1)
add_key("Smile", P0 + off)

# ------------------------------------------------------------------ animation helpers
pb = arm.pose.bones
for b in pb:
    b.rotation_mode = "QUATERNION"


def local_q(bone, axis, deg):
    """Rotation about an armature-space axis, expressed in the bone's local frame."""
    R = REST[bone].to_3x3()
    Q = Quaternion(Vector(axis), math.radians(deg))
    return (R.inverted() @ Q.to_matrix() @ R).to_quaternion()


def combine(bone, rots):
    """Apply rotations in list order (first listed is applied first)."""
    q = Quaternion()
    for axis, deg in rots:
        q = local_q(bone, axis, deg) @ q
    return q


X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)
# Conventions (character faces -Y):
#   leg/arm swing forward  = negative X      knee bend          = positive X (shin)
#   elbow bend (forward)   = negative X      left arm down      = +Y, right arm down = -Y
ARMS_DOWN = {"upper_arm.L": [(Y, 40)], "upper_arm.R": [(Y, -40)],
             "forearm.L": [(X, -10)], "forearm.R": [(X, -10)]}


def aim(name, d):
    """Rotate a bone so its axis points along armature-space direction d."""
    b = pb[name]
    b.rotation_quaternion = Quaternion()
    bpy.context.view_layer.update()
    C = b.matrix.to_3x3().normalized()
    local = C.inverted() @ Vector(d).normalized()
    b.rotation_quaternion = Vector((0, 1, 0)).rotation_difference(local)
    bpy.context.view_layer.update()


def pose(frame, rots, loc=None, keys=None, aims=None):
    for b in pb:
        b.rotation_quaternion = combine(b.name, rots[b.name]) if b.name in rots else Quaternion()
        b.location = Vector((0, 0, 0))
    if aims:
        for name in BONES:
            if name in aims:
                aim(name, aims[name])
    for b in pb:
        b.keyframe_insert("rotation_quaternion", frame=frame)
    if loc:
        for name, vec in loc.items():
            pb[name].location = Vector(vec)
    for name in ("root", "hips"):
        pb[name].keyframe_insert("location", frame=frame)
    for kname in ("Blink", "Mouth_Open", "Smile"):
        kb = head.data.shape_keys.key_blocks[kname]
        kb.value = (keys or {}).get(kname, 0.0)
        kb.keyframe_insert("value", frame=frame)


def merged(*dicts):
    out = {}
    for d in dicts:
        for k, v in d.items():
            out.setdefault(k, []).extend(v)
    return out


KEYS = head.data.shape_keys


def new_action(name):
    act = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = act
    face = bpy.data.actions.new(name + "_face")
    KEYS.animation_data_create()
    KEYS.animation_data.action = face
    act["face_action"] = face.name
    return act


ACTIONS = []


def finish(act, frames):
    face = bpy.data.actions[act["face_action"]]
    for owner, a in ((arm, act), (KEYS, face)):
        a.frame_range = (1, frames)
        a.use_frame_range = True
        a.use_fake_user = True
        tr = owner.animation_data.nla_tracks.new()
        tr.name = act.name            # same track name on rig and face -> one glTF clip
        tr.strips.new(act.name, 1, a)
        tr.mute = True
        owner.animation_data.action = None
    ACTIONS.append(act.name)


def blink_at(f, frames):
    """blink value at frame f for a clip; one quick blink near 70% of the clip"""
    c = int(frames * 0.7)
    return {c - 2: 0.0, c: 1.0, c + 2: 0.0}.get(f, None)


# ---------------------------------------------------------------- Idle (loop 60)
act = new_action("Idle")
for f in range(1, 62, 6):
    ph = 0.5 - 0.5 * math.cos((f - 1) / 60 * 2 * math.pi)
    pose(f, merged(ARMS_DOWN, {"chest": [(X, -1.4 * ph)], "neck": [(X, 0.6 * ph)], "head": [(Z, 2.0 * (ph - 0.5))],
                               "upper_arm.L": [(X, 1.5 * ph)], "upper_arm.R": [(X, 1.5 * ph)]}),
         loc={"hips": (0, 0, -0.003 * ph)}, keys={"Blink": 1.0 if f == 43 else 0.0})
finish(act, 61)

# ---------------------------------------------------------------- Walk (loop 32)
act = new_action("Walk")
N = 32
for i in range(0, N + 1, 2):
    t = i / N * 2 * math.pi
    s_ = math.sin(t)
    knee_l = max(0.0, 40 * math.sin(t + 1.3)) + 4
    knee_r = max(0.0, 40 * math.sin(t + 1.3 + math.pi)) + 4
    rots = merged(ARMS_DOWN, {
        "thigh.L": [(X, -24 * s_)], "thigh.R": [(X, 24 * s_)],
        "shin.L": [(X, knee_l)], "shin.R": [(X, knee_r)],
        "foot.L": [(X, -10 * math.sin(t - 0.6))], "foot.R": [(X, 10 * math.sin(t - 0.6))],
        "upper_arm.L": [(X, 16 * s_)], "upper_arm.R": [(X, -16 * s_)],
        "forearm.L": [(X, -6 - 8 * max(0, s_))], "forearm.R": [(X, -6 - 8 * max(0, -s_))],
        "hips": [(Z, 5 * s_)], "chest": [(Z, -7 * s_), (X, -2)], "head": [(Z, 2 * s_)],
    })
    pose(i + 1, rots, loc={"hips": (0, 0, 0.016 * abs(math.cos(t)) - 0.016)})
finish(act, N + 1)

# ---------------------------------------------------------------- Run (loop 20)
act = new_action("Run")
N = 20
for i in range(0, N + 1, 2):
    t = i / N * 2 * math.pi
    s_ = math.sin(t)
    rots = merged(ARMS_DOWN, {
        "thigh.L": [(X, -42 * s_ - 12)], "thigh.R": [(X, 42 * s_ - 12)],
        "shin.L": [(X, max(0, 85 * math.sin(t + 1.2)) + 15)], "shin.R": [(X, max(0, 85 * math.sin(t + 1.2 + math.pi)) + 15)],
        "foot.L": [(X, -15 * math.sin(t - 0.4))], "foot.R": [(X, 15 * math.sin(t - 0.4))],
        "upper_arm.L": [(X, 38 * s_)], "upper_arm.R": [(X, -38 * s_)],
        "forearm.L": [(X, -75)], "forearm.R": [(X, -75)],
        "hips": [(Z, 8 * s_), (X, -6)], "chest": [(Z, -11 * s_), (X, -5)], "head": [(X, 5)],
    })
    pose(i + 1, rots, loc={"hips": (0, 0, 0.03 * abs(math.cos(t)) - 0.035)})
finish(act, N + 1)

# ---------------------------------------------------------------- Jump (one-shot 30)
act = new_action("Jump")
crouch = {"thigh.L": [(X, -38)], "thigh.R": [(X, -38)], "shin.L": [(X, 65)], "shin.R": [(X, 65)],
          "foot.L": [(X, -27)], "foot.R": [(X, -27)], "chest": [(X, -12)],
          "upper_arm.L": [(X, 25)], "upper_arm.R": [(X, 25)]}
air = {"thigh.L": [(X, -30)], "thigh.R": [(X, -8)], "shin.L": [(X, 45)], "shin.R": [(X, 25)],
       "foot.L": [(X, 15)], "foot.R": [(X, 15)],
       "head": [(X, -6)]}
air_aims = {"upper_arm.L": (0.45, -0.35, 0.82), "upper_arm.R": (-0.45, -0.35, 0.82)}
pose(1, ARMS_DOWN)
pose(7, merged(ARMS_DOWN, crouch), loc={"hips": (0, 0, -0.12)})
pose(14, merged(ARMS_DOWN, air), loc={"hips": (0, 0, 0.30)}, aims=air_aims)
pose(21, merged(ARMS_DOWN, crouch), loc={"hips": (0, 0, -0.09)})
pose(30, ARMS_DOWN)
finish(act, 30)

# ---------------------------------------------------------------- Wave (60)
act = new_action("Wave")
for f in range(1, 62, 4):
    on = 1.0 if 9 <= f <= 53 else (0.0 if f in (1, 61) else 0.5)
    ph = math.sin((f - 9) / 11 * 2 * math.pi) if 9 <= f <= 53 else 0.0
    rots = merged(ARMS_DOWN, {
        "upper_arm.R": [(Y, 100 * on), (X, -12 * on)],
        "forearm.R": [(Y, 80 * on), (Y, 16 * ph * on)],
        "hand.R": [(Y, 18 * ph * on)],
        "head": [(Z, -7 * on), (X, -3 * on)], "chest": [(Z, 3 * on)],
    })
    pose(f, rots, keys={"Smile": 0.85 * on})
finish(act, 61)

# ---------------------------------------------------------------- Talk (60)
act = new_action("Talk")
mouth = [0.0, 0.7, 0.25, 0.9, 0.15, 0.6, 0.1, 0.85, 0.35, 0.7, 0.0]
for i, f in enumerate(range(1, 62, 6)):
    g = math.sin(i * 1.3)
    rots = merged(ARMS_DOWN, {"upper_arm.R": [(X, -14)], "forearm.R": [(X, -50 - 12 * g), (Z, 10)],
                              "upper_arm.L": [(X, -6)], "forearm.L": [(X, -25 + 10 * g)],
                              "head": [(X, 3 * g), (Z, 3 * math.cos(i))], "chest": [(Z, 2 * g)]})
    pose(f, rots, keys={"Mouth_Open": mouth[i % len(mouth)], "Smile": 0.25})
finish(act, 61)

# ---------------------------------------------------------------- Think (60)
act = new_action("Think")
think_head = {"head": [(X, 7), (Y, -6)], "neck": [(X, 3)]}
think_aims = {"upper_arm.R": (-0.10, -0.55, -0.83), "forearm.R": (0.46, 0.02, 0.89), "hand.R": (0.55, -0.35, 0.76),
              "upper_arm.L": (0.08, -0.30, -0.95), "forearm.L": (-0.96, -0.28, 0.05), "hand.L": (-0.9, -0.1, 0.2)}
pose(1, ARMS_DOWN)
pose(13, merged(ARMS_DOWN, think_head), aims=think_aims)
pose(47, merged(ARMS_DOWN, think_head, {"head": [(Y, -3)]}), aims=think_aims, keys={"Blink": 0.0})
pose(60, ARMS_DOWN)
finish(act, 60)

# ---------------------------------------------------------------- Nod (30)
act = new_action("Nod")
for f, a in ((1, 0), (8, 11), (15, -2), (22, 9), (30, 0)):
    pose(f, merged(ARMS_DOWN, {"head": [(X, a)], "neck": [(X, a * 0.4)]}), keys={"Smile": 0.35 if a else 0.0})
finish(act, 30)

# ---------------------------------------------------------------- Idle arms crossed (loop 60)
act = new_action("IdleArmsCrossed")
crossed = {"upper_arm.L": (0.16, -0.34, -0.93), "forearm.L": (-0.93, -0.30, 0.21), "hand.L": (-0.85, 0.15, 0.30),
           "upper_arm.R": (-0.16, -0.40, -0.90), "forearm.R": (0.92, -0.38, 0.06), "hand.R": (0.80, 0.25, 0.25)}
for f in range(1, 62, 10):
    ph = 0.5 - 0.5 * math.cos((f - 1) / 60 * 2 * math.pi)
    pose(f, merged(ARMS_DOWN, {"chest": [(X, -1.2 * ph)], "head": [(Z, 2 * (ph - .5))]}), aims=crossed,
         keys={"Smile": 0.3})
finish(act, 61)


# ---------------------------------------------------------------- Whistle (one-shot 45): two fingers to the lips, calls the horse
act = new_action("Whistle")
whistle_aims = {"upper_arm.R": (-0.12, -0.55, -0.82), "forearm.R": (0.42, -0.10, 0.90), "hand.R": (0.40, -0.45, 0.80)}
for f, on in ((1, 0.0), (9, 1.0), (31, 1.0), (45, 0.0)):
    hd_ = {"head": [(X, -8 * on), (Z, -4 * on)], "neck": [(X, -3 * on)], "chest": [(X, 2 * on)],
            "upper_arm.L": [(X, -8 * on)], "forearm.L": [(X, -30 * on)]}
    pose(f, merged(ARMS_DOWN, hd_), aims=whistle_aims if on > 0.5 else None, keys={"Mouth_Open": 0.12 * on, "Smile": 0.1})
finish(act, 45)

# ---------------------------------------------------------------- Ride (loop 32): seated in the saddle, reins in both hands
act = new_action("Ride")
ride_aims = {"upper_arm.L": (0.12, -0.30, -0.95), "forearm.L": (-0.20, -0.96, 0.18), "hand.L": (-0.10, -0.95, -0.15),
             "upper_arm.R": (-0.12, -0.30, -0.95), "forearm.R": (0.20, -0.96, 0.18), "hand.R": (0.10, -0.95, -0.15)}
for f in range(1, 34, 4):
    ph = math.sin((f - 1) / 32 * 2 * math.pi)
    legs = {"thigh.L": [(Y, -26), (X, -72)], "thigh.R": [(Y, 26), (X, -72)],
            "shin.L": [(X, 70)], "shin.R": [(X, 70)], "foot.L": [(X, -12)], "foot.R": [(X, -12)],
            "spine": [(X, -4 - 2 * ph)], "chest": [(X, -3)], "head": [(X, 4 + 2 * ph)]}
    pose(f, legs, loc={"hips": (0, 0, 0.012 * ph)}, aims=ride_aims, keys={"Smile": 0.35})
finish(act, 33)

# opening the .blend shows the Idle clip on the timeline
arm.animation_data.action = bpy.data.actions["Idle"]
KEYS.animation_data.action = bpy.data.actions["Idle_face"]
scene.frame_start, scene.frame_end = 1, 61

bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "avatar.blend"))
print("actions:", ACTIONS, flush=True)
