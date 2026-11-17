// Explore mode configuration: every asset URL, every node/material name the code hooks, and the
// quality tiers. tests/explore-assets.test.js checks every name below against the GLBs.
// P3.2: the baked final town (blender/export, Draco + WebP atlases) replaced the placeholder.

/** The town scene (baked: one Baked_<Group> material per building/prop group with an albedo × AO atlas). */
export const TOWN_URL = '/models/town.glb';
export const TOWN_JSON_URL = '/models/town.json';
export const AVATAR_URL = '/models/avatar.glb';
/** The station train (loaded lazily, only near the station). */
export const TRAIN_URL = '/models/train.glb';
export const TRAIN_JSON_URL = '/models/train.json';
/** The sheriff's horse (P3.3, loaded lazily on the first whistle). */
export const HORSE_URL = '/models/horse.glb';
export const HORSE_JSON_URL = '/models/horse.json';
/** The rowboat's oars (P3.4, loaded with the arrival cinematic); oars.json holds the oarlock / seat offsets. */
export const OARS_URL = '/models/oars.glb';
export const OARS_JSON_URL = '/models/oars.json';
/** Self-hosted Draco decoder (copied from three/examples/jsm/libs/draco). Town, avatar and train use it. */
export const DRACO_PATH = '/draco/';

export const SEA_LEVEL = -0.6;

/** Material names (exact) and what the upgrade pass does with them. */
export const MATERIALS = {
  emissive: ['Window_Warm', 'Lantern', 'Gold'],
  /** Baked atlases: kept as exported (their map is the look); the dock gets a wet sheen at night. */
  baked: ['Baked_Bank', 'Baked_Blacksmith', 'Baked_Dock', 'Baked_Lighthouse', 'Baked_PictureHouse', 'Baked_Props', 'Baked_Rocks', 'Baked_Rowboat', 'Baked_Saloon', 'Baked_SheriffOffice', 'Baked_Station', 'Baked_Telegraph'],
  ground: ['Sand', 'Dirt', 'Rut'],
  street: ['Dirt', 'Rut'], // wet sheen at night
  water: ['Sea', 'Water'],
  misc: ['Iron', 'Rope', 'FlagC', 'FlagR'],
};

/** Node names (exact) or prefixes the engine looks up. */
export const NODES = {
  sea: 'sea',
  ground: 'ground',
  street: 'street',
  dock: 'Dock_baked',
  /** P3.4: the moored rowboat is its own node (not merged, not a collider): it floats on the waves. */
  rowboat: 'Rowboat_baked',
  dockRope: 'dock_rope',
  lighthouseLamp: 'lighthouse_lamp',
  flagPrefixes: ['flags_c', 'flags_r'],
  signSuffix: '_sign', // hanging signs swing (none in the baked town; kept for future art)
  smoke: ['Blacksmith_baked', 'Saloon_baked'], // chimney smoke rises from the top of these groups
  /** Never collide with these (thin, decorative or water). */
  noCollide: ['sea', 'wire', 'rope', 'dock_rope', 'flags_c', 'flags_r', 'trough_w'],
};

/** Lantern nodes: street lamps ("lamp", "lamp.001" …), dock lamps and "<Building>_lantern" (not the posts). */
export const isLanternNode = (name) => !/lamppost|lamp_post/.test(name) && (/^lamp(\.\d+)?$/.test(name) || /^dock_lamp(\.\d+)?$/.test(name) || name.endsWith('_lantern'));

/** Avatar clip and morph names (exact). Whistle and Ride are used in P3.3 (the horse), Row in P3.4 (the boat). */
export const AVATAR = {
  clips: ['Idle', 'IdleArmsCrossed', 'Walk', 'Run', 'Jump', 'Wave', 'Talk', 'Think', 'Nod', 'Whistle', 'Ride', 'Row'],
  morphs: ['Blink', 'Smile', 'Mouth_Open'],
};

/** Train node prefix for the wheels (spun by distance / radius from train.json). */
export const TRAIN = { wheelPrefix: 'wheel_', root: 'Train' };
/**
 * Horse: the GLB faces +Z after the Y-up export (Blender −Y), verified from the bind-pose head/tail
 * bones in tests, so no yaw correction is needed (forwardYaw 0). Capsule: radius 0.8 m centred 0.2 m
 * ahead of the origin (between the hooves).
 */
export const HORSE = { clips: ['Idle', 'Walk', 'Trot', 'Gallop', 'HeadShake'], forwardYaw: 0, radius: 0.8, centreZ: 0.2, stepHeight: 0.45, reach: 14 };
/**
 * P3.4: the horse's body as a horizontal capsule in horse space (from the mesh bounds: z −0.86…1.29,
 * half-width 0.32): the sheriff cannot walk into it, and the mount prompt measures from its surface.
 */
export const HORSE_BODY = { tail: -0.62, chest: 0.98, radius: 0.38, top: 2.0, mountReach: 1.3 };

