"""Sheriff of Byte Island - western town kit, built 100% by script in Blender 5.2.
python kit.py <out_dir> [--samples N]   (preview renders of the street)
Everything is procedural: planks, trim, props, terrain. No imported assets.
"""
import math, random, sys
from pathlib import Path
import bpy, bmesh
from mathutils import Vector, Matrix

OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
SAMPLES = int(sys.argv[sys.argv.index("--samples") + 1]) if "--samples" in sys.argv else 32
random.seed(7)
NIGHT = "--night" in sys.argv
TAG = "night" if NIGHT else "day"
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
coll = scene.collection

def srgb(c):
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)

# ------------------------------------------------------------ materials
def mat_wood(name, dark, light, rough=0.85, scale=9.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes["Principled BSDF"]
    tc = nt.nodes.new("ShaderNodeTexCoord"); mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (scale, scale, 1.6)
    nz = nt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 3.0; nz.inputs["Detail"].default_value = 8.0
    cr = nt.nodes.new("ShaderNodeValToRGB")
    cr.color_ramp.elements[0].color = (*srgb(dark), 1); cr.color_ramp.elements[1].color = (*srgb(light), 1)
    bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.25
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"]); nt.links.new(mp.outputs["Vector"], nz.inputs["Vector"])
    nt.links.new(nz.outputs["Fac"], cr.inputs["Fac"]); nt.links.new(cr.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(nz.outputs["Fac"], bump.inputs["Height"]); nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    b.inputs["Roughness"].default_value = rough
    return m

def mat_flat(name, col, rough=0.7, metal=0.0, emit=None, strength=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*srgb(col), 1)
    b.inputs["Roughness"].default_value = rough; b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*srgb(emit), 1); b.inputs["Emission Strength"].default_value = strength
    return m

def mat_ground(name, a, b_, scale=2.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes["Principled BSDF"]
    nz = nt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = scale * 6; nz.inputs["Detail"].default_value = 10
    nz2 = nt.nodes.new("ShaderNodeTexNoise"); nz2.inputs["Scale"].default_value = scale * 0.5
    mix = nt.nodes.new("ShaderNodeMath"); mix.operation = "MULTIPLY_ADD"; mix.inputs[1].default_value = 0.5; mix.inputs[2].default_value = 0.25
    nt.links.new(nz2.outputs["Fac"], mix.inputs[0])
    cr = nt.nodes.new("ShaderNodeValToRGB")
    cr.color_ramp.elements[0].color = (*srgb(a), 1); cr.color_ramp.elements[1].color = (*srgb(b_), 1)
    add = nt.nodes.new("ShaderNodeMath"); add.operation = "ADD"
    nt.links.new(nz.outputs["Fac"], add.inputs[0]); nt.links.new(mix.outputs["Value"], add.inputs[1])
    nt.links.new(add.outputs["Value"], cr.inputs["Fac"]); nt.links.new(cr.outputs["Color"], b.inputs["Base Color"])
    bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.6; bump.inputs["Distance"].default_value = 0.05
    nt.links.new(nz.outputs["Fac"], bump.inputs["Height"]); nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    b.inputs["Roughness"].default_value = 0.95
    return m

M = {
  "wood_a": mat_wood("Wood_Weathered", (0.20, 0.12, 0.07), (0.42, 0.28, 0.16)),
  "wood_b": mat_wood("Wood_Grey", (0.22, 0.19, 0.16), (0.46, 0.41, 0.34)),
  "wood_c": mat_wood("Wood_Red", (0.30, 0.10, 0.06), (0.55, 0.22, 0.12)),
  "wood_d": mat_wood("Wood_Dark", (0.10, 0.07, 0.05), (0.24, 0.16, 0.10)),
  "paint": mat_flat("Trim_Cream", (0.80, 0.72, 0.55), 0.8),
  "roof": mat_wood("Roof_Shingle", (0.14, 0.09, 0.07), (0.30, 0.20, 0.14), 0.9, 14),
  "glass": mat_flat("Window_Warm", (0.10, 0.07, 0.04), 0.1, emit=(1.0, 0.62, 0.22), strength=2.2),
  "dark": mat_flat("Interior_Dark", (0.02, 0.015, 0.012), 0.9),
  "iron": mat_flat("Iron", (0.07, 0.07, 0.075), 0.5, 1.0),
  "gold": mat_flat("Gold", (0.95, 0.68, 0.22), 0.25, 1.0, emit=(1.0, 0.62, 0.20), strength=(5.0 if NIGHT else 1.2)),
  "lantern": mat_flat("Lantern", (0.3, 0.2, 0.1), 0.3, emit=(1.0, 0.55, 0.15), strength=14),
  "cactus": mat_flat("Cactus", (0.16, 0.30, 0.17), 0.75),
  "rock": mat_ground("Rock", (0.34, 0.24, 0.17), (0.62, 0.45, 0.31), 1.4),
  "dirt": mat_ground("Dirt", (0.50, 0.34, 0.20), (0.78, 0.58, 0.38), 1.0),
  "sand": mat_ground("Sand", (0.62, 0.45, 0.28), (0.88, 0.70, 0.46), 0.7),
  "hay": mat_wood("Hay", (0.55, 0.42, 0.14), (0.86, 0.70, 0.30), 0.95, 22),
  "mesa": mat_ground("Mesa", (0.38, 0.17, 0.10), (0.74, 0.38, 0.20), 0.5),
  "water": mat_flat("Water", (0.04, 0.22, 0.30), 0.08),
  "sea": mat_flat("Sea", (0.02, 0.16, 0.24), 0.05),
  "rut": mat_flat("Rut", (0.40, 0.26, 0.16), 0.95),
  "scrub": mat_wood("Scrub", (0.25, 0.28, 0.10), (0.55, 0.50, 0.22), 0.95, 12),
  "flag_r": mat_flat("FlagR", (0.55, 0.08, 0.05), 0.9), "flag_c": mat_flat("FlagC", (0.85, 0.74, 0.5), 0.9),
}

# ------------------------------------------------------------ geometry helpers
def new_obj(name, bm, mat, loc=(0, 0, 0), rz=0.0):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); coll.objects.link(o)
    o.location = loc; o.rotation_euler = (0, 0, rz); o.data.materials.append(mat)
    for p in me.polygons: p.use_smooth = False
    return o

def box(bm, c, s, rz=0.0, rx=0.0, ry=0.0):
    r = bmesh.ops.create_cube(bm, size=1.0)
    m = Matrix.Translation(c) @ Matrix.Rotation(rz, 4, "Z") @ Matrix.Rotation(ry, 4, "Y") @ Matrix.Rotation(rx, 4, "X") @ Matrix.Diagonal((*s, 1))
    bmesh.ops.transform(bm, matrix=m, verts=r["verts"])

def cyl(bm, c, r, h, seg=14, axis="Z"):
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=h)
    R = {"Z": Matrix.Identity(4), "X": Matrix.Rotation(math.pi / 2, 4, "Y"), "Y": Matrix.Rotation(math.pi / 2, 4, "X")}[axis]
    bmesh.ops.transform(bm, matrix=Matrix.Translation(c) @ R, verts=res["verts"])

