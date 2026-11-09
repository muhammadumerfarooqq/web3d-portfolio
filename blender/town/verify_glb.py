"""Re-import the exported GLB into an empty scene and render it with plain lighting.
This approximates what three.js receives (no post-processing): python verify_glb.py <glb> <out_dir> [--night]"""
import bpy, math, sys
from pathlib import Path
from mathutils import Vector
GLB, OUT = Path(sys.argv[1]), Path(sys.argv[2]); OUT.mkdir(parents=True, exist_ok=True)
NIGHT = "--night" in sys.argv
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(GLB))
sc = bpy.context.scene; sc.render.engine = "CYCLES"; sc.cycles.samples = 16; sc.cycles.use_denoising = True
sc.view_settings.view_transform = "AgX"; sc.view_settings.look = "AgX - High Contrast"
sc.render.resolution_x, sc.render.resolution_y = 1280, 720
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.03, 0.04, 0.09, 1) if NIGHT else (0.55, 0.62, 0.78, 1)
w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.25 if NIGHT else 0.9
sun = bpy.data.lights.new("s", "SUN"); sun.energy = 0.8 if NIGHT else 4.5; sun.color = (0.45, 0.6, 1) if NIGHT else (1, 0.62, 0.36)
so = bpy.data.objects.new("s", sun); sc.collection.objects.link(so)
d = Vector((-0.5, -0.45, 0.74)) if NIGHT else Vector((0.5 * math.cos(0.1), -0.87 * math.cos(0.1), 0.12))
so.rotation_euler = (-d.normalized()).to_track_quat("-Z", "Y").to_euler()
if NIGHT:   # what three.js will do with emissive + pooled point lights
    for m in bpy.data.materials:
        if m.node_tree and "Principled BSDF" in m.node_tree.nodes:
            b = m.node_tree.nodes["Principled BSDF"]
            if m.name in ("Lantern", "Window_Warm", "Gold"):
                b.inputs["Emission Strength"].default_value = {"Lantern": 40, "Window_Warm": 6, "Gold": 4}[m.name]
    for o in [o for o in bpy.data.objects if o.name.startswith(("lamp", "dock_lamp", "lighthouse_lamp")) or "_lantern" in o.name]:
        L = bpy.data.lights.new("p", "POINT"); L.energy = 400; L.color = (1, 0.58, 0.24)
        lo = bpy.data.objects.new("p", L); sc.collection.objects.link(lo)
        lo.location = o.matrix_world.translation + Vector((0, 0, -0.3))
cd = bpy.data.cameras.new("c"); cam = bpy.data.objects.new("c", cd); sc.collection.objects.link(cam); sc.camera = cam
VIEWS = {"street": ((0.8, -24, 1.7), (0, 14, 2.8), 30), "porch": ((-2.8, -10.5, 1.7), (-9.0, 0.5, 2.8), 28), "dock": ((9.0, -52.0, 3.2), (-2.0, -22.0, 3.0), 28)}
tag = "night" if NIGHT else "day"
for name, (loc, tgt, lens) in VIEWS.items():
    # GLB is Y-up; the importer converts back to Blender Z-up, so Blender coordinates still apply
    cam.location = Vector(loc); cd.lens = lens
    cam.rotation_euler = (Vector(tgt) - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = str(OUT / f"glb_{tag}_{name}.png"); bpy.ops.render.render(write_still=True); print("view", name, flush=True)
