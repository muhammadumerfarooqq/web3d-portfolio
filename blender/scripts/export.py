"""Export the rigged avatar to a Draco-compressed GLB for Three.js.

python export.py <avatar.blend> <out.glb>
"""
import sys
from pathlib import Path

import bpy

SRC, DST = Path(sys.argv[1]), Path(sys.argv[2])
bpy.ops.wm.open_mainfile(filepath=str(SRC))

# only the avatar collection goes out (no studio lights, floor or camera)
for o in bpy.data.objects:
    o.select_set(o.users_collection and o.users_collection[0].name == "Avatar")

bpy.ops.export_scene.gltf(
    filepath=str(DST),
    export_format="GLB",
    use_selection=True,
    export_apply=False,
    export_skins=True,
    export_morph=True,
    export_morph_normal=False,
    export_animations=True,
    export_animation_mode="NLA_TRACKS",
    export_force_sampling=True,
    export_frame_step=1,
    export_vertex_color="ACTIVE",
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6,
    export_yup=True,
)
print("exported", DST, DST.stat().st_size // 1024, "KB")
