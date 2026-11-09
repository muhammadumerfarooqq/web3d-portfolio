# The sheriff's horse

The horse uses the same signed-distance-field method as the avatar (it imports `blender/scripts/sdf.py`).

- `horse.py` sculpts the horse: the body, legs, head and ears, the mane and tail, the hooves and eyes, and the tack (western saddle with horn and fenders, striped blanket, stirrups, bridle and reins).
- `horse_build.py` decimates the parts to about 20k triangles. It paints the bay coat in vertex colours: black points, a white blaze, a dark muzzle and a lighter belly. It then builds a 33-bone rig with distance-based skin weights and creates the clips **Idle, Walk** (4-beat), **Trot** (diagonal pairs), **Gallop** (transverse, with suspension) and **HeadShake** (the reply to the whistle).
- `rider.py` renders the sheriff (avatar clip `Ride`) seated in the saddle; the `Whistle` clip lives in `blender/scripts/rig.py`.
- The output is `blender/export/horse.glb` (Draco, 276 KB) plus `horse.json`, which gives the rider attach bone and offset, the gait speeds and the whistle clips.
