# Avatar brief (P8) — taken from Umer's reference photos, 30-Oct-2026

Reference photos are NOT stored in the repo (privacy). Umer re-shares them at P8; they go in `blender/references/` which must be gitignored first.

## Style (decided 31-Oct-2026, see docs/DESIGN.md §7)
Original **chunky designer-toy figure with chibi proportions** (head ≈ 1/3 of total height), cute and stylized. Built from **segmented rigid parts** (head, torso, upper/lower arms, hands, hips, legs, feet), each parented to one bone — no skin-weight painting. Not a replica of any toy brand's figure or existing character. The avatar is also the **AI twin** (talks, gestures) and the **player character** in Explore mode.

Required actions: Idle, Walk, Run, Jump, Wave, Talk, Think, Nod. Shape keys: Blink, Smile, Mouth_Open (talk).

## Likeness (stylized, not photoreal)
| Feature | Description |
|---|---|
| Build | Slim and tall, long limbs, narrow shoulders-to-waist taper |
| Face | Long oval face, defined jawline, straight nose |
| Skin | Warm medium-brown |
| Eyes | Dark brown; thick, dark, fairly straight eyebrows |
| Hair | Black; short sides, textured messy top with volume swept up and slightly to one side |
| Facial hair | Short even stubble beard + light moustache |
| Expression | Calm, confident half-smile (default); full smile as a shape key |
| Glasses | None |

## Outfit (signature look from the photos)
| Item | Material / texture |
|---|---|
| Two-button suit jacket + trousers | Charcoal-black wool; subtle weave texture (normal + roughness), slight sheen |
| Shirt | Black, matte cotton |
| Tie | Black satin (higher specular than the suit) |
| Tie clip | Polished silver, metallic |
| Wristwatch | Steel, left wrist |
| Shoes | Black leather derby, glossy |

## Palette suggestion
Suit `#2B2B2E` · Shirt `#141414` · Tie `#1A1A1A` · Silver `#C9CCD1` · Skin and hair sampled from the photos at P8.

## Animations / expressions (E5)
Idle (loop) · Walk (loop) · Run (loop) · Jump · Wave · Talk (loop, with Mouth_Open) · Think (loop) · Nod · Blink · Smile.
The "buttoning the jacket" pose from the photos is a good candidate for the hero idle pose or a gesture.