def boards(bm, x0, x1, y, z0, z1, bw=0.20, depth=0.06, jitter=0.012, axis="X"):
    """vertical planks along X at fixed y; each one slightly different in height/offset."""
    n = max(1, int(round((x1 - x0) / bw))); w = (x1 - x0) / n
    for i in range(n):
        h = (z1 - z0) + random.uniform(-0.03, 0.03)
        zc = z0 + (z1 - z0) / 2 + random.uniform(-0.015, 0.015)
        box(bm, Vector((x0 + w * (i + 0.5), y + random.uniform(-jitter, jitter), zc)), (w * 0.94, depth, h), rz=random.uniform(-0.004, 0.004))

# ------------------------------------------------------------ building
def building(name, w, d, h, extra, wood, side, sign, porch=2.2, accent="wood_d", extras=()):
    """Faces -Y in local space. Returns list of objects."""
    objs = []
    bm = bmesh.new()
    # front wall (planks), full false-front height
    boards(bm, -w / 2, w / 2, -d / 2, 0.25, h + extra)
    # side + back walls
    for sx in (-1, 1):
        for k in range(int(d / 0.2)):
            box(bm, Vector((sx * w / 2, -d / 2 + 0.1 + k * 0.2, (h + 0.25) / 2)), (0.06, 0.19, h - 0.25 + random.uniform(-0.03, 0.03)))
    for i in range(int(w / 0.2)):
        box(bm, Vector((-w / 2 + 0.1 + i * 0.2, d / 2, (h + 0.25) / 2)), (0.19, 0.06, h - 0.25))
    # foundation posts
    for sx in (-1, 1):
        for sy in (-1, 0, 1):
            box(bm, Vector((sx * w / 2, sy * d / 2.4, 0.12)), (0.26, 0.26, 0.5))
    objs.append(new_obj(name + "_walls", bm, M[wood]))

    # trim / cornice
    bm = bmesh.new()
    box(bm, Vector((0, -d / 2 - 0.05, h + extra + 0.12)), (w + 0.35, 0.28, 0.24))
    box(bm, Vector((0, -d / 2 - 0.10, h + extra + 0.30)), (w + 0.55, 0.14, 0.12))
    for sx in (-1, 1):
        box(bm, Vector((sx * (w / 2 - 0.05), -d / 2 - 0.06, (h + extra) / 2 + 0.1)), (0.18, 0.10, h + extra - 0.1))
    box(bm, Vector((0, -d / 2 - 0.05, 0.28)), (w, 0.12, 0.12))
    objs.append(new_obj(name + "_trim", bm, M["paint"]))

    # roof: pitched, ridge along depth, shingle rows; back gable filled with boards
    bm = bmesh.new(); th = 0.20; hw = w / 2 + 0.35
    pw = hw / math.cos(th)
    for sx in (-1, 1):
        cxp = sx * hw / 2
        box(bm, Vector((cxp, 0.1, h + 0.14 + (hw / 2) * math.tan(th))), (pw, d + 0.9, 0.09), ry=sx * th)
    for k in range(int((d + 0.9) / 0.34)):
        for sx in (-1, 1):
            box(bm, Vector((sx * hw / 2, -d / 2 - 0.30 + k * 0.34 + 0.1, h + 0.19 + (hw / 2) * math.tan(th))), (pw, 0.025, 0.05), ry=sx * th)
    box(bm, Vector((0, 0.1, h + 0.14 + hw * math.tan(th) + 0.04)), (0.22, d + 0.95, 0.14))
    objs.append(new_obj(name + "_roof", bm, M["roof"]))
    bm = bmesh.new()
    rise = hw * math.tan(th)
    nb = int(w / 0.2)
    for i in range(nb):
        x = -w / 2 + 0.1 + i * 0.2
        hh = max(0.1, (rise + 0.1) * (1 - abs(x) / (w / 2 + 0.2)))
        box(bm, Vector((x, d / 2 + 0.02, h + 0.1 + hh / 2)), (0.19, 0.05, hh))
    # chimney
    box(bm, Vector((w * 0.28, d * 0.18, h + 1.1)), (0.7, 0.7, 2.0)); box(bm, Vector((w * 0.28, d * 0.18, h + 2.15)), (0.85, 0.85, 0.14))
    objs.append(new_obj(name + "_gable", bm, M[wood]))

    # porch
    bm = bmesh.new()
    box(bm, Vector((0, -d / 2 - porch / 2, 0.22)), (w + 0.5, porch, 0.16))
    for k in range(int((w + 0.5) / 0.22)):
        box(bm, Vector((-(w + 0.5) / 2 + 0.11 + k * 0.22, -d / 2 - porch / 2, 0.30)), (0.20, porch - 0.05, 0.02 + random.uniform(0, 0.01)))
    for sx in (-1, 1):
        for fx in (0.0, 0.5):
            px = sx * (w / 2 - 0.05 - fx * 0.0) if fx == 0 else sx * (w / 4)
            box(bm, Vector((sx * (w / 2 + 0.1), -d / 2 - porch + 0.12, (h * 0.6) / 2 + 0.2)), (0.14, 0.14, h * 0.6))
    box(bm, Vector((0, -d / 2 - porch + 0.12, h * 0.6 + 0.26)), (w + 0.6, 0.18, 0.16))
    # steps
    box(bm, Vector((0, -d / 2 - porch - 0.22, 0.10)), (1.4, 0.44, 0.12))
    objs.append(new_obj(name + "_porch", bm, M["wood_b" if wood != "wood_b" else "wood_a"]))
    bm = bmesh.new()  # porch roof (sloped awning)
    awning = bpy.data.objects
    box(bm, Vector((0, -d / 2 - porch / 2 - 0.1, h * 0.6 + 0.5)), (w + 0.9, porch + 0.5, 0.08), rx=0.20)
    objs.append(new_obj(name + "_awning", bm, M["roof"]))

    # door + windows (dark recess + glowing glass)
    bm = bmesh.new(); bg = bmesh.new()
    box(bm, Vector((0, -d / 2 - 0.07, 1.05)), (1.05, 0.05, 1.95))
    for sx in (-1, 1):
        wx = sx * w * 0.30
        box(bm, Vector((wx, -d / 2 - 0.07, 1.35)), (1.0, 0.05, 1.15))
        box(bg, Vector((wx, -d / 2 - 0.095, 1.35)), (0.82, 0.02, 0.97))
        if h > 3.4:
            box(bm, Vector((wx, -d / 2 - 0.07, 3.2)), (0.8, 0.05, 0.9))
            box(bg, Vector((wx, -d / 2 - 0.095, 3.2)), (0.64, 0.02, 0.74))
    objs.append(new_obj(name + "_openings", bm, M["dark"]))
    objs.append(new_obj(name + "_glass", bg, M["glass"]))
    # window mullions
    bm = bmesh.new()
    for sx in (-1, 1):
        wx = sx * w * 0.30
        box(bm, Vector((wx, -d / 2 - 0.115, 1.35)), (0.05, 0.03, 1.0)); box(bm, Vector((wx, -d / 2 - 0.115, 1.35)), (0.85, 0.03, 0.05))
    box(bm, Vector((0, -d / 2 - 0.10, 1.05)), (0.05, 0.03, 1.9))
    objs.append(new_obj(name + "_frames", bm, M["paint"]))

    # sign board + text
    bm = bmesh.new()
    box(bm, Vector((0, -d / 2 - 0.12, h + extra * 0.55)), (w * 0.82, 0.10, 0.62 + extra * 0.12))
    objs.append(new_obj(name + "_sign", bm, M[accent]))
    cu = bpy.data.curves.new(name + "_txt", "FONT"); cu.body = sign; cu.extrude = 0.015; cu.size = 0.34 + extra * 0.05
    cu.align_x = "CENTER"; cu.align_y = "CENTER"
    to = bpy.data.objects.new(name + "_txt", cu); coll.objects.link(to)
    to.rotation_euler = (math.pi / 2, 0, 0); to.location = (0, -d / 2 - 0.19, h + extra * 0.55)
    dg = bpy.context.evaluated_depsgraph_get(); ev = to.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    tm = bpy.data.objects.new(name + "_text", me); coll.objects.link(tm)
    tm.matrix_world = to.matrix_world.copy(); tm.data.materials.append(M["gold"])
    bpy.data.objects.remove(to)
    objs.append(tm)
    # balcony rail on the awning (tall buildings), shutters, hanging blade sign
    bm = bmesh.new()
    if h > 3.8:
        zb = h * 0.6 + 0.62
        for k in range(int((w + 0.9) / 0.32) + 1):
            box(bm, Vector((-(w + 0.9) / 2 + k * 0.32, -d / 2 - porch - 0.30, zb + 0.35)), (0.05, 0.05, 0.7))
        box(bm, Vector((0, -d / 2 - porch - 0.30, zb + 0.72)), (w + 0.95, 0.09, 0.07))
    for sx in (-1, 1):
        wx = sx * w * 0.30
        for sj in (-1, 1):
            box(bm, Vector((wx + sj * 0.64, -d / 2 - 0.13, 1.35)), (0.36, 0.05, 1.17))
    box(bm, Vector((-w / 2 - 0.1, -d / 2 - porch + 0.2, h * 0.6 - 0.1)), (0.04, 0.9, 0.04))
    box(bm, Vector((-w / 2 - 0.1, -d / 2 - porch + 0.55, h * 0.6 - 0.45)), (0.04, 0.8, 0.5))
    objs.append(new_obj(name + "_details", bm, M["wood_d"]))
    # side windows, side door, loose boards (wear), corner posts, lean-to
    bm = bmesh.new(); bg = bmesh.new(); bw = bmesh.new()
    for sx in (-1, 1):
        for k, fy in enumerate((0.0, 0.34, 0.64, 0.86)[:3]):
            yy = -d / 2 + d * (0.22 + 0.3 * k)
            box(bm, Vector((sx * (w / 2 + 0.045), yy, 1.45)), (0.05, 0.85, 1.15))
            box(bg, Vector((sx * (w / 2 + 0.07), yy, 1.45)), (0.02, 0.68, 0.98))
            box(bw, Vector((sx * (w / 2 + 0.085), yy, 1.45)), (0.03, 0.04, 1.0)); box(bw, Vector((sx * (w / 2 + 0.085), yy, 1.45)), (0.03, 0.70, 0.04))
            if h > 3.8:
                box(bm, Vector((sx * (w / 2 + 0.045), yy, 3.15)), (0.05, 0.75, 0.95)); box(bg, Vector((sx * (w / 2 + 0.07), yy, 3.15)), (0.02, 0.58, 0.78))
        for k in range(14):
            box(bw, Vector((sx * (w / 2 + 0.07 + random.uniform(0, 0.03)), -d / 2 + random.uniform(0.3, d - 0.3), random.uniform(0.6, h - 0.4))),
                (0.04, random.uniform(0.25, 0.6), 0.11), rx=random.uniform(-0.1, 0.1))
    for cx in (-1, 1):
        for cy in (-d / 2, d / 2):
            box(bw, Vector((cx * (w / 2 + 0.06), cy, (h + 0.25) / 2)), (0.2, 0.2, h - 0.2))
    objs.append(new_obj(name + "_sideopen", bm, M["dark"])); objs.append(new_obj(name + "_sideglass", bg, M["glass"]))
    objs.append(new_obj(name + "_wear", bw, M["wood_d" if wood != "wood_d" else "wood_a"]))
    bm = bmesh.new()   # lean-to shed on the left side
    box(bm, Vector((-w / 2 - 1.1, d * 0.12, 1.5)), (2.2, d * 0.5, 0.09), ry=0.18)
    for k in range(int(d * 0.5 / 0.2)):
        box(bm, Vector((-w / 2 - 2.2, d * 0.12 - d * 0.25 + 0.1 + k * 0.2, 0.9)), (0.06, 0.19, 1.6))
    for yy in (-d * 0.13, d * 0.37): box(bm, Vector((-w / 2 - 2.15, d * 0.12 + (yy + d * 0.13) * 0, 0.9)) + Vector((0, yy, 0)) * 0.0, (0.14, 0.14, 1.8))
    objs.append(new_obj(name + "_leanto", bm, M["wood_d"]))
    # lantern on porch post
    bm = bmesh.new(); cyl(bm, Vector((w / 2 + 0.1, -d / 2 - porch + 0.35, h * 0.6 - 0.15)), 0.09, 0.22, 8)
    objs.append(new_obj(name + "_lantern", bm, M["lantern"]))
    for lx in (w / 2 + 0.1, -w / 2 - 0.1):
        pl = bpy.data.lights.new(name + "_pl", "POINT"); pl.energy = 150; pl.color = (1.0, 0.58, 0.24); pl.shadow_soft_size = 0.2
        lo = bpy.data.objects.new(name + "_pl", pl); coll.objects.link(lo); lo.location = (lx, -d / 2 - porch + 0.35, h * 0.6 - 0.15); lo.parent = None; objs.append(lo)
    pa = bpy.data.lights.new(name + "_win", "AREA"); pa.energy = 140; pa.color = (1, 0.6, 0.25); pa.size = 2.4
    wo_ = bpy.data.objects.new(name + "_win", pa); coll.objects.link(wo_); wo_.location = (0, -d / 2 - 1.6, 1.6); wo_.rotation_euler = (math.pi / 2, 0, 0); objs.append(wo_)
    # parent under an empty
    root = bpy.data.objects.new(name, None); coll.objects.link(root)
    for o in objs:
        o.parent = root
    root.rotation_euler = (0, 0, math.radians(90 if side < 0 else -90))
    return root

