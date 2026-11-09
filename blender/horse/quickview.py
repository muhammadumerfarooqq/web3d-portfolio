"""python quickview.py <parts_dir> <out_png_prefix>"""
import bpy, sys, math
import numpy as np
from pathlib import Path
from mathutils import Vector
P, OUTP = Path(sys.argv[1]), sys.argv[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
COL = {"horse": (0.36, 0.19, 0.10), "hooves": (0.05, 0.04, 0.04), "mane": (0.03, 0.025, 0.02), "tail": (0.03, 0.025, 0.02),
       "eyes": (0.01, 0.01, 0.01), "saddle": (0.30, 0.15, 0.06), "blanket": (0.55, 0.12, 0.08), "stirrups": (0.6, 0.6, 0.6), "bridle": (0.12, 0.06, 0.03)}
def srgb(c): return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)
for f in sorted(P.glob("*.npz")):
    d = np.load(f); me = bpy.data.meshes.new(f.stem)
    me.from_pydata(d["verts"].tolist(), [], d["faces"].tolist()); me.shade_smooth()
    o = bpy.data.objects.new(f.stem, me); sc.collection.objects.link(o)
    m = bpy.data.materials.new(f.stem); m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*srgb(COL.get(f.stem, (0.5, 0.5, 0.5))), 1)
    m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.5
    me.materials.append(m)
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True; w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.25, 0.27, 0.3, 1)
for nm, loc, e in (("k", (-3, -3, 3), 600), ("f", (3, -2, 2), 250), ("r", (0, 3, 3), 300)):
    L = bpy.data.lights.new(nm, "AREA"); L.energy = e; L.size = 2.5; o = bpy.data.objects.new(nm, L); sc.collection.objects.link(o)
    o.location = loc; o.rotation_euler = (Vector((0, 0, 1)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
cd = bpy.data.cameras.new("c"); cam = bpy.data.objects.new("c", cd); sc.collection.objects.link(cam); sc.camera = cam; cd.lens = 50
sc.render.engine = "CYCLES"; sc.cycles.samples = 12; sc.render.resolution_x, sc.render.resolution_y = 800, 600; sc.view_settings.view_transform = "AgX"
for tag, ang in (("side", -90), ("34", -40), ("front", 0)):
    a = math.radians(ang); t = Vector((0, -0.1, 1.05)); dist = 5.2
    cam.location = t + Vector((math.sin(a) * -dist if ang == -90 else math.sin(a) * dist, -math.cos(a) * dist, 0.4))
    cam.rotation_euler = (t - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = f"{OUTP}_{tag}.png"; bpy.ops.render.render(write_still=True)
