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
/** Self-hosted Draco decoder (copied from three/examples/jsm/libs/draco). Town, avatar and train use it. */
export const DRACO_PATH = '/draco/';

export const SEA_LEVEL = -0.6;

/** Material names (exact) and what the upgrade pass does with them. */
export const MATERIALS = {
  emissive: ['Window_Warm', 'Lantern', 'Gold'],
  /** Baked atlases: kept as exported (their map is the look); the dock gets a wet sheen at night. */
  baked: ['Baked_Bank', 'Baked_Blacksmith', 'Baked_Dock', 'Baked_Lighthouse', 'Baked_PictureHouse', 'Baked_Props', 'Baked_Rocks', 'Baked_Saloon', 'Baked_SheriffOffice', 'Baked_Station', 'Baked_Telegraph'],
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

/** Avatar clip and morph names (exact). Whistle and Ride are used in P3.3 (the horse). */
export const AVATAR = {
  clips: ['Idle', 'IdleArmsCrossed', 'Walk', 'Run', 'Jump', 'Wave', 'Talk', 'Think', 'Nod', 'Whistle', 'Ride'],
  morphs: ['Blink', 'Smile', 'Mouth_Open'],
};

/** Train node prefix for the wheels (spun by distance / radius from train.json). */
export const TRAIN = { wheelPrefix: 'wheel_', root: 'Train' };

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
  minPitch: -0.15,
  maxPitch: 1.2,
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