# ------------------------------------------------------------ props
def barrel(c):
    bm = bmesh.new(); cyl(bm, Vector((0, 0, 0.45)), 0.30, 0.9, 16)
    for z in (0.18, 0.72): cyl(bm, Vector((0, 0, z)), 0.325, 0.05, 16)
    o = new_obj("barrel", bm, M["wood_a"], c); return o

def crate(c, s=0.7, rz=0.0):
    bm = bmesh.new(); box(bm, Vector((0, 0, s / 2)), (s, s, s))
    o = new_obj("crate", bm, M["wood_b"], c, rz); return o

def post_rail(c, rz=0.0):
    bm = bmesh.new()
    for x in (-0.9, 0.9): box(bm, Vector((x, 0, 0.6)), (0.12, 0.12, 1.2))
    box(bm, Vector((0, 0, 1.0)), (2.0, 0.09, 0.09)); box(bm, Vector((0, 0, 0.7)), (2.0, 0.08, 0.08))
    return new_obj("hitch", bm, M["wood_d"], c, rz)

def trough(c, rz=0.0):
    bm = bmesh.new(); box(bm, Vector((0, 0, 0.35)), (2.0, 0.6, 0.5))
    o = new_obj("trough", bm, M["wood_a"], c, rz)
    bm = bmesh.new(); box(bm, Vector((0, 0, 0.55)), (1.8, 0.45, 0.04)); new_obj("trough_w", bm, M["water"], c, rz)
    return o

