"""Byte Island Railroad: 4-4-0 steam locomotive + tender + passenger car, built by script (Blender 5.2).
Travels along +X. Root origin = centre of the passenger car, y=0 on the track centreline, z=0 on the ground.
Wheels are separate objects named wheel_* with their pivot on the axle (spin about local Y).
python train.py <out_dir> [--render]
"""
import bpy, bmesh, math, sys, json
from pathlib import Path
from mathutils import Vector, Matrix
OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
RENDER = "--render" in sys.argv
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene; coll = bpy.data.collections.new("Train"); sc.collection.children.link(coll)
RAIL = 0.35; GAUGE = 0.72
def srgb(c): return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)
def mat(name, col, rough=0.5, metal=0.0, emit=None, strength=0.0, coat=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*srgb(col), 1); b.inputs["Roughness"].default_value = rough; b.inputs["Metallic"].default_value = metal
    b.inputs["Coat Weight"].default_value = coat
    if emit: b.inputs["Emission Color"].default_value = (*srgb(emit), 1); b.inputs["Emission Strength"].default_value = strength
    return m
M = {"black": mat("Train_Iron", (0.06, 0.06, 0.065), 0.42, 0.7, coat=0.3), "red": mat("Train_Red", (0.50, 0.08, 0.05), 0.45, coat=0.5),
     "green": mat("Train_Green", (0.08, 0.22, 0.14), 0.45, coat=0.5), "brass": mat("Train_Brass", (0.92, 0.66, 0.24), 0.25, 1.0),
     "wood": mat("Train_Wood", (0.36, 0.22, 0.12), 0.8), "cream": mat("Train_Cream", (0.86, 0.78, 0.60), 0.6),
     "coal": mat("Train_Coal", (0.03, 0.03, 0.03), 0.9), "glass": mat("Window_Warm", (0.10, 0.07, 0.04), 0.1, emit=(1.0, 0.62, 0.22), strength=2.2),
     "lamp": mat("Lantern", (0.3, 0.2, 0.1), 0.3, emit=(1.0, 0.75, 0.40), strength=14), "wheel": mat("Train_Wheel", (0.42, 0.06, 0.04), 0.5, 0.3)}
def obj(name, bm, m, loc=(0, 0, 0)):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); coll.objects.link(o); o.location = loc; o.data.materials.append(M[m]); return o
def box(bm, c, s, rx=0, ry=0, rz=0):
    r = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(c) @ Matrix.Rotation(rz, 4, "Z") @ Matrix.Rotation(ry, 4, "Y") @ Matrix.Rotation(rx, 4, "X") @ Matrix.Diagonal((*s, 1)), verts=r["verts"])
def cyl(bm, c, r1, r2, h, axis="Z", seg=24):
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r1, radius2=r2, depth=h)
    R = {"Z": Matrix.Identity(4), "X": Matrix.Rotation(math.pi / 2, 4, "Y"), "Y": Matrix.Rotation(math.pi / 2, 4, "X")}[axis]
    bmesh.ops.transform(bm, matrix=Matrix.Translation(c) @ R, verts=res["verts"])
def smooth(o):
    for p in o.data.polygons: p.use_smooth = True
    return o
WHEELS = []
def wheel(name, x, side, r, spokes=12, m="wheel"):
    bm = bmesh.new()
    tire = bmesh.ops.create_cone(bm, cap_ends=False, segments=32, radius1=r, radius2=r, depth=0.12)
    bmesh.ops.transform(bm, matrix=Matrix.Rotation(math.pi / 2, 4, "X"), verts=tire["verts"])
    t2 = bmesh.ops.create_cone(bm, cap_ends=False, segments=32, radius1=r * 0.86, radius2=r * 0.86, depth=0.12)
    bmesh.ops.transform(bm, matrix=Matrix.Rotation(math.pi / 2, 4, "X"), verts=t2["verts"])
    flange = bmesh.ops.create_cone(bm, cap_ends=True, segments=32, radius1=r * 1.07, radius2=r * 1.07, depth=0.03)
    bmesh.ops.transform(bm, matrix=Matrix.Translation((0, -side * 0.07, 0)) @ Matrix.Rotation(math.pi / 2, 4, "X"), verts=flange["verts"])
    cyl(bm, Vector((0, 0, 0)), r * 0.18, r * 0.18, 0.16, "Y", 16)                       # hub
    for k in range(spokes):
        a = k * math.tau / spokes; box(bm, Vector((math.cos(a) * r * 0.5, 0, math.sin(a) * r * 0.5)), (r * 0.08, 0.06, r * 0.88), ry=-a + math.pi / 2)
    o = obj(name, bm, m, (x, side * GAUGE, RAIL + r)); smooth(o); WHEELS.append({"name": name, "radius": round(r, 3)}); return o

