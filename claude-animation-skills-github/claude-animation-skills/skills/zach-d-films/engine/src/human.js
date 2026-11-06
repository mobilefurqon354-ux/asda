import * as THREE from 'three';
import { materials } from './materials.js';
import { GLB, rigChains, torsoProxy } from './glbchar.js';

// ---------- torso profile (radius by height in spine space) ----------
const KEYS = [
  [-0.16, 0.150], [-0.08, 0.165], [0.0, 0.160], [0.10, 0.148], [0.20, 0.160],
  [0.30, 0.178], [0.40, 0.188], [0.46, 0.180], [0.51, 0.150], [0.55, 0.100], [0.58, 0.055],
];
export function torsoR(y) {
  if (y <= KEYS[0][0]) return KEYS[0][1];
  for (let i = 0; i < KEYS.length - 1; i++) {
    const [y0, r0] = KEYS[i], [y1, r1] = KEYS[i + 1];
    if (y <= y1) {
      const t = (y - y0) / (y1 - y0);
      const s = t * t * (3 - 2 * t);
      return r0 + (r1 - r0) * s;
    }
  }
  return KEYS[KEYS.length - 1][1];
}
export const TORSO_SX = 1.13, TORSO_SZ = 0.66;

// Lathe shell following the torso. offset(y) can be number or function.
export function torsoShell(y0, y1, offset, { ridge = 0, segs = 72, rows = 40, flare = 0 } = {}) {
  const pts = [];
  for (let i = 0; i <= rows; i++) {
    const y = y0 + (y1 - y0) * (i / rows);
    const off = typeof offset === 'function' ? offset(y) : offset;
    const f = flare ? flare * Math.max(0, (y0 + 0.12 - y) / 0.12) ** 2 : 0;
    pts.push(new THREE.Vector2(torsoR(y) + off + f, y));
  }
  const g = new THREE.LatheGeometry(pts, segs, Math.PI, Math.PI * 2);
  g.scale(TORSO_SX, 1, TORSO_SZ);
  if (ridge) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), y = p.getY(i);
      if (z > 0) {
        const k = Math.exp(-((x / 0.045) ** 2)) * Math.min(1, z / 0.08);
        const yk = Math.min(1, Math.max(0, (y - y0) / 0.1)) * Math.min(1, Math.max(0, (y1 - y) / 0.08));
        p.setZ(i, z + ridge * k * yk);
      }
    }
  }
  g.computeVertexNormals();
  return g;
}

// thick rim along the edge of a shell at height y
function rim(y, offset, tube, mat) {
  const r = torsoR(y) + offset;
  const g = new THREE.TorusGeometry(r, tube, 8, 72);
  g.rotateX(Math.PI / 2);
  g.scale(TORSO_SX, 1, TORSO_SZ);
  const m = new THREE.Mesh(g, mat);
  m.position.y = y;
  return m;
}

function sph(r, mat, pos = [0, 0, 0], scl = [1, 1, 1], seg = 32) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75)), mat);
  m.position.set(...pos); m.scale.set(...scl);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function shadowAll(o) { o.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } }); }

// ---------- people ----------
// Every person comes from the sculpted GLB (models/characters.glb), split into
// one figure per outfit and auto-rigged to the joints below.
// outfit: 'vest' | 'chainmail' | 'plate' | 'knight' | 'archer'
export function makeHuman(outfit = 'plate', opts = {}) {
  if (opts.pose && opts.pose !== 'stand') return makePosedHuman(outfit, opts.pose);
  if (!GLB.ready) throw new Error('makeHuman: models/characters.glb is not loaded (await loadCharacters() first)');
  if (!GLB.chars[outfit]) throw new Error(`makeHuman: no 3D model for outfit '${outfit}'. Available: ${Object.keys(GLB.chars).join(', ')}`);
  return makeGLBHuman(outfit, opts);
}