def lamp_post(c):
    bm = bmesh.new(); cyl(bm, Vector((0, 0, 1.4)), 0.07, 2.8, 8); box(bm, Vector((0.35, 0, 2.7)), (0.8, 0.06, 0.06))
    new_obj("lamp_post", bm, M["iron"], c)
    bm = bmesh.new(); cyl(bm, Vector((0.7, 0, 2.55)), 0.13, 0.32, 8); new_obj("lamp", bm, M["lantern"], c)
    pl = bpy.data.lights.new("lampL", "POINT"); pl.energy = 220; pl.color = (1, 0.6, 0.25); pl.shadow_soft_size = 0.25
    lo = bpy.data.objects.new("lampL", pl); coll.objects.link(lo); lo.location = Vector(c) + Vector((0.7, 0, 2.55))

def cactus(c, h=1.6):
    bm = bmesh.new(); cyl(bm, Vector((0, 0, h / 2)), 0.16, h, 10)
    for sx, z in ((-1, 0.8 * h), (1, 0.6 * h)):
        cyl(bm, Vector((sx * 0.30, 0, z)), 0.09, 0.5, 8); cyl(bm, Vector((sx * 0.20, 0, z - 0.2)), 0.07, 0.4, 8, "X")
    return new_obj("cactus", bm, M["cactus"], c, random.uniform(0, 6))