# ------------------------------------------------ passenger car (origin at its centre)
L_CAR = 10.0
bm = bmesh.new(); box(bm, Vector((0, 0, 1.95)), (L_CAR, 2.5, 2.2))                    # body
box(bm, Vector((0, 0, 1.0)), (L_CAR - 0.6, 2.2, 0.25))                                 # underframe
obj("car_body", bm, "green")
bm = bmesh.new(); box(bm, Vector((0, 0, 3.12)), (L_CAR + 0.3, 2.75, 0.14))            # roof + clerestory
box(bm, Vector((0, 0, 3.36)), (L_CAR - 1.2, 1.3, 0.36)); box(bm, Vector((0, 0, 3.58)), (L_CAR - 1.0, 1.55, 0.09))
obj("car_roof", bm, "black")
bm = bmesh.new(); bg = bmesh.new()
for i in range(8):                                                                     # windows both sides
    x = -L_CAR / 2 + 0.95 + i * 1.15
    for s in (1, -1):
        box(bm, Vector((x, s * 1.255, 2.15)), (0.80, 0.03, 0.85)); box(bg, Vector((x, s * 1.27, 2.15)), (0.66, 0.02, 0.70))
box(bm, Vector((0, 1.26, 1.32)), (L_CAR - 0.4, 0.03, 0.10)); box(bm, Vector((0, -1.26, 1.32)), (L_CAR - 0.4, 0.03, 0.10))
box(bm, Vector((0, 1.26, 2.70)), (L_CAR - 0.4, 0.03, 0.10)); box(bm, Vector((0, -1.26, 2.70)), (L_CAR - 0.4, 0.03, 0.10))
obj("car_trim", bm, "cream"); obj("car_windows", bg, "glass")
bm = bmesh.new()
for e in (1, -1):                                                                     # end platforms + railings
    box(bm, Vector((e * (L_CAR / 2 + 0.55), 0, 1.0)), (1.1, 2.3, 0.10))
    for y in (-1.05, 1.05): box(bm, Vector((e * (L_CAR / 2 + 1.05), y, 1.45)), (0.05, 0.05, 0.9))
    box(bm, Vector((e * (L_CAR / 2 + 1.05), 0, 1.88)), (0.05, 2.15, 0.05))