// ---------- person from the sculpted GLB model ----------
// Same joints and API as the procedural person; the mesh is auto-rigged to them.
// The pose the GLB was sculpted in (arms slightly out). Rotations are applied
// while binding so setPose({}) later means "arms straight down" as before.
export const GLB_BIND = {
  lSh: [0, 0, 0.13], rSh: [0, 0, -0.13], lEl: [-0.08, 0, 0], rEl: [-0.08, 0, 0],
  lHip: [0, 0, 0.035], rHip: [0, 0, -0.035], lAn: [0, 0, -0.035], rAn: [0, 0, 0.035],
};
// centre of each hand in the model (vertices out at the side, at hip height)
const handCache = new Map();
function glbHands(outfit) {
  if (handCache.has(outfit)) return handCache.get(outfit);
  const P = GLB.chars[outfit].attributes.position, out = {};
  for (const [k, s] of [['l', 1], ['r', -1]]) {
    // the hand is the outermost stuff between 0.74 and 0.9 m
    let maxX = 0;
    for (let i = 0; i < P.count; i++) { const y = P.getY(i), x = P.getX(i) * s; if (y > 0.74 && y < 0.9 && x > maxX) maxX = x; }
    const c = new THREE.Vector3(); let n = 0;
    for (let i = 0; i < P.count; i++) { const y = P.getY(i), x = P.getX(i) * s; if (y > 0.74 && y < 0.9 && x > maxX - 0.07) { c.x += P.getX(i); c.y += y; c.z += P.getZ(i); n++; } }
    if (n > 20) { c.multiplyScalar(1 / n); c.y += 0.05; out[k] = c; }   // aim at the wrist, a bit above the hand centre
  }
  handCache.set(outfit, out); return out;
}
function makeGLBHuman(outfit, opts) {
  const root = new THREE.Group();
  const pelvis = new THREE.Group(); pelvis.position.y = 0.95; root.add(pelvis);
  const spine = new THREE.Group(); pelvis.add(spine);
  const chest = new THREE.Group(); chest.position.y = 0.2; spine.add(chest);
  const neck = new THREE.Group(); neck.position.y = 0.36; chest.add(neck);
  const head = new THREE.Group(); head.position.y = 0.07; neck.add(head);
  const jaw = new THREE.Group(); jaw.position.set(0, 0.075, 0.0); head.add(jaw);
  const j = { root, pelvis, spine, chest, neck, head, jaw };
  for (const s of [1, -1]) {
    const k = s > 0 ? 'l' : 'r';
    const sh = new THREE.Group(); sh.position.set(s * 0.205, 0.26, -0.005); chest.add(sh);
    const el = new THREE.Group(); el.position.y = -0.3; sh.add(el);
    const wr = new THREE.Group(); wr.position.y = -0.27; el.add(wr);
    const hip = new THREE.Group(); hip.position.set(s * 0.095, -0.06, 0); pelvis.add(hip);
    const kn = new THREE.Group(); kn.position.y = -0.44; hip.add(kn);
    const an = new THREE.Group(); an.position.y = -0.45; kn.add(an);
    Object.assign(j, { [k + 'Sh']: sh, [k + 'El']: el, [k + 'Wr']: wr, [k + 'Hip']: hip, [k + 'Kn']: kn, [k + 'An']: an });
  }
  const JOINTS = ['pelvis', 'spine', 'chest', 'neck', 'head', 'lSh', 'lEl', 'lWr', 'rSh', 'rEl', 'rWr', 'lHip', 'lKn', 'lAn', 'rHip', 'rKn', 'rAn'];
  const apply = (p) => {
    for (const k of JOINTS) { const v = p[k] || [0, 0, 0]; j[k].rotation.set(v[0], v[1], v[2], 'YXZ'); }
    pelvis.position.y = 0.95 + (p.drop || 0);
  };
  // bind in the sculpted pose: aim each arm at where the model's hand really is
  const bind = JSON.parse(JSON.stringify(GLB_BIND));
  const hands = glbHands(outfit);
  for (const s of [1, -1]) {
    const k = s > 0 ? 'l' : 'r', hc = hands[k];
    if (!hc) continue;
    root.updateMatrixWorld(true);
    const S = new THREE.Vector3().setFromMatrixPosition(j[k + 'Sh'].matrixWorld);
    const d = hc.clone().sub(S).normalize();
    const c = Math.asin(THREE.MathUtils.clamp(d.x, -0.6, 0.6));
    const a = Math.asin(THREE.MathUtils.clamp(-d.z / Math.cos(c), -0.5, 0.5));
    bind[k + 'Sh'] = [a, 0, c]; bind[k + 'El'] = [0, 0, 0];
  }
  apply(bind); root.updateMatrixWorld(true);
  const W = (o, off = [0, 0, 0]) => new THREE.Vector3(...off).applyMatrix4(o.matrixWorld);
  const bones = [
    { parent: -1, obj: pelvis, a: W(pelvis), b: W(pelvis, [0, -0.13, 0]), r: 0.15, maxY: 0.98 },
    { parent: 0, obj: spine, a: W(spine, [0, 0.02, 0]), b: W(chest), r: 0.16 },
    { parent: 1, obj: chest, a: W(chest), b: W(chest, [0, 0.3, 0]), r: 0.17, minY: 1.08 },
    { parent: 2, obj: neck, a: W(neck), b: W(neck, [0, 0.07, 0]), r: 0.065, minY: 1.44 },
    { parent: 3, obj: head, a: W(head, [0, 0.03, 0]), b: W(head, [0, 0.2, 0]), r: 0.1, minY: 1.55 },
  ];
  for (const s of [1, -1]) {
    const k = s > 0 ? 'l' : 'r';
    const o = bones.length;
    bones.push(
      { parent: 2, obj: j[k + 'Sh'], a: W(j[k + 'Sh'], [0, 0.0, 0]), b: W(j[k + 'El']), r: 0.058, side: s, limb: true, minY: 1.0 },
      { parent: o, obj: j[k + 'El'], a: W(j[k + 'El']), b: W(j[k + 'Wr']), r: 0.046, side: s, limb: true },
      { parent: o + 1, obj: j[k + 'Wr'], a: W(j[k + 'Wr']), b: W(j[k + 'Wr'], [0, -0.17, 0]), r: 0.045, side: s, limb: true },
      { parent: 0, obj: j[k + 'Hip'], a: W(j[k + 'Hip'], [0, 0.0, 0]), b: W(j[k + 'Kn']), r: 0.085, side: s, limb: true, maxY: 0.98 },
      { parent: o + 3, obj: j[k + 'Kn'], a: W(j[k + 'Kn']), b: W(j[k + 'An']), r: 0.065, side: s, limb: true },
      { parent: o + 4, obj: j[k + 'An'], a: W(j[k + 'An'], [0, -0.03, 0]), b: W(j[k + 'An'], [0, -0.05, 0.16]), r: 0.05, side: s, limb: true, maxY: 0.12 },
    );
  }
  // chains: torso (pelvis..head), arms (shoulder..hand), legs (hip..toe)
  const idx = (o) => bones.findIndex(b => b.obj === o);
  const chains = [{
    pts: [W(pelvis, [0, -0.14, 0]), W(spine), W(chest), W(neck), W(head), W(head, [0, 0.26, 0])],
    bones: [idx(pelvis), idx(spine), idx(chest), idx(neck), idx(head)], bands: [0.05, 0.07, 0.03, 0.02], r: [0.15, 0.16, 0.17, 0.065, 0.1],
  }];
  for (const s of [1, -1]) {
    const k = s > 0 ? 'l' : 'r';
    chains.push({
      pts: [W(j[k + 'Sh']), W(j[k + 'El']), W(j[k + 'Wr']), W(j[k + 'Wr'], [0, -0.17, 0])],
      bones: [idx(j[k + 'Sh']), idx(j[k + 'El']), idx(j[k + 'Wr'])], bands: [0.035, 0.02], r: [0.058, 0.05, 0.06],
      side: s, minY: 0.6, rootBone: idx(chest), rootBand: 0.035, joinLen: 0.45,
    }, {
      pts: [W(j[k + 'Hip']), W(j[k + 'Kn']), W(j[k + 'An']), W(j[k + 'An'], [0, -0.06, 0.17])],
      bones: [idx(j[k + 'Hip']), idx(j[k + 'Kn']), idx(j[k + 'An'])], bands: [0.045, 0.03], r: [0.085, 0.065, 0.05],
      side: s, maxY: 0.98, rootBone: idx(pelvis), rootBand: 0.07, joinLen: 9,
    });
  }
  const geo = rigChains(GLB.chars[outfit].clone(), chains, bones.length);
  const mesh = new THREE.SkinnedMesh(geo, GLB.material);
  mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false;
  root.add(mesh);
  mesh.bind(new THREE.Skeleton(bones.map(b => b.obj)), new THREE.Matrix4());
  // invisible torso stand-in for raycasts and the force ripple
  const plate = torsoProxy(geo, chest, root, 1.0, 1.45, 0.2);
  chest.add(plate);
  const armor = { plate };

  const human = {
    root, j, armor, mesh, model: 'glb',
    // the sculpt has no separate jaw, so the mouth can't open; kept so shots still run
    setMouth(v) { human._mouth = v; },
    setPose(p = {}) { apply(p); },
  };
  apply({});
  return human;
}

