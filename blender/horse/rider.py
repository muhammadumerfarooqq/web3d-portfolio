import bpy, sys, math
from mathutils import Vector
bpy.ops.wm.open_mainfile(filepath="/home/claude/horse/build/horse.blend")
with bpy.data.libraries.load("/home/claude/avatar/rig_v7/avatar.blend") as (src, dst):
    dst.collections = ["Avatar"]; dst.actions = list(src.actions)
sc = bpy.context.scene
for c in dst.collections: sc.collection.children.link(c)
horse = bpy.data.objects["HorseRig"]; rider = bpy.data.objects["AvatarRig"]
OFF = float(sys.argv[sys.argv.index("--off") + 1]) if "--off" in sys.argv else 0.57
rider.parent = horse; rider.parent_type = "BONE"; rider.parent_bone = "spine"
bpy.context.view_layer.update()
# place the rider root so the hips sit on the seat, then let it follow the spine bone
sb = horse.pose.bones["spine"]; Mb = horse.matrix_world @ sb.bone.matrix_local
rider.matrix_parent_inverse = (Mb @ __import__("mathutils").Matrix.Translation((0, 0, 0))).inverted() @ __import__("mathutils").Matrix.Translation((0, 0, 0))
rider.location = (0, 0, 0)
rider.matrix_world = __import__("mathutils").Matrix.Translation((0, 0.02, OFF))
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True; w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.08, 0.06, 0.05, 1)
for nm, loc, e, col in (("k", (-3.5, -3.5, 3.5), 900, (1, .78, .55)), ("f", (3, -2.5, 2), 250, (.7, .8, 1)), ("r", (1.5, 3.5, 3), 700, (1, .6, .3))):
    L = bpy.data.lights.new(nm, "AREA"); L.energy = e; L.size = 2.5; L.color = col; o = bpy.data.objects.new(nm, L); sc.collection.objects.link(o)
    o.location = loc; o.rotation_euler = (Vector((0, 0, 1.2)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
bpy.ops.mesh.primitive_plane_add(size=30); fl = bpy.context.object
m = bpy.data.materials.new("floor"); m.use_nodes = True; m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.32, 0.2, 0.11, 1); fl.data.materials.append(m)
cd = bpy.data.cameras.new("c"); cam = bpy.data.objects.new("c", cd); sc.collection.objects.link(cam); sc.camera = cam; cd.lens = 55
sc.render.engine = "CYCLES"; sc.cycles.samples = 48; sc.cycles.use_denoising = True; sc.view_settings.view_transform = "AgX"; sc.view_settings.look = "AgX - Punchy"
sc.render.resolution_x, sc.render.resolution_y = 1280, 860
for tag, hclip, hf, ang in (("idle", "Idle", 30, -38), ("gallop", "Gallop", 5, -62)):
    horse.animation_data.action = bpy.data.actions[hclip]
    rider.animation_data.action = bpy.data.actions["Ride"]
    for k in [o for o in bpy.data.objects if o.type == "MESH" and o.data.shape_keys]:
        k.data.shape_keys.animation_data_create(); k.data.shape_keys.animation_data.action = bpy.data.actions.get("Ride_face")
    sc.frame_set(hf)
    a = math.radians(ang); t = Vector((0, -0.2, 1.35)); dist = 6.2
    cam.location = t + Vector((math.sin(a) * -dist, -math.cos(a) * dist, 0.5))
    cam.rotation_euler = (t - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = f"/home/claude/horse/rider_{tag}.png"; bpy.ops.render.render(write_still=True); print("rendered", tag, flush=True)
