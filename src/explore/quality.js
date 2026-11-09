// Quality tiers (pure, unit-tested). Auto-selection from coarse device signals, settings per tier and
// backend, and an adaptive-resolution controller driven by the measured frame time.
import { TIER_SETTINGS, TIERS } from './config.js';

/**
 * Auto tier. ULTRA is never auto-selected (manual only). Headless and software renderers report
 * themselves through `software` and always get LOW.
 */
export function pickTier({ backend = 'webgl', mobile = false, deviceMemory = 4, cores = 4, saveData = false, software = false, integrated = false } = {}) {
  if (software || saveData) return 'LOW';
  if (mobile) return deviceMemory >= 6 && cores >= 8 ? 'MEDIUM' : 'LOW';
  if (deviceMemory < 4 || cores < 4) return 'LOW';
  if (integrated) return 'MEDIUM'; // laptop iGPUs (Intel Iris Xe, AMD APUs): HIGH is a manual choice
  if (backend === 'webgpu' && deviceMemory >= 8 && cores >= 8) return 'HIGH';
  return 'MEDIUM';
}

/** Coarse "integrated GPU" test from the adapter / renderer strings. */
export const isIntegratedGpu = (text) => /intel|iris|uhd|gen-\d|integrated|radeon\(tm\) graphics|apple m\d/i.test(String(text ?? ''));

/** Tier settings, adjusted for the backend actually running. */
export function tierSettings(tier, backend = 'webgpu') {
  const base = TIER_SETTINGS[TIERS.includes(tier) ? tier : 'LOW'];
  const settings = { ...base, tier: TIERS.includes(tier) ? tier : 'LOW', backend };
  if (backend === 'webgl') {
    // WebGL2 fallback: SSR and god rays need many full-screen ray-march passes and run at a fraction
    // of their WebGPU speed through the WebGL2 backend; keep them for WebGPU only.
    settings.godrays = false;
    if (settings.tier !== 'ULTRA') settings.ssr = false;
  }
  return settings;
}

/** One tier down (or the same if already LOW). */
export const lowerTier = (tier) => TIERS[Math.max(0, TIERS.indexOf(tier) - 1)] ?? 'LOW';

/**
 * Adaptive resolution: scales the drawing buffer between `min` and 1 to hold `target` fps, with
 * hysteresis so it does not oscillate. If it sits at the floor and is still too slow for `downAfter`
 * seconds it asks for a lower tier (only used when the user picked "auto").
 */
export class AdaptiveResolution {
  constructor({ min = 0.55, target = 55, floorFps = 30, step = 0.08, window = 1, downAfter = 4 } = {}) {
    Object.assign(this, { min, target, floorFps, step, window, downAfter });
    this.scale = 1;
    this.elapsed = 0;
    this.frames = 0;
    this.slowFor = 0;
    this.fps = 60;
  }

  /** Feed one frame. Returns { scale, changed, wantLowerTier }. */
  update(dt) {
    this.elapsed += dt;
    this.frames += 1;
    let changed = false;
    let wantLowerTier = false;
    if (this.elapsed >= this.window) {
      this.fps = this.frames / this.elapsed;
      if (this.fps < this.target - 5 && this.scale > this.min) {
        this.scale = Math.max(this.min, +(this.scale - this.step).toFixed(3));
        changed = true;
      } else if (this.fps > this.target + 3 && this.scale < 1) {
        this.scale = Math.min(1, +(this.scale + this.step / 2).toFixed(3));
        changed = true;
      }
      this.slowFor = this.scale <= this.min && this.fps < this.floorFps ? this.slowFor + this.elapsed : 0;
      if (this.slowFor >= this.downAfter) {
        wantLowerTier = true;
        this.slowFor = 0;
        this.scale = 1;
        changed = true;
      }
      this.elapsed = 0;
      this.frames = 0;
    }
    return { scale: this.scale, changed, wantLowerTier };
  }
}