// ---------- person in a sculpted pose (e.g. 'walk') ----------
// The figure is used exactly as modelled, so it never stretches. setPose only
// moves the whole body (drop / pelvis turn); hands get wrist groups at the
// model's hands so props can still be attached.
const posedCache = new Map();
function posedInfo(geo) {
  if (posedCache.has(geo)) return posedCache.get(geo);
  const P = geo.attributes.position;
  // hands: the forward-most and back-most skin-ish points at arm height
  let fw = null, bk = null;
  for (let i = 0; i < P.count; i++) {
    const y = P.getY(i), z = P.getZ(i);
    if (y > 0.75 && y < 1.5) {
      if (!fw || z > fw.z) fw = new THREE.Vector3(P.getX(i), y, z);
      if (y < 1.1 && (!bk || z < bk.z)) bk = new THREE.Vector3(P.getX(i), y, z);
    }
  }
  const info = { front: fw, back: bk };
  posedCache.set(geo, info); return info;
}
function makePosedHuman(outfit, pose) {
  const set = GLB.sets[pose];
  if (!set) throw new Error(`makeHuman: pose '${pose}' is not loaded (models/characters_${pose}.glb)`);
  if (!set[outfit]) throw new Error(`makeHuman: no '${pose}' model for outfit '${outfit}'. Available: ${Object.keys(set).join(', ')}`);
  const geo = set[outfit];
  const root = new THREE.Group();
  const pelvis = new THREE.Group(); pelvis.position.y = 0.95; root.add(pelvis);
  const body = new THREE.Mesh(geo, GLB.materials[pose]); body.position.y = -0.95; pelvis.add(body);
  body.castShadow = body.receiveShadow = true;
  const spine = new THREE.Group(); pelvis.add(spine);
  const chest = new THREE.Group(); chest.position.y = 0.2; spine.add(chest);
  const neck = new THREE.Group(); neck.position.y = 0.36; chest.add(neck);
  const head = new THREE.Group(); head.position.y = 0.07; neck.add(head);
  const j = { root, pelvis, spine, chest, neck, head };
  const info = posedInfo(geo);
  for (const [k, hp] of [['r', info.front], ['l', info.back]]) {
    const wr = new THREE.Group(); if (hp) wr.position.set(hp.x, hp.y - 0.95 + 0.04, hp.z); pelvis.add(wr);
    j[k + 'Wr'] = wr;
  }
  for (const k of ['lSh', 'lEl', 'rSh', 'rEl', 'lHip', 'lKn', 'lAn', 'rHip', 'rKn', 'rAn']) { j[k] = new THREE.Group(); pelvis.add(j[k]); }
  root.updateMatrixWorld(true);
  const plate = torsoProxy(geo, chest, body, 1.0, 1.45, 0.22);
  chest.add(plate);
  return {
    root, j, armor: { plate }, mesh: body, model: 'glb-' + pose,
    setMouth(v) {},
    setPose(p = {}) { pelvis.position.y = 0.95 + (p.drop || 0); const r = p.pelvis || [0, 0, 0]; pelvis.rotation.set(r[0], r[1], r[2], 'YXZ'); },
  };
}

