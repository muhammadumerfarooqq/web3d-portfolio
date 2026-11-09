"""Bake the town for the web: per-group texture atlas = procedural albedo x ambient occlusion.
python bake.py <town_kit.blend> <out_dir> [--only Group,...] [--size N] [--ao-samples N]
Result: <out_dir>/town.glb (+ town.json landmarks, baked previews of each atlas).
Lighting stays real-time in three.js (day/night), so ONE bake serves both modes.
"""
import bpy, json, math, sys, time
from pathlib import Path
import numpy as np
from mathutils import Vector

A = sys.argv
SRC, OUT = Path(A[1]), Path(A[2]); OUT.mkdir(parents=True, exist_ok=True); (OUT / "atlas").mkdir(exist_ok=True)
ONLY = A[A.index("--only") + 1].split(",") if "--only" in A else None
SIZE = int(A[A.index("--size") + 1]) if "--size" in A else 1024
AOS = int(A[A.index("--ao-samples") + 1]) if "--ao-samples" in A else 48
bpy.ops.wm.open_mainfile(filepath=str(SRC))
sc = bpy.context.scene; sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"
if sc.world: sc.world.light_settings.distance = 0.7
for o in list(bpy.data.objects):            # lights/haze/camera are not part of the web asset
    if o.type in ("LIGHT", "CAMERA") or o.name == "haze": bpy.data.objects.remove(o)

EMISSIVE = {"Window_Warm", "Lantern", "Gold"}
NOBAKE = {"Sand", "Dirt", "Sea", "Water", "Rut", "FlagR", "FlagC", "Rope", "Iron"}   # tiled / shader-driven in three.js
BUILDINGS = ["SheriffOffice", "Blacksmith", "Bank", "Telegraph", "PictureHouse", "Saloon", "Station"]

def mat_of(o):
    return o.material_slots[0].material.name if o.material_slots and o.material_slots[0].material else ""

def bakeable(o):
    return o.type == "MESH" and mat_of(o) not in EMISSIVE and mat_of(o) not in NOBAKE

groups = {}
for b in BUILDINGS:
    root = bpy.data.objects.get(b)
    if root: groups[b] = [c for c in root.children if bakeable(c)]
def by_prefix(name, prefixes):
    return [o for o in bpy.data.objects if o.parent is None and bakeable(o) and o.name.split(".")[0] in prefixes]
groups["Dock"] = by_prefix("Dock", {"dock_deck", "dock_piles", "rowboat", "rowboat_seats"})
groups["Lighthouse"] = by_prefix("Lighthouse", {f"lighthouse_band{i}" for i in range(6)} | {"lighthouse_door", "keeper_hut", "keeper_roof"})
groups["Props"] = by_prefix("Props", {"barrel", "crate", "hitch", "trough", "wagon", "wagon_wheels", "hay", "pole", "cactus",
                                      "bounty_frame", "bounty_panel", "bounty_posters", "platform", "sleepers"})
groups["Rocks"] = by_prefix("Rocks", {"rock", "mesa", "gravel", "scrub"})
if ONLY: groups = {k: v for k, v in groups.items() if k in ONLY}

def select_only(objs, active):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = active

def to_np(img):
    a = np.empty(img.size[0] * img.size[1] * 4, np.float32); img.pixels.foreach_get(a); return a.reshape(img.size[1], img.size[0], 4)

report = {}
for gname, objs in groups.items():
    if not objs: continue
    t0 = time.time()
    keep_parent = objs[0].parent
    select_only(objs, objs[0]); bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active; ob.name = f"{gname}_baked"
    # UVs: one atlas for the whole group
    bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    area = sum(p.area for p in ob.data.polygons)
    size = SIZE if area < 420 else SIZE * 2
    if gname in ("Rocks",): size = SIZE * 2
    alb = bpy.data.images.new(f"{gname}_alb", size, size, alpha=False, float_buffer=True)
    ao = bpy.data.images.new(f"{gname}_ao", size, size, alpha=False, float_buffer=True)
    nodes = []
    for slot in ob.material_slots:
        m = slot.material; nt = m.node_tree
        n = nt.nodes.get("__bake__") or nt.nodes.new("ShaderNodeTexImage"); n.name = "__bake__"
        nt.nodes.active = n; nodes.append(n)
    select_only([ob], ob)
    for n in nodes: n.image = alb
    sc.cycles.samples = 1
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, margin=6, use_clear=True)
    for n in nodes: n.image = ao
    sc.cycles.samples = AOS
    bpy.ops.object.bake(type="AO", margin=6, use_clear=True)
    A_ = to_np(alb); O_ = to_np(ao)
    occl = np.clip(O_[..., :1], 0, 1)
    lin = A_[..., :3] * (0.38 + 0.62 * occl)
    srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(np.clip(lin, 0, None), 1 / 2.4) - 0.055)
    final = A_.copy(); final[..., :3] = srgb; final[..., 3] = 1.0
    print("  stats albedo", float(A_[..., :3].mean()), "ao", float(occl.mean()), "final", float(srgb.mean()), flush=True)
    out = bpy.data.images.new(f"{gname}_atlas", size, size, alpha=False)
    out.pixels.foreach_set(np.clip(final, 0, 1).ravel())
    out.filepath_raw = str(OUT / "atlas" / f"{gname}.jpg"); out.file_format = "JPEG"
    sc.render.image_settings.quality = 88; out.save()
    # swap to ONE baked material per group
    bm_ = bpy.data.materials.new(f"Baked_{gname}"); bm_.use_nodes = True
    nt = bm_.node_tree; bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = out
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.86
    bsdf.inputs["Specular IOR Level"].default_value = 0.25
    ob.data.materials.clear(); ob.data.materials.append(bm_)
    for p in ob.data.polygons: p.material_index = 0
    for n in nodes: n.image = None
    bpy.data.images.remove(alb); bpy.data.images.remove(ao)
    report[gname] = {"size": size, "tris": sum(len(p.vertices) - 2 for p in ob.data.polygons), "area_m2": round(area, 1), "sec": round(time.time() - t0, 1)}
    print("baked", gname, report[gname], flush=True)

bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "town_baked.blend"))
(OUT / "bake_report.json").write_text(json.dumps(report, indent=1))
print("done")