def rock(c, s=1.0):
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=3, radius=s)
    for v in bm.verts:
        v.co *= 1 + random.uniform(-0.18, 0.18); v.co.z *= 0.62
    return new_obj("rock", bm, M["rock"], c, random.uniform(0, 6))

def wagon_wheel(c, rz):
    bm = bmesh.new(); r = 0.55
    for k in range(10):
        a = k * math.pi / 5; box(bm, Vector((0, 0, r)), (0.06, 0.05, r * 2), ry=0, rx=0)
    return None

# ------------------------------------------------------------ terrain (street along Y, x = 0)
def terrain():
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=180, y_segments=180, size=60)
    nz = bpy.data.textures.new("tn", "CLOUDS"); nz.noise_scale = 7.0
    for v in bm.verts:
        x, y = v.co.x, v.co.y
        hill = (math.sin(x * 0.07) * math.cos(y * 0.05) + 1) * 0.5
        d = max(0.0, abs(x) - 7.0) / 20.0
        base = min(1.0, d) ** 1.4 * (0.4 + 2.0 * nz.evaluate((x * 0.5, y * 0.5, 0))[3] + 1.5 * hill)
        rr_ = math.hypot(x * 0.85, y - 12)
        fall = min(1.0, max(0.0, (rr_ - 36.0) / 22.0))
        rip = min(1.0, d) * (0.16 * math.sin(0.9 * x + 0.35 * y) + 0.10 * math.sin(0.5 * y + 0.2 * x) + 0.06 * math.sin(2.3 * x))
        v.co.z = (base + rip) * (1 - fall) - 3.2 * fall ** 1.5
    o = new_obj("ground", bm, M["sand"])
    for p in o.data.polygons: p.use_smooth = True
    bm = bmesh.new(); res = bmesh.ops.create_circle(bm, cap_ends=True, cap_tris=False, segments=64, radius=900)
    for v in bm.verts: v.co.z = -0.55
    new_obj("sea", bm, M["sea"], (0, 12, 0))
    rg = random.Random(11)
    bm = bmesh.new()      # wheel ruts + gravel + scrub
    for sx in (-1.6, -0.9, 0.9, 1.6): box(bm, Vector((sx, 12, 0.05)), (0.30, 62, 0.02))
    new_obj("ruts", bm, M["rut"])
    bm = bmesh.new()
    for i in range(900):
        x = rg.uniform(-9, 9) if rg.random() < 0.7 else rg.choice((-1, 1)) * rg.uniform(7, 24)
        y = rg.uniform(-26, 36)
        r = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=rg.uniform(0.04, 0.12))
        bmesh.ops.transform(bm, matrix=Matrix.Translation((x, y, 0.05)) @ Matrix.Diagonal((1, 1, 0.6, 1)), verts=r["verts"])
    new_obj("gravel", bm, M["rock"])
    bm = bmesh.new()
    for i in range(70):
        x = rg.choice((-1, 1)) * rg.uniform(11, 30); y = rg.uniform(-24, 38)
        for k in range(5):
            r = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=rg.uniform(0.25, 0.55))
            bmesh.ops.transform(bm, matrix=Matrix.Translation((x + rg.uniform(-0.5, 0.5), y + rg.uniform(-0.5, 0.5), 0.35)) @ Matrix.Diagonal((1, 1, 0.7, 1)), verts=r["verts"])
    new_obj("scrub", bm, M["scrub"])
    bm = bmesh.new()  # main street (flat dirt strip)
    box(bm, Vector((0, 0, 0.02)), (9.0, 70.0, 0.06))
    new_obj("street", bm, M["dirt"])