obj("car_platforms", bm, "black")
cu = bpy.data.curves.new("car_name", "FONT"); cu.body = "BYTE ISLAND R.R."; cu.size = 0.30; cu.extrude = 0.01; cu.align_x = "CENTER"
for s in (1, -1):
    to = bpy.data.objects.new("t", cu); coll.objects.link(to); to.rotation_euler = (math.pi / 2, 0, 0 if s < 0 else math.pi); to.location = (0, s * 1.285, 1.48)
    me = bpy.data.meshes.new_from_object(to.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    tm = bpy.data.objects.new(f"car_lettering_{'L' if s > 0 else 'R'}", me); coll.objects.link(tm); tm.matrix_world = to.matrix_world.copy(); tm.data.materials.append(M["brass"])
    bpy.data.objects.remove(to)
for bx in (-3.4, 3.4):                                                                 # two bogies, 2 axles each
    bm = bmesh.new(); box(bm, Vector((bx, 0, 0.82)), (2.2, 1.9, 0.22)); obj(f"car_bogie_{'r' if bx < 0 else 'f'}", bm, "black")
    for ax in (-0.7, 0.7):
        for s in (1, -1): wheel(f"wheel_car_{'r' if bx < 0 else 'f'}{'1' if ax < 0 else '2'}_{'L' if s > 0 else 'R'}", bx + ax, s, 0.45, 10)

# ------------------------------------------------ tender (coal + water) ahead of the car
TX = L_CAR / 2 + 1.1 + 2.3
bm = bmesh.new(); box(bm, Vector((TX, 0, 1.75)), (4.2, 2.5, 1.6)); box(bm, Vector((TX, 0, 0.95)), (4.4, 2.2, 0.25))
obj("tender_body", bm, "black")
bm = bmesh.new(); box(bm, Vector((TX + 0.2, 0, 2.6)), (3.4, 2.1, 0.5)); obj("tender_coal", bm, "coal")
bm = bmesh.new(); box(bm, Vector((TX, 1.26, 1.85)), (3.8, 0.02, 0.10)); box(bm, Vector((TX, -1.26, 1.85)), (3.8, 0.02, 0.10)); obj("tender_stripe", bm, "brass")
for ax in (-1.3, -0.4, 0.5, 1.4):
    for s in (1, -1): wheel(f"wheel_tender_{int((ax + 1.3) / 0.9) + 1}_{'L' if s > 0 else 'R'}", TX + ax, s, 0.42, 10)

# ------------------------------------------------ locomotive (cab at the rear, boiler forward)
LX = TX + 2.1 + 0.3          # rear of the cab
bm = bmesh.new(); box(bm, Vector((LX + 4.3, 0, 0.95)), (8.6, 1.7, 0.35)); obj("loco_frame", bm, "black")
bm = bmesh.new(); cyl(bm, Vector((LX + 4.6, 0, 2.05)), 0.78, 0.78, 5.0, "X", 32); o = obj("loco_boiler", bm, "black"); smooth(o)
bm = bmesh.new()
for k in range(5): cyl(bm, Vector((LX + 2.4 + k * 1.05, 0, 2.05)), 0.80, 0.80, 0.06, "X", 32)                     # boiler bands
obj("loco_bands", bm, "brass")
bm = bmesh.new(); cyl(bm, Vector((LX + 7.35, 0, 2.05)), 0.84, 0.84, 0.6, "X", 32); cyl(bm, Vector((LX + 7.68, 0, 2.05)), 0.70, 0.70, 0.08, "X", 32)
o = obj("loco_smokebox", bm, "black"); smooth(o)
bm = bmesh.new(); cyl(bm, Vector((LX + 7.3, 0, 3.0)), 0.20, 0.24, 0.9, "Z", 20); cyl(bm, Vector((LX + 7.3, 0, 3.75)), 0.24, 0.55, 0.7, "Z", 20)   # balloon stack
cyl(bm, Vector((LX + 7.3, 0, 4.12)), 0.56, 0.56, 0.06, "Z", 20); o = obj("loco_stack", bm, "black"); smooth(o)
bm = bmesh.new(); cyl(bm, Vector((LX + 4.6, 0, 2.95)), 0.36, 0.30, 0.55, "Z", 20); cyl(bm, Vector((LX + 3.1, 0, 2.95)), 0.30, 0.24, 0.45, "Z", 20)
o = obj("loco_domes", bm, "brass"); smooth(o)
bm = bmesh.new()
for cx, r in ((LX + 4.6, 0.30), (LX + 3.1, 0.24)):
    res = bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=r)
    bmesh.ops.translate(bm, vec=(cx, 0, 3.2 if r > 0.25 else 3.15), verts=res["verts"])
o2 = obj("loco_dome_caps", bm, "brass"); smooth(o2)
bm = bmesh.new(); box(bm, Vector((LX + 7.85, 0, 3.0)), (0.55, 0.55, 0.55)); obj("loco_headlamp_box", bm, "black")
bm = bmesh.new(); cyl(bm, Vector((LX + 8.14, 0, 3.0)), 0.20, 0.20, 0.05, "X", 20); obj("loco_headlamp", bm, "lamp")
bm = bmesh.new()                                                                     # cowcatcher (pilot)
for k in range(9):
    y = -0.8 + k * 0.2; box(bm, Vector((LX + 8.55 - abs(y) * 0.35, y, 0.66)), (0.07, 0.07, 0.72), ry=-0.55)
