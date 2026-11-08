# AI-twin avatar — how it is built

The avatar is modelled, coloured, rigged and animated **entirely by Python scripts running in Blender 5.2.3**.
No Blender MCP, no AI 3D generators, no imported third-party models or base meshes.
Re-running the scripts rebuilds `blender/avatar.blend` and `public/models/avatar.glb` exactly.

| Step | Script | What it does |
|---|---|---|
| 1. Sculpt | `character.py` + `sdf.py` | Describes every part (head, hair, eyes' lids, suit, shirt, tie, hands, shoes, watch) as a **signed distance field**: smooth unions/subtractions of ellipsoids, round cones, rounded boxes and tori. The field is sampled on a voxel grid (0.6–4 mm) and converted to triangles with **marching cubes**. A 21-joint A-pose skeleton is defined here too. |
| 2. Assemble | `assemble.py` | Imports the meshes into Blender, smooths and **decimates** them to a real-time budget (≈ 40 k triangles), assigns PBR materials (skin with subsurface, matte wool suit with sheen, satin tie, metallic tie clip and watch, glossy leather shoes), paints **vertex colours** (skin tone, stubble, lips, cheeks, hair variation, iris/pupil), builds the eyeballs and a studio light rig for preview renders. |
| 3. Rig & animate | `rig.py` | Builds the armature (root, hips, spine, chest, neck, head, eyes, clavicles, arms, hands, legs, feet, toes), computes **skin weights** (rigid for head/hair/eyes, distance-based falloff for clothing), adds **shape keys** (Blink, Smile, Mouth_Open) and keyframes the clips Idle, IdleArmsCrossed, Walk, Run, Jump, Wave, Talk, Think, Nod as separate actions. |
| 4. Export | `export.py` | Exports a Draco-compressed **GLB** with skins, morph targets and all clips for Three.js. |

## Why this approach
- **Original:** every shape is authored here; nothing is downloaded.
- **Reproducible and reviewable:** the model is code, so every proportion is a named number.
- **Web-ready:** triangle and texture budgets are enforced at build time.

## Known limits (see docs/LIMITATIONS.md)
- A code-sculpted face is stylized; it does not reach hand-sculpted film quality.
- Fingers are a fixed relaxed pose (no finger bones) to keep the rig light.
- Clothing is skinned, not cloth-simulated.
