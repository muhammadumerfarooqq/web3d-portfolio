"""Two oars for the rowboat. Each oar's origin is its oarlock pivot; the oar lies along local +X (blade outboard)
for Oar_L and -X for Oar_R. python oars.py <out_dir>"""
import bpy, bmesh, math, sys
from pathlib import Path
from mathutils import Matrix
OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True); sc = bpy.context.scene
def srgb(c): return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)
m = bpy.data.materials.new("Oar_Wood"); m.use_nodes = True; b = m.node_tree.nodes["Principled BSDF"]
b.inputs["Base Color"].default_value = (*srgb((0.52, 0.34, 0.18)), 1); b.inputs["Roughness"].default_value = 0.7
mi = bpy.data.materials.new("Oarlock_Iron"); mi.use_nodes = True; bi = mi.node_tree.nodes["Principled BSDF"]
bi.inputs["Base Color"].default_value = (*srgb((0.08, 0.08, 0.09)), 1); bi.inputs["Metallic"].default_value = 0.8; bi.inputs["Roughness"].default_value = 0.45
def oar(name, sign):
    bm = bmesh.new()
    sh = bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.025, radius2=0.022, depth=2.2)           # shaft
    bmesh.ops.transform(bm, matrix=Matrix.Translation((0.35, 0, 0)) @ Matrix.Rotation(math.pi / 2, 4, "Y"), verts=sh["verts"])
    hd = bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.03, radius2=0.03, depth=0.30)            # handle grip
    bmesh.ops.transform(bm, matrix=Matrix.Translation((-0.82, 0, 0)) @ Matrix.Rotation(math.pi / 2, 4, "Y"), verts=hd["verts"])
    bl = bmesh.ops.create_cube(bm, size=1.0)                                                                       # blade
    bmesh.ops.transform(bm, matrix=Matrix.Translation((1.62, 0, 0)) @ Matrix.Diagonal((0.62, 0.012, 0.16, 1)), verts=bl["verts"])
    if sign < 0: bmesh.ops.transform(bm, matrix=Matrix.Scale(-1, 4, (1, 0, 0)), verts=bm.verts); bmesh.ops.reverse_faces(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    o = bpy.data.objects.new(name, me); sc.collection.objects.link(o); me.materials.append(m)
    bm = bmesh.new(); r = bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.035, radius2=0.035, depth=0.12)
    bmesh.ops.translate(bm, vec=(0, 0, -0.03), verts=r["verts"])
    me2 = bpy.data.meshes.new(name + "_lock"); bm.to_mesh(me2); bm.free()
    lk = bpy.data.objects.new(name + "_lock", me2); sc.collection.objects.link(lk); me2.materials.append(mi)
    return o, lk
oar("Oar_L", 1); oar("Oar_R", -1)
for o in bpy.data.objects: o.select_set(True)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "oars.blend"))
bpy.ops.export_scene.gltf(filepath=str(OUT / "oars_raw.glb"), export_format="GLB", use_selection=True, export_yup=True)
print("ok")
