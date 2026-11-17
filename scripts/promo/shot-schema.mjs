// P9.3: schema (zod) for docs/promo/shots.json, the scripted promo footage (capture-mode.js and
// browser-shots.mjs). Checked by tests/promo-p93.test.js together with the island ground and bounds.
import { z } from 'zod';

const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const vec2 = z.tuple([z.number(), z.number()]);

const event = z.discriminatedUnion('type', [
  z.object({ at: z.number(), type: z.literal('arrival') }).strict(),
  z.object({ at: z.number(), type: z.literal('train') }).strict(),
  z.object({ at: z.number(), type: z.literal('mount') }).strict(),
  z.object({ at: z.number(), type: z.literal('gallop'), waypoints: z.array(vec2).min(2) }).strict(),
  z.object({ at: z.number(), type: z.literal('fireworks'), origin: vec3 }).strict(),
  z.object({ at: z.number(), type: z.literal('wave') }).strict(),
]);

const pathCamera = z
  .object({
    type: z.literal('path'),
    ease: z.enum(['linear', 'inOutSine', 'inOutCubic', 'outCubic', 'inCubic']),
    fov: z.array(z.number().min(10).max(90)).min(1).max(2),
    position: z.array(vec3).min(2),
    lookAt: z.array(vec3).min(1),
  })
  .strict();
const followCamera = z
  .object({
    type: z.literal('follow'),
    target: z.enum(['boat', 'horse', 'player', 'train']),
    offset: vec3,
    height: z.number().optional(),
    look: vec3,
    damping: z.number().positive(),
    fov: z.number().min(10).max(90),
  })
  .strict();

export const shotsSchema = z
  .object({
    version: z.literal(1),
    note: z.string(),
    fps: z.literal(24),
    seed: z.number().int().positive(),
    tier: z.literal('ULTRA'),
    final: z.object({ width: z.literal(3840), height: z.literal(2160) }).strict(),
    preview: z.object({ width: z.literal(960), height: z.literal(540) }).strict(),
    shots: z
      .array(
        z
          .object({
            id: z.enum(['F1', 'F2', 'F3', 'F4', 'F6', 'F7', 'F8', 'F10']),
            title: z.string().min(1),
            frames: z.number().int().positive(),
            time: z.enum(['night', 'golden-hour']),
            preroll: z.number().min(0.25).max(10),
            player: z.object({ pos: vec2, yaw: z.number() }).strict().optional(),
            focus: vec3.optional(),
            exposure: z.number().min(0.5).max(2).optional(),
            events: z.array(event),
            camera: z.discriminatedUnion('type', [pathCamera, followCamera]),
            dof: z.object({ focus: z.number().positive(), focal: z.number().positive() }).strict().optional(),
          })
          .strict(),
      )
      .length(8),
    browser: z
      .array(z.object({ id: z.enum(['F5', 'F9']), title: z.string(), frames: z.number().int().positive(), theme: z.literal('light'), viewport: z.object({ width: z.literal(1920), height: z.literal(1080) }).strict() }).strict())
      .length(2),
  })
  .strict()
  .superRefine((spec, ctx) => {
    for (const [i, s] of spec.shots.entries()) {
      // async set-ups (the boat arrival) start with the pre-roll; nothing may start after the last frame
      for (const e of s.events) {
        if (e.type === 'arrival' && Math.abs(e.at + s.preroll) > 1e-9) ctx.addIssue({ code: 'custom', message: `${s.id}: the arrival must start with the pre-roll (at = -preroll)`, path: ['shots', i] });
        if (e.type !== 'mount' && (e.at < -s.preroll - 1e-9 || e.at > s.frames / 24)) ctx.addIssue({ code: 'custom', message: `${s.id}: event ${e.type} at ${e.at}s is outside the shot`, path: ['shots', i] });
      }
    }
  });

export const validateShots = (json) => shotsSchema.parse(json);