box(bm, Vector((LX + 8.45, 0, 0.98)), (0.4, 1.8, 0.14))
obj("loco_pilot", bm, "red")
bm = bmesh.new(); box(bm, Vector((LX + 1.2, 0, 2.3)), (2.4, 2.4, 2.4)); obj("loco_cab", bm, "red")                       # cab
bm = bmesh.new(); box(bm, Vector((LX + 1.2, 0, 3.6)), (2.9, 2.8, 0.14)); obj("loco_cab_roof", bm, "black")
bm = bmesh.new(); bg = bmesh.new()
for s in (1, -1):
    box(bm, Vector((LX + 1.2, s * 1.205, 2.7)), (1.0, 0.03, 0.8)); box(bg, Vector((LX + 1.2, s * 1.22, 2.7)), (0.85, 0.02, 0.65))
box(bm, Vector((LX + 2.405, 0.6, 2.8)), (0.03, 0.6, 0.6)); box(bm, Vector((LX + 2.405, -0.6, 2.8)), (0.03, 0.6, 0.6))
obj("loco_cab_frames", bm, "black"); obj("loco_cab_windows", bg, "glass")
bm = bmesh.new(); cyl(bm, Vector((LX + 5.6, 0, 3.0)), 0.13, 0.17, 0.30, "Z", 16); obj("loco_bell", bm, "brass")
bm = bmesh.new()
for s in (1, -1): cyl(bm, Vector((LX + 7.0, s * 0.95, 1.25)), 0.26, 0.26, 1.1, "X", 20)                                  # cylinders
obj("loco_cylinders", bm, "black")
cu = bpy.data.curves.new("loco_no", "FONT"); cu.body = "No. 21"; cu.size = 0.30; cu.extrude = 0.01; cu.align_x = "CENTER"
for s in (1, -1):
    to = bpy.data.objects.new("t", cu); coll.objects.link(to); to.rotation_euler = (math.pi / 2, 0, 0 if s < 0 else math.pi); to.location = (LX + 1.2, s * 1.215, 1.75)
    me = bpy.data.meshes.new_from_object(to.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    tm = bpy.data.objects.new(f"loco_number_{'L' if s > 0 else 'R'}", me); coll.objects.link(tm); tm.matrix_world = to.matrix_world.copy(); tm.data.materials.append(M["brass"])
    bpy.data.objects.remove(to)
for ax, nm in ((LX + 1.6, "drive1"), (LX + 3.35, "drive2")):
    for s in (1, -1): wheel(f"wheel_loco_{nm}_{'L' if s > 0 else 'R'}", ax, s, 0.78, 14)
for ax, nm in ((LX + 5.9, "lead1"), (LX + 6.9, "lead2")):
    for s in (1, -1): wheel(f"wheel_loco_{nm}_{'L' if s > 0 else 'R'}", ax, s, 0.40, 10)
bm = bmesh.new()                                                                    # coupling rods (static, simple)
for s in (1, -1): box(bm, Vector((LX + 2.48, s * 0.86, RAIL + 0.78)), (1.95, 0.05, 0.10))
obj("loco_rods", bm, "black")
FRONT = LX + 8.95; REAR = -L_CAR / 2 - 1.1
meta = {"units": "metres; three.js Y-up after export", "travel_axis": "+X", "origin": "centre of the passenger car, on the track centreline, ground level (rails sit at y=0.35)",
        "length_m": round(FRONT - REAR, 2), "front_x": round(FRONT, 2), "rear_x": round(REAR, 2),
        "wheels": WHEELS, "spin": "rotate each wheel_* about its local Y (three: local Z after Y-up conversion; verify) by distance / radius",
        "smoke_emitter": [round(LX + 7.3, 2), 4.2, 0.0], "headlamp": [round(LX + 8.2, 2), 3.0, 0.0], "whistle_at": [round(LX + 4.6, 2), 3.2, 0.0],
        "note": "smoke_emitter/headlamp are Blender coords (x, y, z): convert to three as (x, z, -y)"}
root = bpy.data.objects.new("Train", None); coll.objects.link(root)
for o in coll.objects:
    if o is not root: o.parent = root
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "train.blend"))
for o in bpy.data.objects: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT / "train_raw.glb"), export_format="GLB", use_selection=True, export_yup=True, export_apply=True)
(OUT / "train.json").write_text(json.dumps(meta, indent=1)); print("exported", meta["length_m"], "m", len(WHEELS), "wheels", flush=True)