/** Footstep surface per material name (everything else is sand). */
export const SURFACES = {
  Baked_Dock: 'wood',
  Baked_Station: 'wood',
  Baked_Bank: 'wood',
  Baked_Blacksmith: 'wood',
  Baked_PictureHouse: 'wood',
  Baked_Saloon: 'wood',
  Baked_SheriffOffice: 'wood',
  Baked_Telegraph: 'wood',
  Baked_Lighthouse: 'stone',
  Baked_Rocks: 'stone',
  Baked_Props: 'wood',
  Iron: 'stone',
};

export const TIERS = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'];

/**
 * What each tier turns on. LOW = tone mapping + fog + cheap bloom. Everything else is opt-in by tier.
 * `lanterns` is the size of the pooled point-light set (fixed per session so shaders never recompile).
 */
export const TIER_SETTINGS = {
  LOW: { pixelRatio: 1, shadowMap: 0, lanterns: 0, bloom: 'cheap', ao: false, ssr: false, dof: false, godrays: false, lensflare: false, lut: false, grain: false, ca: false, smaa: false, particles: 400, seaSegments: 64, reflections: false },
  MEDIUM: { pixelRatio: 1.25, shadowMap: 1024, lanterns: 4, bloom: 'full', ao: false, ssr: false, dof: false, godrays: false, lensflare: false, lut: true, grain: true, ca: true, smaa: true, particles: 1500, seaSegments: 128, reflections: false },
  HIGH: { pixelRatio: 1.5, shadowMap: 2048, lanterns: 8, bloom: 'full', ao: true, ssr: true, dof: true, godrays: false, lensflare: true, lut: true, grain: true, ca: true, smaa: true, particles: 4000, seaSegments: 192, reflections: true },
  ULTRA: { pixelRatio: 2, shadowMap: 4096, lanterns: 12, bloom: 'full', ao: true, ssr: true, dof: true, godrays: true, lensflare: true, lut: true, grain: true, ca: true, smaa: true, particles: 8000, seaSegments: 256, reflections: true },
};

/** Player / camera tuning (metres, seconds). */
export const PLAYER = {
  radius: 0.32,
  height: 1.8,
  walkSpeed: 3.2,
  runSpeed: 6.8,
  accel: 14,
  airControl: 0.35,
  gravity: -24,
  jumpSpeed: 7.6,
  stepHeight: 0.42,
  maxSlopeDeg: 50,
  idleArmsCrossedAfter: 8,
  zoneRadius: 3.2,
};

export const CAMERA = {
  distance: 6.2,
  minDistance: 2.2,
  maxDistance: 11,
  pitch: 0.34,
  minPitch: -0.1,
  maxPitch: 1.05,
  /** P3.4: drag sensitivity (rad per px), lower than before; pointer-lock uses the same values. */
  yawPerPx: 0.0032,
  pitchPerPx: 0.0024,
  height: 1.55,
  follow: 6,
  fov: 50,
};

/** localStorage keys (whitelisted in src/ui/prefs.js callers; see docs/security.md C6). */
export const QUALITY_KEY = 'explore.quality';
export const TUTORIAL_KEY = 'explore.tutorial';
export const TIME_KEY = 'explore.time';
export const QUALITY_VALUES = ['auto', ...TIERS];
export const TUTORIAL_VALUES = ['done'];
export const TIME_VALUES = ['day', 'night'];
/** P3.3: the boat arrival plays once; the music toggle (on top of the global sound choice). */
export const ARRIVAL_KEY = 'explore.arrival';
export const ARRIVAL_VALUES = ['seen'];
export const MUSIC_KEY = 'audio.music';
export const MUSIC_VALUES = ['on', 'off'];

/**
 * P9.5 bounty posters: artwork over the 9 blank poster panels of the Bounty Board (baked into
 * Props_baked in town.glb; built by blender/town/kit.py bounty_board() with random.Random(2)).
 * Each slot is [dx, y, rz] from the board's town.json centre: dx along +X, y up from the ground, rz
 * the panel's tilt about +Z (radians). The panels face +Z (the street); their front face is `front`
 * metres in front of the board centre, and the artwork plane sits `lift` in front of that. Checked
 * against the Draco-decoded Props_baked faces in P9.5 (every corner within 1 mm).
 */
export const BOUNTY_POSTERS = {
  size: [0.95, 0.75],
  front: 0.11,
  lift: 0.004,
  texture: [324, 256], // ≈ the panel's 1.267 aspect; 9 × 442 KB with mips = 3.98 MB
  budgetBytes: 4 * 1024 * 1024,
  near: 40, // metres: the chunk loads the first time the sheriff comes this close to the board
  slots: [
    [-1.4088, 2.9896, 0.07095],
    [-0.083, 2.9671, -0.03776],
    [1.5339, 2.8616, -0.01695],
    [-1.4786, 1.9662, 0.05466],
    [-0.0139, 1.9287, -0.03568],
    [1.599, 2.0399, -0.00707],
    [-1.511, 0.9536, 0.07425],
    [-0.0945, 0.993, 0.02905],
    [1.476, 1.0784, -0.00412],
  ],
};
