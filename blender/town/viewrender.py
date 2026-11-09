"""python viewrender.py <blend> <out_dir> <samples> name:x,y,z:tx,ty,tz:lens ..."""
import bpy, sys
from pathlib import Path
from mathutils import Vector
args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
SRC, OUT, SAMP = Path(args[0]), Path(args[1]), int(args[2]); OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(SRC))
sc = bpy.context.scene; cam = sc.camera
sc.cycles.samples = SAMP; sc.render.resolution_x, sc.render.resolution_y = 960, 540
for spec in args[3:]:
    name, loc, tgt, lens = spec.split(":")
    cam.location = Vector([float(v) for v in loc.split(",")]); cam.data.lens = float(lens)
    cam.rotation_euler = (Vector([float(v) for v in tgt.split(",")]) - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = str(OUT / f"{name}.png"); bpy.ops.render.render(write_still=True); print("view", name, flush=True)