terrain()
def mesas():
    rnd = random.Random(3)
    for k in range(11):
        ang = math.radians(-95 + k * 19 + rnd.uniform(-6, 6)); dist = rnd.uniform(40, 58)
        cx, cy = math.sin(ang) * dist, 12 + math.cos(ang) * dist
        bm = bmesh.new(); r = rnd.uniform(4.5, 9.5); z = -1.8; layers = rnd.randint(4, 7)
        for L in range(layers):
            hgt = rnd.uniform(1.6, 3.0); r *= rnd.uniform(0.78, 0.98)
            res = bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=r * 1.06, radius2=r, depth=hgt)
            for v in res["verts"]:
                v.co.x *= 1 + rnd.uniform(-0.16, 0.16); v.co.y *= 1 + rnd.uniform(-0.16, 0.16)
            bmesh.ops.translate(bm, vec=(0, 0, z + hgt / 2), verts=res["verts"]); z += hgt * 0.96
        o = new_obj("mesa", bm, M["mesa"], (cx, cy, 0))
def outcrops():
    rnd = random.Random(5)
    for c in ((-17, -18), (19, -16), (-24, 12), (24, 22), (-14, 34), (13, 36), (30, 2), (-30, -2)):
        for k in range(rnd.randint(4, 7)):
            rock((c[0] + rnd.uniform(-3, 3), c[1] + rnd.uniform(-3, 3), 0.3), rnd.uniform(0.8, 2.6))
mesas(); outcrops()

# ------------------------------------------------------------ the town
building("SheriffOffice", 7.0, 6.0, 3.6, 1.0, "wood_b", -1, "SHERIFF", accent="wood_d")
building("Blacksmith", 6.5, 7.0, 3.4, 0.7, "wood_d", -1, "BLACKSMITH", accent="wood_b")
building("Bank", 7.5, 6.5, 4.0, 1.4, "wood_a", -1, "BANK", accent="wood_d")
building("Telegraph", 6.0, 5.5, 3.4, 0.9, "wood_c", 1, "TELEGRAPH", accent="wood_d")
building("PictureHouse", 8.0, 7.0, 4.2, 1.6, "wood_a", 1, "PICTURE HOUSE", accent="wood_c")
building("Saloon", 8.5, 7.0, 4.2, 1.2, "wood_b", 1, "SALOON", accent="wood_d")
LAY = {"SheriffOffice": (-1, -6.0, 7.0), "Blacksmith": (-1, 2.0, 6.5), "Bank": (-1, 10.2, 7.5),
       "Telegraph": (1, -6.0, 6.0), "PictureHouse": (1, 1.0, 8.0), "Saloon": (1, 10.5, 8.5)}
for n, (sd, y, ww) in LAY.items():
    o = bpy.data.objects[n]; o.location = (sd * 8.6, y + ww / 2, 0.0)

# hay, wagon, telegraph poles with wires
def hay(c, rz=0.0):
    bm = bmesh.new()
    for i in range(3): box(bm, Vector((i * 0.0, 0, 0.2 + i * 0.4)), (0.9 - i * 0.15, 0.5, 0.38), rz=0.1 * i)
    return new_obj("hay", bm, M["hay"], c, rz)
def wagon(c, rz=0.0):
    bm = bmesh.new(); box(bm, Vector((0, 0, 0.85)), (2.6, 1.3, 0.12))
    for sy in (-1, 1): box(bm, Vector((0, sy * 0.62, 1.15)), (2.6, 0.08, 0.5))
    box(bm, Vector((-1.3, 0, 1.15)), (0.08, 1.3, 0.5)); box(bm, Vector((1.3, 0, 1.15)), (0.08, 1.3, 0.5))
    box(bm, Vector((2.2, 0, 0.55)), (1.6, 0.1, 0.1))
    o = new_obj("wagon", bm, M["wood_a"], c, rz)
    bm = bmesh.new()
    for sx in (-0.85, 0.85):
        for sy in (-0.72, 0.72):
            r = 0.52; res = bmesh.ops.create_circle(bm, segments=1, radius=0.01)
            for k in range(12):
                a = k * math.pi / 6
                box(bm, Vector((sx + math.cos(a) * r * 0.5 * 0, sy, r + 0.05)), (0.05, 0.05, r * 2 if k < 6 else 0.01), rx=0, ry=a)
            tor = bmesh.ops.create_cone(bm, cap_ends=False, segments=20, radius1=r, radius2=r, depth=0.08)
            bmesh.ops.transform(bm, matrix=Matrix.Translation((sx, sy, r + 0.05)) @ Matrix.Rotation(math.pi / 2, 4, "X"), verts=tor["verts"])
    new_obj("wagon_wheels", bm, M["wood_d"], c, rz)
    return o
