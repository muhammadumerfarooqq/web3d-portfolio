// P3.4 bug fixes from the real-browser test: controls (walk + ride directions, camera feel), the horse's
// body collider and dry-land rule (checked against the real island ground, decoded from town.glb), the
// real rowboat on the shared wave function, the Row clip and oars, and the round-particle MRT fix.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { OAR_REST, oarPose, openHull } from '../src/explore/boat.js';
import { AVATAR, CAMERA, HORSE_BODY, NODES, OARS_JSON_URL, OARS_URL, SEA_LEVEL, TOWN_JSON_URL } from '../src/explore/config.js';
import { angleDelta, boomStep, closestOnSegment2D, inputVector, pushFromSegment, shouldRecentre, turnToward, worldMove } from '../src/explore/controller-math.js';
import { DRY, FOOTPRINT, areaDry, footprintDry, isDry, stopSpot, wanderTarget } from '../src/explore/horse-land.js';
import { buildStreetGraph } from '../src/explore/horse-path.js';
import { createRide, headingVectors, rideStep, turnHeading } from '../src/explore/horse-ride.js';
import { DAY, NIGHT } from '../src/explore/time-of-day.js';
import { calmAt, depthSampler, floatPose, gerstner, seaHeight } from '../src/explore/waves.js';
import { glbJson, meshBounds } from './helpers/glb-bounds.js';
import { decodeMeshNode, groundSampler } from './helpers/draco-mesh.js';

