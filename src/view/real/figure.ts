// The man at the wheel, seen from the passenger seat. He is assembled in Blender (`scripts/blender/make_driver.py`,
// `public/models/driver.glb`) from Quaternius's modular men (CC0): one skeleton of 62 bones down to the fingers, a
// moustached head with three shape keys (jaw, brows, blink), and a flat cap hung on the head bone. He arrives in a
// T-pose, 2 m tall; this file seats him, reaches his hands to the wheel through the real bones, curls his fingers,
// turns his head to you, and works his face with his own voice. The cockpit's own axes: +x forward, +y up,
// +z towards the passenger. Every bone is posed as "this rotation, in the body's space, applied to the rest pose".

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Talk } from '../../sim/chatter';
import type { Sex } from '../../../shared/driver';

/** He sits on the left. */
const SEAT_Z = -0.36;
/** The puppet is two metres tall; he is not. */
const SCALE = 0.9;
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const m1 = new THREE.Matrix4();

type HandPose = 'grip' | 'open' | 'point';
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'] as const;
/** How far each joint bends, for each hand he makes. */
const CURL: Record<HandPose, { fingers: number; index: number; thumb: number }> = {
  grip: { fingers: 0.95, index: 0.85, thumb: 0.55 },
  open: { fingers: 0.08, index: 0.05, thumb: 0.15 },
  point: { fingers: 1.05, index: 0.0, thumb: 0.5 },
};

interface Rest {
  quat: THREE.Quaternion;
  pos: THREE.Vector3;
}

interface Arm {
  side: 1 | -1;
  upper: THREE.Bone;
  lower: THREE.Bone;
  wrist: THREE.Bone;
  fingers: THREE.Bone[][];
  thumb: THREE.Bone[];
  shoulder: THREE.Vector3;
  lengths: { upper: number; lower: number };
  /** The rest frame of the hand: where the fingers point and the palm faces, in the T-pose. */
  restFrame: THREE.Matrix4;
  pole: THREE.Vector3;
  target: THREE.Vector3;
  palm: THREE.Vector3;
  curl: { fingers: number; index: number; thumb: number };
}

interface Rig {
  puppet: THREE.Object3D;
  rest: Map<THREE.Object3D, Rest>;
  head: THREE.Bone;
  neck: THREE.Bone;
  abdomen: THREE.Bone;
  arms: Arm[];
  face: THREE.Mesh | null;
  materials: Map<string, THREE.MeshStandardMaterial>;
}

export interface FigureState {
  talk: Talk;
  /** How far the wheel is turned, as the cockpit turns it. */
  steer: number;
  speed: number;
  /** The wheel, in the cockpit's space: his hands go on its rim. */
  wheel: THREE.Object3D;
  /** The horn is a hand too. */
  honking: boolean;
}

const SHIRTS = ['#5c7ea6', '#9a8b62', '#5f8a70', '#a36a5a', '#75709a', '#8c8768', '#4a6683', '#8f6f52'];
const CAPS = ['#3d3830', '#2a2f38', '#4a3d31', '#33392f'];
const HAIR = ['#2b2320', '#4a4440', '#6b6660', '#1d1a18', '#8a847c'];

export class DriverFigure {
  readonly group = new THREE.Group();
  /** How annoyed he is, 0..1: the tells read it. Never a number on screen. */
  tension = 0;
  private readonly cigarette = new THREE.Group();
  private cigaretteLeft = 1;
  private cigaretteOut = 0;
  private readonly ember: THREE.MeshBasicMaterial;
  /** Everything that leans: the whole puppet. */
  private readonly body = new THREE.Group();
  private rig: Rig | null = null;
  private seed = 0;
  private disposed = false;
  private clock = 0;
  private turn = 0;
  private nod = 0;
  private raise = 0;
  private shrug = 0;
  private bothUp = 0;
  private point = 0;
  private anger = 0;
  private glanceAt = 3;
  private glanceFor = 0;
  private blinkAt = 2;
  private blink = 0;
  private readonly bodyInverse = new THREE.Matrix4();

  private sex: Sex = 'm';
  private loading = 0;

