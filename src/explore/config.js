// Explore mode configuration: every asset URL, every node/material name the code hooks, and the
// quality tiers. The town will be swapped for a baked final under the SAME node and material names,
// so TOWN_URL is the only line to change. tests/explore-assets.test.js checks every name below
// against the GLBs.

/** The town scene. Swap for the baked final here (same node and material names). */
export const TOWN_URL = '/models/town_placeholder.glb';
export const TOWN_JSON_URL = '/models/town.json';
export const AVATAR_URL = '/models/avatar.glb';
/** Self-hosted Draco decoder (copied from three/examples/jsm/libs/draco). */
export const DRACO_PATH = '/draco/';

export const SEA_LEVEL = -0.6;

/** Material names (exact) and what the upgrade pass does with them. */
export const MATERIALS = {
  emissive: ['Window_Warm', 'Lantern', 'Gold'],
  wood: ['Wood_Weathered', 'Wood_Grey', 'Wood_Red', 'Wood_Dark'],
  trim: ['Trim_Cream'],
  roof: ['Roof_Shingle'],
  ground: ['Sand', 'Dirt', 'Rock', 'Mesa', 'Rut', 'Scrub'],
  street: ['Dirt', 'Rut'], // wet sheen at night
  water: ['Sea', 'Water'],
  misc: ['Hay', 'Iron', 'Cactus'],
};

/** Node names (exact) or prefixes the engine looks up. */
export const NODES = {
  sea: 'sea',
  ground: 'ground',
  street: 'street',
  lanternPrefixes: ['lamp', '_lantern'], // "lamp", "lamp.001" … and "<Building>_lantern"
  flagPrefixes: ['flags_c', 'flags_r'],
  signSuffix: '_sign',
  smoke: ['Blacksmith_roof', 'Saloon_roof'], // chimney smoke rises from the top of these
  /** Never collide with these (thin, decorative or water). */
  noCollide: ['sea', 'wire', 'rope', 'flags_c', 'flags_r', 'scrub', 'trough_w'],
};

/** Avatar clip and morph names (exact). */
export const AVATAR = {
  clips: ['Idle', 'IdleArmsCrossed', 'Walk', 'Run', 'Jump', 'Wave', 'Talk', 'Think', 'Nod'],
  morphs: ['Blink', 'Smile', 'Mouth_Open'],
};

/** Footstep surface per material name. */
export const SURFACES = {
  Wood_Weathered: 'wood',
  Wood_Grey: 'wood',
  Wood_Red: 'wood',
  Wood_Dark: 'wood',
  Trim_Cream: 'wood',
  Rock: 'stone',
  Mesa: 'stone',
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
