"""Render one key frame of every clip so the rig and weights can be checked.
python posetest.py <avatar.blend> <out_dir> [clip:frame ...]
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

SRC, OUT = Path(sys.argv[1]), Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(SRC))
scene = bpy.context.scene
arm = bpy.data.objects["AvatarRig"]
keys = bpy.data.objects["head"].data.shape_keys


def srgb(c):
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


world = bpy.data.worlds.new("w")
scene.world = world
world.color = srgb((0.04, 0.032, 0.075))


def light(name, loc, power, color, size):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy, ld.color, ld.size = power, srgb(color), size
    o = bpy.data.objects.new(name, ld)
    scene.collection.objects.link(o)
    o.location = Vector(loc)
    o.rotation_euler = (Vector((0, 0, 1.2)) - o.location).to_track_quat("-Z", "Y").to_euler()


light("key", (-2.0, -3.2, 3.0), 330, (1, .95, .9), 2.2)
light("fill", (2.6, -2.6, 1.6), 110, (.85, .9, 1), 2.5)
light("rim", (2.4, 2.4, 2.6), 220, (.35, .85, .95), 1.5)
light("rim2", (-2.4, 2.6, 2.4), 170, (1, .5, .78), 1.5)
cd = bpy.data.cameras.new("c")
cam = bpy.data.objects.new("c", cd)
scene.collection.objects.link(cam)
scene.camera = cam
scene.render.engine = "CYCLES"
scene.cycles.samples = 16
scene.cycles.use_denoising = True
scene.view_settings.view_transform = "AgX"
scene.render.resolution_x, scene.render.resolution_y = 420, 640

CLIPS = [a for a in sys.argv[3:] if not a.startswith("--")] or ["Idle:30", "Walk:9", "Run:6", "Jump:14", "Wave:20", "Talk:20", "Think:30", "Nod:8", "IdleArmsCrossed:30"]
for spec in CLIPS:
    name, frame = spec.split(":")
    arm.animation_data.action = bpy.data.actions[name]
    keys.animation_data.action = bpy.data.actions[name + "_face"]
    scene.frame_set(int(frame))
    for ang, tag in (((-30, "a"), (-90, "s")) if "--close" not in sys.argv else ((-30, "c"),)):
        a = math.radians(ang)
        t = Vector((0, 0, 0.95)) if "--close" not in sys.argv else Vector((0, -0.1, 1.75))
        dist = 5.2 if "--close" not in sys.argv else 2.0
        cam.location = t + Vector((math.sin(a) * dist, -math.cos(a) * dist, 0.3))
        cam.rotation_euler = (t - cam.location).to_track_quat("-Z", "Y").to_euler()
        cd.lens = 60
        scene.render.filepath = str(OUT / f"{name}_{tag}.png")
        bpy.ops.render.render(write_still=True)
    print("posed", name, flush=True)