  constructor() {
    this.group.add(this.body);
    // The cigarette: a white stub with an ember, held between two fingers of the hand at the window.
    const paper = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1, 8).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: '#f2eee4', roughness: 0.9 }));
    paper.name = 'paper';
    this.ember = new THREE.MeshBasicMaterial({ color: '#ff5a1a', toneMapped: false });
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.006, 8), this.ember);
    tip.name = 'tip';
    this.cigarette.add(paper, tip);
    this.cigarette.visible = false;
    this.body.add(this.cigarette);
    this.load('m');
  }

  /** A man or a woman at the wheel: another puppet, the same strings. */
  load(sex: Sex) {
    if (this.rig && this.sex === sex) return;
    this.sex = sex;
    const ticket = ++this.loading;
    new GLTFLoader()
      .loadAsync(`${import.meta.env.BASE_URL}models/${sex === 'f' ? 'driver_f' : 'driver'}.glb`)
      .then((gltf) => {
        if (this.disposed || ticket !== this.loading) return;
        if (this.rig) {
          this.body.remove(this.rig.puppet);
          this.rig.puppet.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
          this.rig = null;
        }
        this.adopt(gltf.scene);
      })
      .catch((error) => console.warn('the driver did not arrive; the seat stays empty', error));
  }

  private adopt(puppet: THREE.Object3D) {
    const materials = new Map<string, THREE.MeshStandardMaterial>();
    let face: THREE.Mesh | null = null;
    let skinned: THREE.SkinnedMesh | null = null;
    puppet.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
      // Blender numbers materials that share a name: "q-Skin.003" is still q-Skin.
      materials.set((o.material as THREE.Material).name.split('.')[0], o.material as THREE.MeshStandardMaterial);
      if (o.morphTargetDictionary && 'jawOpen' in o.morphTargetDictionary) face = o;
      if (o instanceof THREE.SkinnedMesh) skinned = o;
    });
    if (!skinned) throw new Error('the driver has no skeleton');
    // The loader strips the dots from bone names: "UpperArm.R" is "UpperArmR" here.
    const bones = new Map<string, THREE.Bone>();
    for (const b of (skinned as THREE.SkinnedMesh).skeleton.bones) bones.set(b.name, b);
    const bone = (name: string) => {
      const b = bones.get(name);
      if (!b) throw new Error(`the driver has no bone ${name}`);
      return b;
    };
    // He faces +z as he comes; the car faces +x.
    puppet.rotation.set(0, Math.PI / 2, 0);
    puppet.scale.setScalar(SCALE);
    puppet.position.set(0.02, 0, SEAT_Z);
    this.body.add(puppet);
    // Every bone's rest pose, in the body's space, before anything is moved.
    const rest = new Map<THREE.Object3D, Rest>();
    const walk = (o: THREE.Object3D, parent: THREE.Matrix4) => {
      const m = new THREE.Matrix4().compose(o.position, o.quaternion, o.scale).premultiply(parent);
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      m.decompose(pos, quat, v1);
      rest.set(o, { quat, pos });
      for (const c of o.children) walk(c, m);
    };
    walk(puppet, new THREE.Matrix4());
    // Seated: the hips a little above the cushion.
    const lift = 0.53 - rest.get(bone('Hips'))!.pos.y;
    puppet.position.y += lift;
    for (const r of rest.values()) r.pos.y += lift;

    const at = (b: THREE.Object3D) => rest.get(b)!.pos;
    const arms: Arm[] = (['R', 'L'] as const).map((tag) => {
      const side: 1 | -1 = tag === 'R' ? 1 : -1;
      const upper = bone(`UpperArm${tag}`);
      const lower = bone(`LowerArm${tag}`);
      const wrist = bone(`Wrist${tag}`);
      // Where the fingers point and the palm faces at rest: along the arm, and down (a T-pose).
      const f0 = at(bone(`Index1${tag}`)).clone().sub(at(wrist)).normalize();
      const p0 = new THREE.Vector3(0, -1, 0).addScaledVector(f0, -f0.y).normalize();
      return {
        side,
        upper,
        lower,
        wrist,
        // The first bone of each finger is inside the palm; the joints that bend are the three after it.
        fingers: FINGERS.map((name) => [2, 3, 4].map((i) => bone(`${name}${i}${tag}`))),
        thumb: [2, 3].map((i) => bone(`Thumb${i}${tag}`)),
        shoulder: at(upper).clone(),
        lengths: { upper: at(lower).distanceTo(at(upper)), lower: at(wrist).distanceTo(at(lower)) },
        restFrame: new THREE.Matrix4().makeBasis(f0, p0, new THREE.Vector3().crossVectors(f0, p0)),
        pole: new THREE.Vector3(-0.35, -1, side * 0.5).normalize(),
        target: at(upper).clone().add(new THREE.Vector3(0.3, -0.2, 0)),
        palm: new THREE.Vector3(0, 0, -side),
        curl: { ...CURL.grip },
      };
    });
    this.rig = { puppet, rest, head: bone('Head'), neck: bone('Neck'), abdomen: bone('Abdomen'), arms, face, materials };

    // The legs: thighs forward along the cushion, shins down to the pedals, feet on them. They do not move again.
    for (const tag of ['R', 'L'] as const) {
      const side = tag === 'R' ? 1 : -1;
      const upperLeg = bone(`UpperLeg${tag}`);
      const lowerLeg = bone(`LowerLeg${tag}`);
      const foot = bone(`Foot${tag}`);
      const thigh = new THREE.Vector3(0.96, -0.12, side * 0.12).normalize();
      const shin = new THREE.Vector3(0.28, -1, side * 0.04).normalize();
      this.aim(upperLeg, at(lowerLeg).clone().sub(at(upperLeg)), thigh);
      // The shin bone runs on down from the knee, the way the thigh runs down from the hip.
      const shinLength = at(lowerLeg).distanceTo(at(upperLeg)) * 0.95;
      this.aim(lowerLeg, at(lowerLeg).clone().sub(at(upperLeg)), shin);
      // The feet hang off the root, not the shins: they are put where the shins end.
      const ankle = at(upperLeg).clone().addScaledVector(thigh, at(lowerLeg).distanceTo(at(upperLeg))).addScaledVector(shin, shinLength);
      const parent = foot.parent!;
      const restParent = rest.get(parent)!;
      foot.position.copy(ankle).sub(restParent.pos).applyQuaternion(restParent.quat.clone().invert()).divideScalar(SCALE);
      this.setWorld(foot, q1.setFromAxisAngle(v1.set(0, 0, 1), 0.2));
    }
    this.dress(this.seed);
  }

  // --- Posing bones -------------------------------------------------------------------------------------

  /** A bone's rotation now, in the body's space: its parents' turns, then its own. */
  private worldOf(o: THREE.Object3D | null, out: THREE.Quaternion): THREE.Quaternion {
    if (!o || o === this.body) return out.identity();
    this.worldOf(o.parent, out);
    return out.multiply(o.quaternion);
  }

  /** Where a bone is now, in the body's space. */
  private positionOf(o: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
    const chain: THREE.Object3D[] = [];
    for (let p: THREE.Object3D | null = o; p && p !== this.body; p = p.parent) chain.push(p);
    m1.identity();
    for (let i = chain.length - 1; i >= 0; i--) m1.multiply(new THREE.Matrix4().compose(chain[i].position, chain[i].quaternion, chain[i].scale));
    return out.setFromMatrixPosition(m1);
  }

  /** Turn a bone by `r` (in the body's space) away from its rest pose. */
  private setWorld(bone: THREE.Object3D, r: THREE.Quaternion) {
    const rest = this.rig!.rest.get(bone)!;
    const parent = this.worldOf(bone.parent, q2).invert();
    bone.quaternion.copy(parent).multiply(r).multiply(rest.quat);
  }

  /** Point a bone whose rest axis is `axis` (in the body's space) along `d`. */
  private aim(bone: THREE.Object3D, axis: THREE.Vector3, d: THREE.Vector3) {
    this.setWorld(bone, q1.setFromUnitVectors(v2.copy(axis).normalize(), d));
  }

  /** Everybody's driver is somebody else: the shirt, the cap, the hair and the tan change with who he is. */
  dress(seed: number) {
    this.seed = seed;
    const m = this.rig?.materials;
    if (!m) return;
    m.get(this.sex === 'f' ? 'q-White' : 'q-LightBrown')?.color.set(SHIRTS[Math.abs(seed) % SHIRTS.length]);
    m.get('driver-cap')?.color.set(CAPS[Math.abs(seed >> 3) % CAPS.length]);
    m.get('q-Skin')?.color.setScalar(0.85 + ((seed >> 5) % 5) * 0.07);
    const hair = HAIR[Math.abs(seed >> 2) % HAIR.length];
    for (const [name, material] of m) if (name.startsWith('q-Hair') || name === 'q-Moustache' || name === 'q-Eyebrows') material.color.set(hair);
  }

  update(dt: number, s: FigureState) {
    const rig = this.rig;
    if (!rig) return;
    const { talk } = s;
    this.clock += dt;
    const ease = (from: number, to: number, rate: number) => from + (to - from) * (1 - Math.exp(-dt * rate));
    const speaking = talk.speaking;
    // Gestures come in bursts while he speaks: up for a couple of seconds, back to the wheel, up again.
    // Sour, he keeps both hands on the wheel and his eyes on the road: no gestures, no glances.
    const sour = this.tension > 0.7;
    const burst = speaking && talk.since % 4.6 < 2.7 && talk.since > 0.15 && !sour;
    const g = speaking && !sour ? talk.gesture : 'none';
    this.raise = ease(this.raise, burst && g === 'hand' ? 1 : 0, 7);
    this.point = ease(this.point, burst && g === 'point' ? 1 : 0, 7);
    this.shrug = ease(this.shrug, burst && g === 'shrug' ? 1 : 0, 6);
    this.bothUp = ease(this.bothUp, speaking && g === 'both_hands' && talk.since < 3.2 ? 1 : 0, 9);
    this.anger = ease(this.anger, speaking ? (talk.mood === 'shout' ? 1 : talk.mood === 'rant' ? 0.7 : talk.mood === 'grumble' ? 0.4 : talk.mood === 'sigh' ? -0.5 : talk.mood === 'tender' ? -0.8 : -0.2) : 0.25, 5);

    // He looks at the road, mostly. At you when he wants agreement.
    this.glanceAt -= dt;
    if (this.glanceAt < 0) {
      this.glanceAt = speaking ? 2.5 + Math.random() * 3.5 : 6 + Math.random() * 8;
      this.glanceFor = speaking ? 0.9 + Math.random() * 0.9 : 0.5;
    }
    this.glanceFor -= dt;
    const looking = !sour && ((speaking && g === 'look_at_passenger' && talk.since < 2.4) || (this.glanceFor > 0 && talk.mood !== 'shout' && s.speed < 14));
    this.turn = ease(this.turn, looking ? 1 : 0, 5);
    this.nod = ease(this.nod, talk.level, 18);
    this.blinkAt -= dt;
    if (this.blinkAt < 0) {
      this.blinkAt = 2.5 + Math.random() * 4;
      this.blink = 1;
    }
    this.blink = Math.max(0, this.blink - dt * 9);

    // --- The face ---
    const open = Math.max(0, this.anger);
    const face = rig.face;
    if (face?.morphTargetInfluences && face.morphTargetDictionary) {
      const put = (name: string, value: number) => {
        const i = face.morphTargetDictionary![name];
        if (i !== undefined) face.morphTargetInfluences![i] = value;
      };
      put('jawOpen', Math.min(1, this.nod * 1.1));
      put('browsDown', open * 0.9);
      put('blink', this.blink > 0.5 ? (1 - this.blink) * 2 : this.blink * 2);
    }

    // --- The body: leaning back into the seat, into an argument, shoulders up for a shrug ---
    const lean = 0.17 + open * (speaking ? 0.06 : 0) + this.bothUp * 0.06;
    this.setWorld(rig.abdomen, q1.setFromAxisAngle(v1.set(0, 0, 1), lean).multiply(q2.setFromAxisAngle(v2.set(1, 0, 0), Math.sin(this.clock * 1.4) * 0.01 + this.shrug * 0.03)));
    // The head: turned to you, nodding with the voice, cocked in doubt.
    const wag = Math.sin(this.clock * 17) * 0.5 + Math.sin(this.clock * 11.3) * 0.5;
    // Curt, he shakes his head slowly now and then; sour, he grips the wheel and stares ahead.
    const headShake = this.tension > 0.35 && this.tension < 0.85 ? Math.sin(this.clock * 2.6) * 0.06 * Math.max(0, Math.sin(this.clock * 0.23)) : 0;
    const yaw = -this.turn * 0.95 + s.steer * 0.08 + (speaking ? wag * 0.025 * this.nod : 0) + headShake;
    const pitch = -this.nod * 0.06 - open * 0.05 + Math.sin(this.clock * 0.9) * 0.012;
    this.setWorld(rig.neck, q1.setFromEuler(new THREE.Euler(0, yaw * 0.35, pitch * 0.4, 'YZX')));
    this.setWorld(rig.head, q1.setFromEuler(new THREE.Euler(this.shrug * 0.06 + this.bothUp * 0.08, yaw, pitch, 'YZX')));

    // --- The hands: on the rim at ten to two, unless they have something to say ---
    const round = THREE.MathUtils.clamp(-s.steer * 1.5, -0.85, 0.85);
    s.wheel.updateMatrix();
    this.group.updateMatrix();
    this.body.updateMatrix();
    this.bodyInverse.copy(this.body.matrix).invert();
    m1.copy(this.group.matrix).invert().multiply(s.wheel.matrix);
    const hub = v3.set(0, 0, 0).applyMatrix4(m1).applyMatrix4(this.bodyInverse).clone();
    const shake = Math.sin(this.clock * 13) * 0.035;
    for (const arm of rig.arms) {
      const hours = arm.side * 0.95 + round;
      const onRim = v1.set(-0.012, Math.cos(hours) * 0.18, Math.sin(hours) * 0.18).applyMatrix4(m1).applyMatrix4(this.bodyInverse).clone();
      const target = onRim.clone();
      const palm = hub.clone().sub(onRim).normalize();
      let pose: HandPose = 'grip';
      const mix = (x: number, y: number, z: number, px: number, py: number, pz: number, k: number, hand: HandPose) => {
        if (k < 0.01) return;
        target.lerp(v2.set(x, y, z), k);
        palm.lerp(v2.set(px, py, pz).normalize(), k);
        if (k > 0.5) pose = hand;
      };
      const z = arm.shoulder.z;
      if (arm.side === 1) {
        // The hand nearer you stays below his chin and out over the dash: you should see his face while he shouts.
        mix(0.42, 1.0 + shake * 0.6, z + 0.12 + shake, 0.8, 0.2, 0.4, this.raise, 'open');
        mix(0.5, 1.04, z - 0.02 + shake * 0.3, 0, -0.3, -1, this.point, 'point');
        mix(0.36, 0.92, z + 0.16, 0.1, 1, 0.2, this.shrug, 'open');
        mix(0.42, 1.0 + shake, z + 0.14, 0.2, 1, 0.3, this.bothUp, 'open');
        if (s.honking) mix(hub.x - 0.02, hub.y + 0.02, hub.z, -1, -0.2, 0, 0.9, 'open');
      } else {
        mix(0.34, 0.94, z - 0.14, -0.1, 1, -0.2, this.shrug, 'open');
        mix(0.36, 1.15 - shake, z - 0.1, 0.2, 1, -0.3, this.bothUp, 'open');
      }
      // The cigarette in the left hand, at the window, when he is not gesturing with it. It burns the faster the more annoyed he is.
      if (arm.side === -1) {
        const idle = pose === 'grip';
        this.cigaretteLeft -= dt * (0.004 + this.tension * 0.03);
        if (this.cigaretteLeft <= 0) {
          this.cigaretteOut = 20 + Math.random() * 30;
          this.cigaretteLeft = 1;
          this.cigarette.visible = false;
        }
        if (this.cigaretteOut > 0) this.cigaretteOut -= dt;
        else this.cigarette.visible = idle;
      }
      // Waiting: fingers drumming on the rim.
      if (s.speed < 0.3 && !speaking && arm.side === 1) target.y += Math.max(0, Math.sin(this.clock * 9)) * 0.012;
      arm.target.lerp(target, 1 - Math.exp(-dt * 12));
      arm.palm.lerp(palm, 1 - Math.exp(-dt * 10)).normalize();
      const want = CURL[pose];
      // The grip tightens with his mood: knuckles on the rim.
      if (pose === 'grip') want.fingers = 0.95 + this.tension * 0.25;
      arm.curl.fingers = ease(arm.curl.fingers, want.fingers, 14);
      arm.curl.index = ease(arm.curl.index, want.index, 14);
      arm.curl.thumb = ease(arm.curl.thumb, want.thumb, 14);
      this.reach(arm);
    }
  }

  /** Two bones that must bring the wrist to `arm.target`: the elbow goes where the pole says it hangs. Then the hand. */
  private reach(arm: Arm) {
    const rest = this.rig!.rest;
    // The shoulder is wherever the torso's lean has taken it.
    const s = this.positionOf(arm.upper, arm.shoulder);
    const { upper: L1, lower: L2 } = arm.lengths;
    const to = v1.subVectors(arm.target, s);
    const d = THREE.MathUtils.clamp(to.length(), 0.08, L1 + L2 - 0.003);
    to.normalize();
    const along = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
    const out = Math.sqrt(Math.max(0, L1 * L1 - along * along));
    const side = v2.copy(arm.pole).addScaledVector(to, -arm.pole.dot(to)).normalize();
    const elbow = v3.copy(s).addScaledVector(to, along).addScaledVector(side, out);
    const d1 = elbow.clone().sub(s).normalize();
    const d2 = s.clone().addScaledVector(to, d).sub(elbow).normalize();
    this.aim(arm.upper, rest.get(arm.lower)!.pos.clone().sub(rest.get(arm.upper)!.pos), d1);
    this.aim(arm.lower, rest.get(arm.wrist)!.pos.clone().sub(rest.get(arm.lower)!.pos), d2);
    // The hand: fingers on from the forearm, the palm where it is wanted.
    const f = d2;
    const p = arm.palm.clone().addScaledVector(f, -arm.palm.dot(f));
    if (p.lengthSq() < 1e-6) p.set(0, -1, 0).addScaledVector(f, -f.y);
    p.normalize();
    const frame = m1.makeBasis(f, p, new THREE.Vector3().crossVectors(f, p));
    const r = q1.setFromRotationMatrix(frame).multiply(q2.setFromRotationMatrix(arm.restFrame).invert()).clone();
    this.setWorld(arm.wrist, r);
    // The fingers curl towards the palm, each joint a little more than the last.
    const axis = new THREE.Vector3().crossVectors(f, p).normalize();
    for (const [i, finger] of arm.fingers.entries()) {
      const bend = i === 0 ? arm.curl.index : arm.curl.fingers * (i === 3 ? 1.1 : 1);
      for (const [k, phalanx] of finger.entries()) this.setWorld(phalanx, q1.setFromAxisAngle(axis, bend * (k + 1) * 0.8).multiply(r));
    }
    const thumbAxis = new THREE.Vector3().copy(p).negate().addScaledVector(axis, 0.4).normalize();
    for (const [k, phalanx] of arm.thumb.entries()) this.setWorld(phalanx, q1.setFromAxisAngle(thumbAxis, arm.curl.thumb * (k + 1) * 0.6).multiply(r));
    if (arm.side === -1 && this.cigarette.visible) {
      // Between the index and the middle finger, pointing on past the fingertips, with the ember glowing.
      const knuckle = this.positionOf(arm.fingers[0][1], new THREE.Vector3());
      this.cigarette.position.copy(knuckle).addScaledVector(axis, 0.006);
      this.cigarette.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), f.clone().addScaledVector(p, -0.35).normalize());
      const length = 0.02 + 0.06 * this.cigaretteLeft;
      const paper = this.cigarette.getObjectByName('paper')!;
      paper.scale.y = length;
      this.cigarette.getObjectByName('tip')!.position.y = length;
      this.ember.color.setHex(Math.sin(this.clock * 3) > 0.6 ? 0xff8a3a : 0xc03a12);
    }
  }

  dispose() {
    this.disposed = true;
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