const ROOT = join(import.meta.dirname, '..');
const pub = (url) => join(ROOT, 'public', url.replace(/^\//, ''));
const src = (f) => readFileSync(join(ROOT, 'src', 'explore', f), 'utf8');
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The gameplay camera exactly as camera-rig.js places it (boom on yaw / pitch, looking at the focus). */
function rigCamera(yaw, pitch = 0.34, distance = 6.2) {
  const cam = new PerspectiveCamera(CAMERA.fov, 16 / 9, 0.1, 1200);
  cam.position.set(Math.sin(yaw) * Math.cos(pitch) * distance, Math.sin(pitch) * distance, Math.cos(yaw) * Math.cos(pitch) * distance);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  const right = new Vector3().setFromMatrixColumn(cam.matrixWorld, 0).setY(0).normalize();
  const forward = new Vector3().setFromMatrixColumn(cam.matrixWorld, 2).negate().setY(0).normalize();
  return { right, forward };
}
const flat = (v) => new Vector3(v.x, 0, v.z).normalize();

describe('controls: walking directions are camera-relative (A left, D right, W away from the camera)', () => {
  it('W / A / S / D map to the camera’s forward / left / back / right at many camera yaws', () => {
    for (const yaw of [0, 0.7, 1.5708, 2.4, Math.PI, -0.9, -2.6, 5.1]) {
      const { right, forward } = rigCamera(yaw);
      const dir = (keys) => flat(worldMove(inputVector(keys), yaw));
      expect(dir({ right: true }).dot(right)).toBeCloseTo(1, 5); // D → screen right
      expect(dir({ left: true }).dot(right)).toBeCloseTo(-1, 5); // A → screen left
      expect(dir({ forward: true }).dot(forward)).toBeCloseTo(1, 5); // W → away from the camera
      expect(dir({ back: true }).dot(forward)).toBeCloseTo(-1, 5); // S → towards the camera
      expect(dir({ forward: true, right: true }).dot(forward.clone().add(right).normalize())).toBeCloseTo(1, 5);
    }
  });

  it('the arrow keys are mapped exactly like WASD, and the player moves with the camera yaw', () => {
    const input = src('input.js');
    for (const [a, b] of [['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown'], ['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']]) {
      const action = (code) => input.match(new RegExp(`${code}: '(\\w+)'`))?.[1];
      expect(action(a)).toBeTruthy();
      expect(action(a)).toBe(action(b));
    }
    expect(src('player.js')).toMatch(/const dir = worldMove\(input, cameraYaw\);/);
    expect(src('index.js')).toMatch(/player\.update\(dt, moveInput, rig\.yaw, surfaceUnder,/);
  });

  it('the sheriff turns smoothly towards where he walks: capped turn rate, no snapping', () => {
    let f = 0;
    f = turnToward(f, Math.PI * 0.999, 1 / 60);
    expect(Math.abs(f)).toBeLessThanOrEqual(9 / 60 + 1e-9); // one frame: at most 9 rad/s × dt
    let t = 0;
    while (Math.abs(angleDelta(f, Math.PI * 0.999)) > 0.05 && t < 2) {
      f = turnToward(f, Math.PI * 0.999, 1 / 60);
      t += 1 / 60;
    }
    expect(t).toBeGreaterThan(0.3); // a visible swing…
    expect(t).toBeLessThan(0.9); // …but still responsive
    expect(src('player.js')).toMatch(/facing = turnToward\(facing, Math\.atan2\(velocity\.x, velocity\.z\), dt\)/);
  });
});

describe('controls: riding (A turns left, D turns right)', () => {
  const speeds = { Walk: 1.6, Trot: 3.5, Gallop: 8 };
  const ride = (steer, seconds, startYaw) => {
    const st = createRide(speeds);
    let yaw = startYaw;
    st.level = 2;
    st.speed = speeds.Trot;
    for (let t = 0; t < seconds; t += 1 / 60) {
      rideStep(st, { forward: false, back: false, steer }, 1 / 60);
      yaw = turnHeading(yaw, st.yawRate, 1 / 60);
    }
    return yaw;
  };

  it('D turns towards the rider’s (and the chase camera’s) right, A towards the left, at any heading', () => {
    for (const start of [0, 1.1, Math.PI, -2.3]) {
      const { right } = headingVectors(start);
      // The riding camera sits behind the horse: camera yaw = horse yaw + π.
      const cam = rigCamera(start + Math.PI);
      expect(right.x * cam.right.x + right.z * cam.right.z).toBeCloseTo(1, 5);
      for (const [steer, sign] of [[1, 1], [-1, -1]]) {
        const yaw = ride(steer, 0.5, start);
        const fwd = headingVectors(yaw).forward;
        expect(Math.sign(fwd.x * right.x + fwd.z * right.z)).toBe(sign);
      }
    }
  });

  it('the key / stick steer is right − left (+ stick x), and horse.js applies it with turnHeading', () => {
    expect(src('index.js')).toMatch(/const steer = Math\.max\(-1, Math\.min\(1, \(s\.right \? 1 : 0\) - \(s\.left \? 1 : 0\) \+ s\.x\)\);/);
    expect(src('horse.js')).toMatch(/yaw = turnHeading\(yaw, ride\.yawRate, dt\);/);
    expect(strip(src('horse.js'))).not.toMatch(/yaw \+= ride\.yawRate/);
  });
});

describe('camera feel', () => {
  it('recentres only while walking forward, never while dragging, after a manual orbit or for S / strafing', () => {
    const base = { forward: 1, sideways: 0, speed: 3, dragging: false, sinceManual: 5 };
    expect(shouldRecentre(base)).toBe(true);
    expect(shouldRecentre({ ...base, dragging: true })).toBe(false);
    expect(shouldRecentre({ ...base, sinceManual: 0.5 })).toBe(false);
    expect(shouldRecentre({ ...base, forward: -1 })).toBe(false); // S
    expect(shouldRecentre({ ...base, forward: 0, sideways: 1 })).toBe(false); // strafe
    expect(shouldRecentre({ ...base, speed: 0 })).toBe(false);
  });

  it('lower drag sensitivity and a clamped pitch', () => {
    expect(CAMERA.yawPerPx).toBeLessThan(0.005);
    expect(CAMERA.pitchPerPx).toBeLessThan(0.004);
    expect(CAMERA.minPitch).toBeGreaterThanOrEqual(-0.15);
    expect(CAMERA.maxPitch).toBeLessThanOrEqual(1.1);
    expect(src('camera-rig.js')).toMatch(/Math\.min\(CAMERA\.maxPitch, Math\.max\(CAMERA\.minPitch, pitch \+ dy \* CAMERA\.pitchPerPx\)\)/);
  });

  it('camera collision pulls in smoothly (no one-frame snap) and eases back out', () => {
    const one = boomStep(6, 1, 1 / 60);
    expect(one).toBeLessThan(6);
    expect(6 - one).toBeLessThan(0.5 * 5); // less than half the gap in one frame
    let d = 6;
    for (let i = 0; i < 20; i += 1) d = boomStep(d, 1, 1 / 60);
    expect(d).toBeLessThan(1.2); // in place within ~1/3 s
    const out = boomStep(1, 6, 1 / 60);
    expect(out - 1).toBeLessThan(0.25); // releases slowly
    expect(src('camera-rig.js')).toMatch(/actualDistance = boomStep\(actualDistance, d, dt\);/);
  });

  it('pointer-lock look: a click on the view locks, Esc (the browser) releases, Tab is never captured', () => {
    const input = src('input.js');
    expect(input).toMatch(/surface\.requestPointerLock\(\)/);
    expect(input).toMatch(/document\.exitPointerLock/);
    expect(input).toMatch(/'pointerlockchange'/);
    expect(input).not.toMatch(/Tab['"]\s*[:)]/); // no Tab handling at all
    expect(strip(src('hud.js'))).toMatch(/setLegend\(mode\)/);
    expect(src('index.js')).toMatch(/hud\.setLegend\(riding \? 'ride' : 'walk'\);/);
  });
});

describe('the horse: a solid body and dry land only', () => {
  const body = { ax: 0, az: HORSE_BODY.tail, bx: 0, bz: HORSE_BODY.chest, r: HORSE_BODY.radius };

  it('the body capsule blocks the player capsule from every direction (he can never stand inside)', () => {
    const pr = 0.32;
    for (let k = 0; k < 24; k += 1) {
      const a = (k / 24) * Math.PI * 2;
      let px = Math.sin(a) * 4;
      let pz = Math.cos(a) * 4;
      // Walk straight at the middle of the horse for 3 s at walking speed.
      for (let i = 0; i < 180; i += 1) {
        const len = Math.hypot(px, pz) || 1;
        px -= (px / len) * 3.2 * (1 / 60);
        pz -= (pz / len) * 3.2 * (1 / 60);
        const p = pushFromSegment(px, pz, pr, body.ax, body.az, body.bx, body.bz, body.r);
        px = p.x;
        pz = p.z;
      }
      const c = closestOnSegment2D(px, pz, body.ax, body.az, body.bx, body.bz);
      expect(Math.hypot(px - c.x, pz - c.z)).toBeGreaterThanOrEqual(body.r + pr - 1e-6);
    }
    // Dead centre: pushed out sideways.
    const p = pushFromSegment(0, 0.2, pr, body.ax, body.az, body.bx, body.bz, body.r);
    expect(p.hit).toBe(true);
    expect(Math.abs(p.x)).toBeCloseTo(body.r + pr, 6);
  });

  it('the capsule matches the horse mesh, the player update uses it, and Mount measures from its surface', () => {
    const b = meshBounds(pub('/models/horse.glb')).horse;
    expect(HORSE_BODY.tail).toBeGreaterThan(b.min.z);
    expect(HORSE_BODY.chest).toBeLessThan(b.max.z);
    expect(HORSE_BODY.radius).toBeGreaterThanOrEqual(b.max.x);
    const player = src('player.js');
    expect(player).toMatch(/pushFromSegment\(position\.x, position\.z, R, o\.ax, o\.az, o\.bx, o\.bz, o\.r\)/);
    expect(src('index.js')).toMatch(/const body = horse\?\.obstacle\(\);[\s\S]{0,140}player\.update\(dt, moveInput, rig\.yaw, surfaceUnder, body \? \[body\] : null\)/);
    expect(src('horse.js')).toMatch(/Math\.hypot\(p\.x - c\.x, p\.z - c\.z\) - b\.r < HORSE_BODY\.mountReach/);
    expect(HORSE_BODY.mountReach).toBeLessThan(1.6);
  });

  describe('against the real island ground (Draco-decoded from town.glb, BVH ray hits)', () => {
    let ground;
    let nodes;
    beforeAll(async () => {
      ground = await groundSampler(pub('/models/town.glb'));
      const graph = buildStreetGraph(JSON.parse(readFileSync(pub(TOWN_JSON_URL), 'utf8')));
      nodes = graph.nodes.filter((n) => areaDry(ground, n.x, n.z)); // the runtime filter (horse.js)
    }, 30000);
    const bodyOnLand = (x, z, yaw) => {
      const s = Math.sin(yaw);
      const c = Math.cos(yaw);
      return FOOTPRINT.every(([lx, lz]) => {
        const h = ground(x + lx * c + lz * s, z - lx * s + lz * c);
        return h !== null && h >= SEA_LEVEL + DRY; // BVH ground hit, well above the sea
      });
    };

    it('every street node the horse may spawn at or travel through is dry ground', () => {
      expect(nodes.length).toBeGreaterThanOrEqual(15);
      for (const n of nodes) expect(bodyOnLand(n.x, n.z, 0) && bodyOnLand(n.x, n.z, Math.PI / 2)).toBe(true);
    });

    it('every stop point beside the sheriff — anywhere he can stand, shore included — is on dry land', () => {
      let checked = 0;
      let snapped = 0;
      let oldRuleWet = 0;
      for (let x = -64; x <= 64; x += 2) {
        for (let z = -64; z <= 64; z += 2) {
          const h = ground(x, z);
          if (h === null || SEA_LEVEL - h > 0.12) continue; // he cannot stand in deeper water
          for (const facing of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
            const spot = stopSpot({ heightAt: ground, clear: () => true, nodes, p: { x, z }, facing });
            // The P3.3 rule (origin no deeper than 15 cm) would have stopped here, wet or not:
            const ox = x + Math.sin(facing + Math.PI / 2) * 1.9;
            const oz = z + Math.cos(facing + Math.PI / 2) * 1.9;
            const oh = ground(ox, oz);
            if (oh !== null && SEA_LEVEL - oh <= 0.15 && !bodyOnLand(ox, oz, facing)) oldRuleWet += 1;
            if (!spot) continue;
            checked += 1;
            if (spot.snapped) snapped += 1;
            expect(bodyOnLand(spot.x, spot.z, spot.yaw)).toBe(true);
          }
        }
      }
      expect(checked).toBeGreaterThan(1000);
      expect(snapped).toBeGreaterThan(0); // the shore cases snap to a street node
      expect(oldRuleWet).toBeGreaterThan(0); // and the old rule really did put him in the surf
    });

    it('wandering never leaves dry land (the target shrinks towards the horse until dry)', () => {
      let rng = 7;
      const random = () => {
        rng = (rng * 16807) % 2147483647;
        return rng / 2147483647;
      };
      for (const n of nodes) {
        for (let i = 0; i < 40; i += 1) {
          const w = wanderTarget({ heightAt: ground, clear: () => true, x: n.x, z: n.z, rng: random });
          if (w) expect(bodyOnLand(w.x, w.z, w.yaw)).toBe(true);
        }
      }
      // At the waterline every direction may be wet: it stays put rather than walk into the sea.
      const wet = (x) => (x > 0 ? SEA_LEVEL - 1 : 0);
      expect(wanderTarget({ heightAt: (x) => wet(x), clear: () => true, x: 0.1, z: 0, rng: () => 0.25 })).toBe(null);
    });

    it('the land rules are pure and strict (dry = 25 cm above the sea, whole footprint)', () => {
      const h = (x) => (x < 1 ? 0 : SEA_LEVEL);
      expect(isDry(h, 0, 0)).toBe(true);
      expect(isDry(h, 2, 0)).toBe(false);
      expect(isDry(() => null, 0, 0)).toBe(false);
      expect(footprintDry(h, 0, 0, 0)).toBe(true);
      expect(footprintDry(h, 0.2, 0, Math.PI / 2)).toBe(false); // its nose would be in the water
      const horse = src('horse.js');
      expect(horse).toMatch(/wanderTarget\(\{ heightAt, clear, x: position\.x, z: position\.z \}\)/);
      expect(horse).toMatch(/stopSpot\(\{ heightAt, clear: clearLow, nodes: graph\.nodes, p, facing: player\.facing, reach: HORSE\.reach \}\)/);
      expect(horse).toMatch(/raw\.nodes\.filter\(\(n\) => areaDry\(heightAt, n\.x, n\.z\)\)/);
    });
  });
});

describe('the rowboat: one real boat on the shared waves', () => {
  it('town.glb has exactly one rowboat node (Rowboat_baked) and the dock no longer contains a boat', () => {
    const j = glbJson(pub('/models/town.glb'));
    const boats = j.nodes.filter((n) => /rowboat/i.test(n.name));
    expect(boats.map((n) => n.name)).toEqual([NODES.rowboat]);
    const b = meshBounds(pub('/models/town.glb'));
    expect(b.Dock_baked.max.x).toBeLessThan(5); // P3.3's merged dock reached x 6.8 (the boat inside it)
    expect(b.Rowboat_baked.min.x).toBeGreaterThan(b.Dock_baked.max.x);
  });

  it('the baked hull is opened at runtime: its flat lid over the thwarts goes, the thwarts stay, both sides draw', async () => {
    const geometry = await decodeMeshNode(pub('/models/town.glb'), NODES.rowboat);
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    const before = geometry.index.count / 3;
    const { removed, lid: lidIndex } = openHull(mesh);
    expect(lidIndex.length / 3).toBe(removed); // kept for the water mask
    expect(removed).toBeGreaterThan(100); // the lid (180 of 396 triangles in this export)
    const pos = geometry.attributes.position;
    const idx = geometry.index.array;
    geometry.computeBoundingBox();
    const top = Math.max(...Array.from({ length: pos.count }, (_, i) => pos.getY(i)));
    let lid = 0;
    let thwarts = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const ys = [0, 1, 2].map((k) => pos.getY(idx[t + k]));
      if (ys.every((y) => y > top - 0.004)) lid += 1;
      if (ys.every((y) => y < top - 0.015 && y > top - 0.09)) thwarts += 1;
    }
    expect(lid).toBe(0);
    expect(thwarts).toBeGreaterThan(10);
    expect(geometry.index.count / 3).toBe(before - removed);
    expect(mesh.material.side).toBe(2); // DoubleSide
    const boat = src('boat.js');
    expect(boat).toMatch(/const \{ lid \} = openHull\(mesh\);/);
    // The lid becomes an invisible depth mask drawn before the sea: no water inside the hull.
    expect(boat).toMatch(/maskMaterial\.colorWrite = false;/);
    expect(boat).toMatch(/mask\.renderOrder = MASK_ORDER;/);
    expect(src('index.js')).toMatch(/sea\.mesh\.renderOrder = SEA_ORDER;/);
  });

  it('the code-built boat is gone: the arrival drives the town’s own boat, kept whole and out of the collider', () => {
    const arrival = strip(src('arrival.js'));
    expect(arrival).not.toMatch(/buildRowboat|SphereGeometry|BoxGeometry/);
    expect(arrival).toMatch(/const hull = boat\.mesh;/);
    const world = src('world.js');
    expect(world).toMatch(/if \(name === NODES\.rowboat\) \{[\s\S]{0,160}rowboat = obj;[\s\S]{0,40}keep\.push\(obj\);[\s\S]{0,20}return;/);
  });

  it('the boat height follows the sea shader’s wave function within 2 cm (round trip through the displacement)', () => {
    // A depth texture like the one baked at load (deep water round the dock end, shoaling to the north).
    const size = 128;
    const half = 70;
    const data = new Uint8Array(size * size);
    for (let j = 0; j < size; j += 1) for (let i = 0; i < size; i += 1) data[j * size + i] = Math.max(0, Math.min(255, Math.round(((j / size) * 3.6 + 0.2) / 4 * 255)));
    const depthAt = depthSampler(data, size, half);
    let worst = 0;
    for (const phase of [0, 3.7, 11.2, 40.5, 333.3]) {
      for (let k = 0; k < 60; k += 1) {
        // A rest point near the mooring; where does the surface displace it, and how high?
        const rx = 6 + Math.sin(k * 1.7) * 3;
        const rz = 43 + Math.cos(k * 2.3) * 3;
        const o = gerstner(rx, rz, phase, calmAt(depthAt(rx, rz), rx, rz));
        const surface = SEA_LEVEL + o.y;
        const h = seaHeight(rx + o.x, rz + o.z, phase, depthAt);
        worst = Math.max(worst, Math.abs(h - surface));
        // The boat at that point: its waterline is the surface right under it.
        const pose = floatPose(rx + o.x, rz + o.z, 0.12, phase, depthAt, { freeboard: 0.3 });
        expect(Math.abs(pose.y - 0.3 - surface)).toBeLessThan(0.02);
      }
    }
    expect(worst).toBeLessThan(0.02);
  });

  it('the shader and the boat share the wave trains and the integrated phase', () => {
    const sea = src('sea.js');
    expect(sea).toMatch(/import \{ SEA_SIZE, WAVE_TRAINS \} from '\.\/waves\.js';/);
    expect(sea).toMatch(/\.sub\(u\.phase\.mul\(c\)\)/);
    expect(strip(sea)).not.toMatch(/time\.mul\(c\)/);
    // The flat far ocean no longer lies under the detailed sea (it showed through every deep trough).
    expect(sea).toMatch(/material\.maskNode = max\(abs\(positionWorld\.x\), abs\(positionWorld\.z\)\)\.greaterThan\(size \/ 2 - 0\.5\);/);
    const index = src('index.js');
    expect(index).toMatch(/sea\.uniforms\.phase\.value \+= dt \* sea\.uniforms\.wind\.value;/);
    expect(index).toMatch(/getPhase: \(\) => sea\.uniforms\.phase\.value/);
    expect(src('boat.js')).toMatch(/floatPose\(x, z, yaw, getPhase\(\), depthAt, BOAT, pose\);[\s\S]{0,300}mesh\.position\.set\(x, pose\.y, z\);/);
  });

  it('the Row clip and the oars are present, with oarlocks and the seat from oars.json', () => {
    const avatar = glbJson(pub('/models/avatar.glb'));
    expect(avatar.animations.map((a) => a.name)).toContain('Row');
    expect(AVATAR.clips).toContain('Row');
    const oars = glbJson(pub(OARS_URL));
    expect(oars.nodes.map((n) => n.name).sort()).toEqual(['Oar_L', 'Oar_L_lock', 'Oar_R', 'Oar_R_lock']);
    const meta = JSON.parse(readFileSync(pub(OARS_JSON_URL), 'utf8'));
    expect(meta.attach_to).toMatch(/Rowboat_baked/);
    expect(meta.oarlock_local_three.Oar_L).toHaveLength(3);
    expect(meta.oarlock_local_three.Oar_R[0]).toBeCloseTo(-meta.oarlock_local_three.Oar_L[0], 6);
    expect(meta.rower.seat_local_three).toHaveLength(3);
    expect(OARS_URL).toMatch(/^\/models\//);
    const arrival = src('arrival.js');
    expect(arrival).toMatch(/oarlock_local_three\?\.\[side\]/);
    expect(arrival).toMatch(/seat_local_three/);
    expect(arrival).toMatch(/getObjectByName\('hips'\)/); // hips measured at runtime, not hard-coded
    expect(arrival).toMatch(/player\.playClip\('Row', 0\)/);
  });

  it('the oar sweep follows the Row phase: blade forward and in at the catch, back at the finish, lifted on the recovery', () => {
    const catchPose = oarPose(0);
    const finish = oarPose(0.5);
    const recovery = oarPose(0.75);
    expect(catchPose.yaw).toBeCloseTo((28 * Math.PI) / 180, 6); // blade towards the bow
    expect(finish.yaw).toBeCloseTo((-28 * Math.PI) / 180, 6);
    expect(catchPose.inWater).toBe(true);
    expect(oarPose(0.25).inWater).toBe(true); // the pull
    expect(recovery.inWater).toBe(false);
    expect(recovery.dip - catchPose.dip).toBeCloseTo((10 * Math.PI) / 180, 6); // lifts ~10°
    // The blade (1.62 m out) reaches the water on the pull and clears it on the recovery.
    const bladeY = (dip) => 0.3 + 0.03 + Math.sin(dip) * 1.62; // above the sea, from the oarlock
    expect(bladeY(catchPose.dip)).toBeLessThan(0);
    expect(bladeY(recovery.dip)).toBeGreaterThan(0.1);
    expect(OAR_REST.yaw).toBeLessThan(-Math.PI / 2); // shipped: blades swung in towards the stern
  });
});

describe('visual artifacts', () => {
  it('every transparent effect is a round sprite with the quiet MRT (no square quads in GTAO / SSR / bloom)', () => {
    const mrt = src('sprite-mrt.js');
    expect(mrt).toMatch(/new BlendMode\(MaterialBlending\)/);
    expect(mrt).toMatch(/normal: vec4\(0, 0, 0, 0\), metalrough: vec4\(0, 0, 0, 0\)/);
    expect(mrt).toMatch(/for \(const name of QUIET_TARGETS\) node\.setBlendMode\(name, MATERIAL\);/);
    const particles = src('particles.js');
    const sprites = (particles.match(/new SpriteNodeMaterial\(/g) ?? []).length;
    const quiet = (particles.match(/quiet\.push\(\{ material: /g) ?? []).length;
    expect(quiet).toBe(sprites);
    expect(particles).toMatch(/for \(const q of quiet\) q\.material\.alphaTest = 0\.004;/);
    for (const f of ['fireworks.js', 'train.js', 'arrival.js']) {
      expect(src(f)).toMatch(/setQuietMrt\(/);
      expect(src(f)).toMatch(/alphaTest = 0\.0\d+/);
    }
    expect(src('lights.js')).toMatch(/setQuietMrt\(poolMat, on, float\(0\)\)/);
    expect(src('post.js')).toMatch(/particles\.setMrt\(hasMrt\);\s*for \(const e of effects\) e\?\.setMrt\?\.\(hasMrt\);/);
  });

  it('night is lifted (moon, sky fill, exposure, lighter haze) but the lanterns stay the brightest warm light', () => {
    expect(NIGHT.sunIntensity).toBeGreaterThan(0.55); // P3.3: 0.55
    expect(NIGHT.hemiIntensity).toBeGreaterThan(0.55);
    expect(NIGHT.exposure).toBeGreaterThan(1.1);
    expect(NIGHT.fogDensity).toBeLessThan(0.0135);
    const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    expect(lum(NIGHT.fogColor)).toBeGreaterThan(lum([0.05, 0.06, 0.14]));
    expect(NIGHT.lanternIntensity).toBe(1);
    expect(NIGHT.sunColor[2]).toBeGreaterThan(NIGHT.sunColor[0]); // still a cool moon against amber lanterns
    expect(NIGHT.exposure).toBeLessThan(DAY.exposure + 0.4);
  });
});
