// P9.3 promo film: the cue sheet's schema (zod). docs/promo/cues.json is the single source of timing
// for the score / SFX render (scripts/promo/audio/) and the After Effects build (P9.4). Frames are at
// 24 fps; every range is [startFrame, endFrame) (endFrame exclusive, so a scene of 0–120 is 5.0 s).
import { z } from 'zod';

export const FPS = 24;
export const BPM = 96;
export const BEAT = 15; // frames per beat (24 · 60 / 96)
export const BAR = 60; // 4 beats
export const DURATION = 1080; // 45.0 s, 18 bars
export const SHOT_IDS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10'];
export const SOUNDS = ['projector', 'stamp', 'typewriter', 'paper', 'anvil', 'pin', 'ratchet', 'woodblock', 'whistle', 'chuff', 'hooves', 'chime', 'firework', 'spur'];

const frame = z.number().int().min(0).max(DURATION);
const range = { startFrame: frame, endFrame: frame };

export const cueSheetSchema = z
  .object({
    title: z.string().min(1),
    fps: z.literal(FPS),
    duration: z.literal(DURATION),
    bpm: z.literal(BPM),
    beatFrames: z.literal(BEAT),
    barFrames: z.literal(BAR),
    width: z.literal(3840),
    height: z.literal(2160),
    liveUrl: z.string().min(1),
    notes: z.array(z.string()),
    scenes: z.array(z.object({ id: z.string().regex(/^[a-z-]+$/), title: z.string().min(1), bars: z.tuple([z.number().int().min(1), z.number().int().max(18)]), ...range }).strict()).length(7),
    music: z.array(z.object({ id: z.string().regex(/^[a-z-]+$/), bars: z.tuple([z.number().int().min(1), z.number().int().max(18)]), ...range, description: z.string().min(1) }).strict()).min(5),
    shots: z
      .array(
        z
          .object({
            id: z.enum(SHOT_IDS),
            scene: z.string(),
            track: z.enum(['V1', 'V2']),
            ...range,
            sourceIn: z.number().int().min(0),
            footageFrames: z.number().int().positive(),
            footage: z.string().regex(/^aftereffects\/footage\/F\d+\/F\d+_\[####\]\.png$/),
            capture: z.enum(['explore', 'browser']),
            time: z.enum(['night', 'golden-hour', 'day-theme']),
            description: z.string().min(1),
          })
          .strict(),
      )
      .length(SHOT_IDS.length),
    text: z.array(z.object({ frame, endFrame: frame.optional(), layer: z.string().regex(/^[a-z0-9-]+$/), text: z.string().min(1), source: z.string().min(1) }).strict()).min(20),
    sfx: z.array(z.object({ frame: z.number().int().min(0).max(DURATION - 1), sound: z.enum(SOUNDS), gain: z.number().min(0).max(1), pitch: z.number().min(-24).max(24).optional() }).strict()).min(40),
  })
  .strict()
  .superRefine((cue, ctx) => {
    const issue = (message, path = []) => ctx.addIssue({ code: 'custom', message, path });
    // ranges
    for (const [kind, list] of [['scenes', cue.scenes], ['music', cue.music], ['shots', cue.shots]]) {
      list.forEach((r, i) => {
        if (r.endFrame <= r.startFrame) issue(`${kind}[${i}] ends before it starts`, [kind, i]);
      });
    }
    // scenes tile the film on bar lines
    let at = 0;
    cue.scenes.forEach((s, i) => {
      if (s.startFrame !== at) issue(`scene ${s.id} starts at ${s.startFrame}, expected ${at}`, ['scenes', i]);
      if (s.startFrame % BAR || s.endFrame % BAR) issue(`scene ${s.id} is not on bar lines`, ['scenes', i]);
      if (s.bars[0] !== s.startFrame / BAR + 1 || s.bars[1] !== s.endFrame / BAR) issue(`scene ${s.id} bars do not match its frames`, ['scenes', i]);
      at = s.endFrame;
    });
    if (at !== DURATION) issue(`scenes end at ${at}, expected ${DURATION}`, ['scenes']);
    // music sections tile the film too
    at = 0;
    cue.music.forEach((m, i) => {
      if (m.startFrame !== at) issue(`music ${m.id} starts at ${m.startFrame}, expected ${at}`, ['music', i]);
      if (m.bars[0] !== m.startFrame / BAR + 1 || m.bars[1] !== m.endFrame / BAR) issue(`music ${m.id} bars do not match its frames`, ['music', i]);
      at = m.endFrame;
    });
    if (at !== DURATION) issue(`music ends at ${at}, expected ${DURATION}`, ['music']);
    // shots: every one once, inside its scene, on beats, inside its footage, no overlaps within a track
    const sceneById = new Map(cue.scenes.map((s) => [s.id, s]));
    const seen = new Set();
    cue.shots.forEach((s, i) => {
      if (seen.has(s.id)) issue(`shot ${s.id} twice`, ['shots', i]);
      seen.add(s.id);
      const scene = sceneById.get(s.scene);
      if (!scene) issue(`shot ${s.id}: unknown scene ${s.scene}`, ['shots', i]);
      else if (s.startFrame < scene.startFrame || s.endFrame > scene.endFrame) issue(`shot ${s.id} leaves its scene`, ['shots', i]);
      if (s.startFrame % BEAT || s.endFrame % BEAT) issue(`shot ${s.id} does not cut on a beat`, ['shots', i]);
      if (s.sourceIn + (s.endFrame - s.startFrame) > s.footageFrames) issue(`shot ${s.id} runs past its footage`, ['shots', i]);
      if (!s.footage.includes(`/${s.id}/${s.id}_`)) issue(`shot ${s.id} points at another shot's footage`, ['shots', i]);
    });
    for (const id of SHOT_IDS) if (!seen.has(id)) issue(`shot ${id} missing`, ['shots']);
    for (const track of ['V1', 'V2']) {
      const list = cue.shots.filter((s) => s.track === track).sort((a, b) => a.startFrame - b.startFrame);
      for (let i = 1; i < list.length; i += 1) if (list[i].startFrame < list[i - 1].endFrame) issue(`${list[i - 1].id} and ${list[i].id} overlap on ${track}`, ['shots']);
    }
    // text: frames in range, sorted, no overlaps on a layer that holds one line at a time
    cue.text.forEach((t, i) => {
      if (i && t.frame < cue.text[i - 1].frame) issue(`text cues out of order at ${i}`, ['text', i]);
      if (t.endFrame !== undefined && t.endFrame <= t.frame) issue(`text "${t.text}" ends before it starts`, ['text', i]);
    });
    const byLayer = new Map();
    for (const t of cue.text) byLayer.set(t.layer, [...(byLayer.get(t.layer) ?? []), t]);
    for (const [layer, list] of byLayer) {
      for (let i = 1; i < list.length; i += 1) {
        const prevEnd = list[i - 1].endFrame ?? list[i - 1].frame + 1;
        if (list[i].frame < prevEnd) issue(`text layer ${layer} overlaps at frame ${list[i].frame}`, ['text']);
      }
    }
    // sfx: sorted, never two of the same sound on one frame
    const keys = new Set();
    cue.sfx.forEach((s, i) => {
      if (i && s.frame < cue.sfx[i - 1].frame) issue(`sfx cues out of order at ${i}`, ['sfx', i]);
      const k = `${s.frame}:${s.sound}`;
      if (keys.has(k)) issue(`two ${s.sound} cues on frame ${s.frame}`, ['sfx', i]);
      keys.add(k);
    });
    // the final frame is silent (the storyboard): no sound may start in the last second
    if (cue.sfx.some((s) => s.frame > DURATION - FPS)) issue('a sound starts in the final second', ['sfx']);
  });

/** Parse and validate; throws a readable error listing every issue. */
export function validateCues(json) {
  const r = cueSheetSchema.safeParse(json);
  if (!r.success) throw new Error(`cues.json is invalid:\n${r.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  return r.data;
}

/** Frame → sample index at a sample rate (exact for 48 kHz: 2000 samples per frame). */
export const frameToSample = (f, rate = 48000) => Math.round((f * rate) / FPS);
/** Frame → seconds. */
export const frameToSeconds = (f) => f / FPS;
