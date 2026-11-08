"""Placeholder export of the town kit: flat material colours, Draco GLB + landmarks manifest.
python export_town.py <town_kit.blend> <out_dir>"""
import bpy, json, math, sys
from pathlib import Path
from mathutils import Vector
SRC, OUT = Path(sys.argv[1]), Path(sys.argv[2]); OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(SRC))
for o in list(bpy.data.objects):
    if o.type == "LIGHT" or o.name in ("haze", "cam"): bpy.data.objects.remove(o)
for m in bpy.data.materials:
    if not m.use_nodes: continue
    nt = m.node_tree; b = nt.nodes.get("Principled BSDF")
    if not b: continue
    cr = next((n for n in nt.nodes if n.type == "VALTORGB"), None)
    if cr:
        e = cr.color_ramp.elements; c = [(e[0].color[i] + e[1].color[i]) / 2 for i in range(3)]
        for l in list(nt.links):
            if l.to_node == b and l.to_socket.name in ("Base Color", "Normal"): nt.links.remove(l)
        b.inputs["Base Color"].default_value = (*c, 1)
def three(v): return [round(v.x, 3), round(v.z, 3), round(-v.y, 3)]
def door(name, local):
    r = bpy.data.objects[name]; return three(r.matrix_world @ Vector(local))
lm = {
 "spawn": {"pos": three(Vector((0.8, -26, 0))), "yaw_deg": 0},
 "office":  {"zone": "about",        "title": "Sheriff's Office",   "door": door("SheriffOffice", (0, -3 - 2.2 - 0.6, 0)), "center": three(bpy.data.objects["SheriffOffice"].location)},
 "bounty":  {"zone": "projects",     "title": "Bounty Board",       "door": three(Vector((-1.2, 20.6, 0))), "center": three(Vector((-1.2, 23, 0)))},
 "smith":   {"zone": "skills",       "title": "Blacksmith's Workshop","door": door("Blacksmith", (0, -3.5 - 2.2 - 0.6, 0)), "center": three(bpy.data.objects["Blacksmith"].location)},
 "bank":    {"zone": "achievements", "title": "The Bank Vault",     "door": door("Bank", (0, -3.25 - 2.2 - 0.6, 0)), "center": three(bpy.data.objects["Bank"].location)},
 "telegraph":{"zone": "contact",     "title": "Telegraph Office",   "door": door("Telegraph", (0, -2.75 - 2.2 - 0.6, 0)), "center": three(bpy.data.objects["Telegraph"].location)},
 "picture": {"zone": "promo",        "title": "The Picture House",  "door": door("PictureHouse", (0, -3.5 - 2.2 - 0.6, 0)), "center": three(bpy.data.objects["PictureHouse"].location)},
 "station": {"zone": "journey",      "title": "Byte Island Station","door": three(Vector((0, 44 - 3.5 - 3.4 - 1.0, 0))), "center": three(Vector((0, 44, 0)))},
 "sheriff_npc": {"zone": "chat",     "title": "The Sheriff",        "door": three(Vector((-5.2, -4.0, 0))), "center": three(Vector((-5.8, -4.0, 0)))},
 "saloon":  {"zone": None, "title": "Saloon (decor)", "center": three(bpy.data.objects["Saloon"].location)},
}
(OUT / "town.json").write_text(json.dumps({"units": "metres, Y up (three.js)", "street_axis": "+Z is NEGATIVE blender Y; street runs from spawn (z=+26) towards the station (z=-44)", "landmarks": lm}, indent=1))
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=str(OUT / "town_placeholder.glb"), export_format="GLB", use_selection=True, export_draco_mesh_compression_enable=True, export_apply=True, export_yup=True)
print("done", (OUT / "town_placeholder.glb").stat().st_size // 1024, "KB")