// blend two pose objects
export function lerpPose(a, b, t) {
  const o = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (k === 'drop') { o.drop = (a.drop || 0) + ((b.drop || 0) - (a.drop || 0)) * t; continue; }
    const va = a[k] || [0, 0, 0], vb = b[k] || [0, 0, 0];
    o[k] = [0, 1, 2].map(i => va[i] + (vb[i] - va[i]) * t);
  }
  return o;
}

// standalone armor pieces for the stands in the last shot
export function standArmor(kind) {
  const M = materials();
  const g = new THREE.Group();
  let target;
  if (kind === 'plate') {
    const bp = new THREE.Mesh(torsoShell(-0.02, 0.52, (y) => 0.034 + 0.015 * Math.sin(Math.max(0, Math.min(1, (y - 0.02) / 0.45)) * Math.PI), { ridge: 0.022 }), M.steel);
    bp.material = M.steel.clone(); bp.material.side = THREE.DoubleSide;
    g.add(bp); target = bp;
    const r1 = rim(0.52, 0.036, 0.01, M.steel); g.add(r1);
    const r0 = rim(-0.02, 0.034, 0.012, M.steelDark); g.add(r0);
    for (let i = 0; i < 2; i++) {
      const y0 = -0.02 - i * 0.07;
      const f = new THREE.Mesh(torsoShell(y0 - 0.08, y0 + 0.01, 0.05 + i * 0.008, { rows: 6 }), M.steel);
      f.material = M.steel.clone(); f.material.side = THREE.DoubleSide; g.add(f);
      g.add(rim(y0 - 0.08, 0.05 + i * 0.008, 0.006, M.leather));
    }
    for (const s of [1, -1]) {
      const sh = new THREE.Group(); sh.position.set(s * 0.215, 0.46, 0); g.add(sh);
      for (let i = 0; i < 4; i++) {
        const p = new THREE.Mesh(new THREE.SphereGeometry(0.1 + i * 0.005, 40, 10, 0, Math.PI * 2, i * 0.34, 0.5), i % 2 ? M.steelDark : M.steel);
        p.material = p.material.clone(); p.material.side = THREE.DoubleSide;
        p.position.set(s * 0.012, 0, 0); p.scale.set(1.08, 0.95, 1.05); p.rotation.z = -s * 0.42; sh.add(p);
      }
    }
    // rivets
    for (let i = 0; i < 10; i++) {
      const a = (i / 9 - 0.5) * 2.0;
      const r = sph(0.007, M.steelDark, [Math.sin(a) * torsoR(0.5) * TORSO_SX * 1.12, 0.5, Math.cos(a) * torsoR(0.5) * TORSO_SZ * 1.25]);
      g.add(r);
    }
  } else {
    const cm = new THREE.Mesh(torsoShell(-0.26, 0.54, (y) => 0.028 + Math.max(0, (0.0 - y)) * 0.12), M.chainmail);
    cm.material = M.chainmail.clone(); cm.material.side = THREE.DoubleSide;
    g.add(cm); target = cm;
    for (const s of [1, -1]) {
      const sl = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.24, 40, 1, true), cm.material);
      sl.position.set(s * 0.25, 0.36, 0); sl.rotation.z = s * 0.35; g.add(sl);
      g.add(sph(0.085, cm.material, [s * 0.215, 0.46, 0], [1, 0.9, 1]));
    }
  }
  shadowAll(g);
  return { group: g, target };
}