def pole(c, rz=0.0):
    bm = bmesh.new(); cyl(bm, Vector((0, 0, 3.6)), 0.09, 7.2, 8)
    box(bm, Vector((0, 0, 6.6)), (0.12, 1.5, 0.1)); box(bm, Vector((0, 0, 6.1)), (0.1, 1.1, 0.09))
    return new_obj("pole", bm, M["wood_d"], c, rz)
for y in (-18, -2, 14, 30): pole((-5.4, y, 0.0)); 
def wire(y0, y1, x, z, sag=0.5):
    cu = bpy.data.curves.new("wire", "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = 0.012
    sp = cu.splines.new("BEZIER"); sp.bezier_points.add(2)
    for p, yy, zz in zip(sp.bezier_points, (y0, (y0 + y1) / 2, y1), (z, z - sag, z)):
        p.co = (x, yy, zz); p.handle_left_type = p.handle_right_type = "AUTO"
    o = bpy.data.objects.new("wire", cu); coll.objects.link(o); o.data.materials.append(M["iron"])
for a, b in ((-18, -2), (-2, 14), (14, 30)):
    for dx in (-0.65, 0.65): wire(a, b, -5.4 + dx * 0.0 + dx, 6.6, 0.7)
for n_, (sd_, y_, ww_) in LAY.items():
    px = sd_ * 4.9; rr2 = random.Random(len(n_))
    barrel((px, y_ + ww_ * 0.82, 0.0)); barrel((px + sd_ * 0.45, y_ + ww_ * 0.82 + 0.5, 0.0))
    crate((px, y_ + ww_ * 0.18, 0.0), rr2.uniform(0.55, 0.85), rr2.uniform(0, 1)); crate((px + sd_ * 0.2, y_ + ww_ * 0.18 + 0.1, 0.0), 0.5, rr2.uniform(0, 1))
hay((-5.2, 15.5, 0.0), 0.3); hay((5.6, 5.0, 0.0), -0.4); wagon((6.2, 17.5, 0.0), math.pi / 2 + 0.2); wagon((-6.4, -13, 0.0), 0.4)

barrel((-5.3, -2.5, 0.0)); barrel((-4.9, -1.8, 0.0)); crate((-5.1, -0.8, 0.0), 0.7, 0.4); crate((-5.2, 9.0, 0.0), 0.6)
barrel((5.1, -3.0, 0.0)); crate((5.3, 9.0, 0.0), 0.8, 0.3); barrel((5.0, 17.5, 0.0))
post_rail((-5.0, 5.2, 0.0), math.pi / 2); post_rail((5.0, 7.5, 0.0), math.pi / 2)
trough((-5.0, 13.5, 0.0), math.pi / 2); trough((5.0, 14.0, 0.0), math.pi / 2)
for y in (-8, 2, 12, 22): lamp_post((-3.6, y, 0.0)); lamp_post((3.6, y + 4, 0.0))
for p in ((-16, 4), (14, -6), (-20, 22), (18, 30), (-12, -12), (22, 14)): cactus((p[0], p[1], 0.9), random.uniform(1.3, 2.2))
for p in ((-14, -4), (16, 0), (-22, 12), (20, 26), (-9, 32), (11, -14)): rock((p[0], p[1], 0.5), random.uniform(0.7, 1.6))

def bunting(y, z=5.2, x0=-8.4, x1=8.4, sag=0.8, n=22):
    bm_r = bmesh.new(); bm_c = bmesh.new()
    cu = bpy.data.curves.new("rope", "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = 0.012
    sp = cu.splines.new("BEZIER"); sp.bezier_points.add(2)
    for p, xx, zz in zip(sp.bezier_points, (x0, 0, x1), (z, z - sag, z)):
        p.co = (xx, y, zz); p.handle_left_type = p.handle_right_type = "AUTO"
    ro = bpy.data.objects.new("rope", cu); coll.objects.link(ro); ro.data.materials.append(M["iron"])
    for i in range(n):
        t = (i + 0.5) / n; xx = x0 + (x1 - x0) * t; zz = z - sag * (1 - (2 * t - 1) ** 2)
        b = bm_r if i % 2 == 0 else bm_c
        v1 = b.verts.new((xx - 0.17, y, zz)); v2 = b.verts.new((xx + 0.17, y, zz)); v3 = b.verts.new((xx, y, zz - 0.36))
        b.faces.new((v1, v2, v3))
    new_obj("flags_r", bm_r, M["flag_r"]); new_obj("flags_c", bm_c, M["flag_c"])
bunting(4.0); bunting(15.0, 5.4)

def bounty_board(c):
    bm = bmesh.new()
    for x in (-2.0, 2.0): box(bm, Vector((x, 0, 1.9)), (0.2, 0.2, 3.8))
    box(bm, Vector((0, 0, 3.9)), (4.7, 0.3, 0.3)); box(bm, Vector((0, 0, 0.7)), (4.2, 0.25, 0.16))
    new_obj("bounty_frame", bm, M["wood_d"], c)
    bm = bmesh.new(); box(bm, Vector((0, -0.02, 2.2)), (3.8, 0.1, 2.9)); new_obj("bounty_panel", bm, M["wood_a"], c)
    bm = bmesh.new(); rr_ = random.Random(2)
    for i in range(9):
        box(bm, Vector((-1.5 + (i % 3) * 1.5 + rr_.uniform(-0.1, 0.1), -0.10, 2.9 - (i // 3) * 0.95 + rr_.uniform(-0.1, 0.1))), (0.95, 0.02, 0.75), ry=rr_.uniform(-0.08, 0.08))
    new_obj("bounty_posters", bm, M["paint"], c)
bounty_board((-1.2, 23.0, 0.0))

def station(c):
    building("Station", 15.0, 7.0, 4.0, 1.4, "wood_c", 0, "BYTE ISLAND", porch=3.4, accent="wood_d")
    st = bpy.data.objects["Station"]; st.rotation_euler = (0, 0, 0); st.location = (0, c, 0)
    bm = bmesh.new(); box(bm, Vector((0, c - 7.0 / 2 - 5.2, 0.35)), (18.0, 5.2, 0.22))
    new_obj("platform", bm, M["wood_b"])
    bm = bmesh.new()
    for x in range(-30, 31):
        box(bm, Vector((x * 0.9, c - 11.0, 0.12)), (0.30, 2.6, 0.12)); box(bm, Vector((x * 0.9, c - 8.5 - 5.4, 0.12)), (0.30, 2.6, 0.12))
    new_obj("sleepers", bm, M["wood_d"])
    bm = bmesh.new()
    for yy in (-0.72, 0.72):
        box(bm, Vector((0, c - 11.0 + yy, 0.28)), (56, 0.09, 0.14))
    new_obj("rails", bm, M["iron"])
station(44.0)

# ------------------------------------------------------------ world / light / camera
w = bpy.data.worlds.new("sky"); scene.world = w; w.use_nodes = True
nt = w.node_tree; bg = nt.nodes["Background"]
sky = nt.nodes.new("ShaderNodeTexSky"); sky.sky_type = "MULTIPLE_SCATTERING"
sky.sun_elevation = math.radians(3.5); sky.sun_rotation = math.radians(150); sky.air_density = 1.3; sky.aerosol_density = 2.2; sky.sun_size = math.radians(1.5)
nt.links.new(sky.outputs["Color"], bg.inputs["Color"]); bg.inputs["Strength"].default_value = 0.30
sun = bpy.data.lights.new("sun", "SUN"); sun.energy = 7.0; sun.color = (1.0, 0.50, 0.22); sun.angle = math.radians(2.0)
so = bpy.data.objects.new("sun", sun); coll.objects.link(so)
rr = math.radians(150); el = math.radians(3.5)
dts = Vector((math.sin(rr) * math.cos(el), math.cos(rr) * math.cos(el), math.sin(el)))   # direction towards the sun
so.rotation_euler = (-dts).to_track_quat("-Z", "Y").to_euler()
# warm haze: finite volume box (an infinite world volume would black out the sky)
hz = bpy.data.materials.new("Haze"); hz.use_nodes = True; hn = hz.node_tree
for n in list(hn.nodes): hn.nodes.remove(n)
vs = hn.nodes.new("ShaderNodeVolumeScatter"); vs.inputs["Density"].default_value = (0.006 if NIGHT else 0.008); vs.inputs["Color"].default_value = (1.0, 0.80, 0.58, 1); vs.inputs["Anisotropy"].default_value = 0.5
ho = hn.nodes.new("ShaderNodeOutputMaterial"); hn.links.new(vs.outputs["Volume"], ho.inputs["Volume"])
bm = bmesh.new(); box(bm, Vector((0, 15, 20)), (900, 900, 40)); ho_obj = new_obj("haze", bm, hz)
scene.view_settings.exposure = -0.1
if NIGHT:
    sky.sun_elevation = math.radians(-7); bg.inputs["Strength"].default_value = 0.10
    sun.energy = 0.9; sun.color = (0.42, 0.58, 1.0); sun.angle = math.radians(1.0)
    mdir = Vector((-0.5, -0.45, 0.74)).normalized(); so.rotation_euler = (-mdir).to_track_quat("-Z", "Y").to_euler()
    for L in bpy.data.lights:
        if L.type in ("POINT", "AREA"): L.energy *= 3.2
    for nm, st in (("Lantern", 55), ("Window_Warm", 7)):
        bsdf = bpy.data.materials[nm].node_tree.nodes["Principled BSDF"]; bsdf.inputs["Emission Strength"].default_value = st
    vs.inputs["Color"].default_value = (0.55, 0.65, 0.95, 1)
    scene.view_settings.exposure = 0.6

cd = bpy.data.cameras.new("cam"); cam = bpy.data.objects.new("cam", cd); coll.objects.link(cam); scene.camera = cam
scene.render.engine = "CYCLES"; scene.cycles.samples = SAMPLES; scene.cycles.use_denoising = True
scene.view_settings.view_transform = "AgX"; scene.view_settings.look = "AgX - High Contrast"
scene.render.resolution_x, scene.render.resolution_y = 1280, 720
VIEWS = {"street": ((0.8, -24, 1.7), (0, 14, 2.8), 30), "hero": ((-2.8, -10.5, 1.7), (-9.0, 0.5, 2.8), 28)}
for tag, (loc, tgt, lens) in VIEWS.items():
    cam.location = Vector(loc); cd.lens = lens
    cam.rotation_euler = (Vector(tgt) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = str(OUT / f"town_{TAG}_{tag}.png"); bpy.ops.render.render(write_still=True); print("rendered", tag, flush=True)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / f"town_kit_{TAG}.blend"))
