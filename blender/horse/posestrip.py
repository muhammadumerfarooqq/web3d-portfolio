"""python posestrip.py <horse.blend> <out.jpg> Clip:frame ..."""
import bpy, sys, math
from mathutils import Vector
SRC, OUTF = sys.argv[1], sys.argv[2]; specs = sys.argv[3:]
bpy.ops.wm.open_mainfile(filepath=SRC); sc = bpy.context.scene
arm = bpy.data.objects["HorseRig"]
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True; w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.3, 0.32, 0.36, 1)
for nm, loc, e in (("k", (-3, -3, 3), 600), ("f", (3, -2, 2), 250), ("r", (0, 3, 3), 300)):
    L = bpy.data.lights.new(nm, "AREA"); L.energy = e; L.size = 2.5; o = bpy.data.objects.new(nm, L); sc.collection.objects.link(o)
    o.location = loc; o.rotation_euler = (Vector((0, 0, 1)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
cd = bpy.data.cameras.new("c"); cam = bpy.data.objects.new("c", cd); sc.collection.objects.link(cam); sc.camera = cam; cd.lens = 50
cam.location = (5.6, -0.1, 1.2); cam.rotation_euler = (Vector((0, -0.1, 1.0)) - cam.location).to_track_quat("-Z", "Y").to_euler()
sc.render.engine = "CYCLES"; sc.cycles.samples = 8; sc.render.resolution_x, sc.render.resolution_y = 520, 420; sc.view_settings.view_transform = "AgX"
from PIL import Image
ims = []
for i, sp in enumerate(specs):
    n, f = sp.split(":"); arm.animation_data.action = bpy.data.actions[n]; sc.frame_set(int(f))
    sc.render.filepath = f"/tmp/claude-0/hp_{i}.png"; bpy.ops.render.render(write_still=True); ims.append(Image.open(sc.render.filepath).convert("RGB"))
S = Image.new("RGB", (520 * len(ims), 420))
for i, im in enumerate(ims): S.paste(im, (520 * i, 0))
S.save(OUTF, quality=85)
