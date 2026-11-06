// Characters from a sculpted/scanned GLB (e.g. a Meshy export).
// The GLB holds several unrigged figures standing side by side. On load we
// split them, scale each to the engine's skeleton height and auto-rig them
// (skin weights from distance to each bone), so makeHuman() poses them with
// the same joints as the procedural people.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// left-to-right order of the figures inside the GLB
export const GLB_ORDER = ['vest', 'chainmail', 'plate', 'knight', 'archer'];
const TARGET_H = 1.83;      // feet to crown, matches the procedural skeleton
const FLOOR = -0.012;

export const GLB = { ready: false, chars: {}, sets: {}, materials: {}, material: null };

// Split the figures: weld vertices, find connected pieces, then group the
// pieces into `count` figures along `axis` (largest gaps between the big
// pieces' centres). Small loose bits join the nearest figure.
function splitByGaps(geo, count, axis = 'x') {
  const P = geo.attributes.position, I = geo.index ? geo.index.array : Array.from({ length: P.count }, (_, i) => i);
  const ax = axis === 'z' ? 2 : 0;
  const n = P.count, key = (i) => `${Math.round(P.getX(i) * 1e5)},${Math.round(P.getY(i) * 1e5)},${Math.round(P.getZ(i) * 1e5)}`;
  const par = new Int32Array(n).map((_, i) => i);
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
  const seen = new Map();
  for (let i = 0; i < n; i++) { const k = key(i); if (seen.has(k)) uni(i, seen.get(k)); else seen.set(k, i); }
  for (let t = 0; t < I.length; t += 3) { uni(I[t], I[t + 1]); uni(I[t], I[t + 2]); }
  const comps = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i); let c = comps.get(r);
    if (!c) { c = { n: 0, sum: 0, min: Infinity, max: -Infinity }; comps.set(r, c); }
    const v = P.getComponent(i, ax); c.n++; c.sum += v; if (v < c.min) c.min = v; if (v > c.max) c.max = v;
  }
  const list = [...comps.entries()].map(([r, c]) => ({ r, ...c, mid: c.sum / c.n }));
  const big = list.filter(c => c.n > 300).sort((a, b) => a.mid - b.mid);
  // cuts at the largest gaps between neighbouring big pieces
  const gaps = [];
  for (let i = 1; i < big.length; i++) gaps.push([big[i].mid - big[i - 1].mid, (big[i].mid + big[i - 1].mid) / 2]);
  gaps.sort((a, b) => b[0] - a[0]);
  const cuts = gaps.slice(0, count - 1).map(g => g[1]).sort((a, b) => a - b);
  const bucket = (x) => { let k = 0; while (k < cuts.length && x > cuts[k]) k++; return k; };
  const compFig = new Map(list.map(c => [c.r, bucket(c.mid)]));
  const parts = Array.from({ length: count }, () => ({ map: new Map(), pos: [], nor: [], uv: [], idx: [] }));
  const N = geo.attributes.normal, UV = geo.attributes.uv;
  for (let t = 0; t < I.length; t += 3) {
    const v = [I[t], I[t + 1], I[t + 2]];
    const part = parts[compFig.get(find(v[0]))];
    for (const i of v) {
      let ni = part.map.get(i);
      if (ni === undefined) {
        ni = part.pos.length / 3; part.map.set(i, ni);
        part.pos.push(P.getX(i), P.getY(i), P.getZ(i));
        if (N) part.nor.push(N.getX(i), N.getY(i), N.getZ(i));
        if (UV) part.uv.push(UV.getX(i), UV.getY(i));
      }
      part.idx.push(ni);
    }
  }
  return parts.map(p => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
    if (p.nor.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(p.nor, 3));
    if (p.uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2));
    g.setIndex(p.idx);
    if (!p.nor.length) g.computeVertexNormals();
    return g;
  });
}

function normalize(g, targetH = TARGET_H) {
  g.computeBoundingBox();
  const b = g.boundingBox, h = b.max.y - b.min.y, s = targetH / h;
  // centre on the torso (median x/z of the middle band), not the bbox: arms or props can be asymmetric
  const P = g.attributes.position, mx = [], mz = [];
  for (let i = 0; i < P.count; i++) { const f = (P.getY(i) - b.min.y) / h; if (f > 0.55 && f < 0.72) { mx.push(P.getX(i)); mz.push(P.getZ(i)); } }
  mx.sort((a, c) => a - c); mz.sort((a, c) => a - c);
  const cx = mx[mx.length >> 1] ?? (b.min.x + b.max.x) / 2, cz = mz[mz.length >> 1] ?? (b.min.z + b.max.z) / 2;
  g.translate(-cx, -b.min.y, -cz); g.scale(s, s, s); g.translate(0, FLOOR, 0);
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

// set 'stand': figures side by side along x, standing (auto-rigged, poseable)
// set 'walk' (or any other name): figures one behind another along z, already
// sculpted in a pose; used as they are, so nothing stretches.
export async function loadCharacters(url = './models/characters.glb', order = GLB_ORDER, { set = 'stand', axis = 'x', height = TARGET_H } = {}) {
  try {
    const gltf = await new GLTFLoader().loadAsync(url);
    let mesh = null; gltf.scene.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
    if (!mesh) throw new Error('no mesh in ' + url);
    gltf.scene.updateMatrixWorld(true);
    const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    const parts = splitByGaps(geo, order.length, axis);
    const chars = GLB.sets[set] = {};
    order.forEach((name, i) => { chars[name] = normalize(parts[i], height); });
    const src = mesh.material;
    const mat = new THREE.MeshPhysicalMaterial({
      map: src.map, roughness: 0.62, metalness: 0, sheen: 0.25, sheenRoughness: 0.6,
      sheenColor: new THREE.Color(0xffd0b8), side: THREE.DoubleSide,
    });
    // metal parts in the texture: brighter + greyer texels read as steel
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = roughness;
        vec3 _c = diffuseColor.rgb; float _sat = max(_c.r, max(_c.g, _c.b)) - min(_c.r, min(_c.g, _c.b));
        float _metal = smoothstep(0.25, 0.45, dot(_c, vec3(0.333))) * (1.0 - smoothstep(0.04, 0.12, _sat));
        roughnessFactor = mix(roughness, 0.32, _metal);`).replace('#include <metalnessmap_fragment>', `
        float metalnessFactor = mix(metalness, 0.85, _metal);`);
    };
    GLB.materials[set] = mat;
    if (set === 'stand') { GLB.chars = chars; GLB.material = mat; GLB.ready = true; }
    return true;
  } catch (e) {
    console.warn('[glbchar] could not load', url, e.message);
    return false;
  }
}

// ---------- auto-rig ----------
// bones: list of { obj, a: Vector3, b: Vector3, r, side } in root space (bind pose)
const _ab = new THREE.Vector3(), _ap = new THREE.Vector3(), _q = new THREE.Vector3();
// Chain rig: first decide which body part (torso, an arm, a leg) a vertex
// belongs to, then weight it along that chain by how far down the chain it
// projects, with narrow bands at each joint (like a hand-painted rig).
// chains: [{ pts: [Vector3...], bones: [index per segment], r, side, bands: [width per inner joint], rootBone, rootBand }]
const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function rigChains(geo, chains, nBones, { smooth = 2 } = {}) {
  const P = geo.attributes.position, N = geo.attributes.normal, n = P.count, B = nBones;
  const key = (i) => `${Math.round(P.getX(i) * 1e4)},${Math.round(P.getY(i) * 1e4)},${Math.round(P.getZ(i) * 1e4)}`;
  const gid = new Int32Array(n), reps = [], gmap = new Map();
  for (let i = 0; i < n; i++) { const k = key(i); let g = gmap.get(k); if (g === undefined) { g = reps.length; gmap.set(k, g); reps.push(i); } gid[i] = g; }
  const G = reps.length, gn = new Float32Array(G * 3);
  for (let i = 0; i < n; i++) { const g = gid[i]; gn[g * 3] += N.getX(i); gn[g * 3 + 1] += N.getY(i); gn[g * 3 + 2] += N.getZ(i); }
  const W = new Float32Array(G * B), p = new THREE.Vector3(), nr = new THREE.Vector3();
  const gChain = new Int8Array(G), gS = new Float32Array(G);
  for (let g = 0; g < G; g++) {
    p.fromBufferAttribute(P, reps[g]); nr.set(gn[g * 3], gn[g * 3 + 1], gn[g * 3 + 2]).normalize();
    let bestC = 0, bestD = Infinity, bestS = 0;
    chains.forEach((c, ci) => {
      let acc = 0, dMin = Infinity, sAt = 0;
      for (let k = 0; k < c.pts.length - 1; k++) {
        const a = c.pts[k], b = c.pts[k + 1], len = a.distanceTo(b);
        _ab.subVectors(b, a); _ap.subVectors(p, a);
        const t = Math.max(0, Math.min(1, _ap.dot(_ab) / _ab.lengthSq()));
        _q.copy(_ap).addScaledVector(_ab, -t); const d = _q.length(); if (d > 1e-6) _q.multiplyScalar(1 / d);
        let dn = d / (Array.isArray(c.r) ? c.r[k] : c.r);
        const facing = nr.dot(_q); if (facing < 0 && c.side) dn += 1.5 * -facing;
        if (dn < dMin) { dMin = dn; sAt = acc + t * len; }
        acc += len;
      }
      if (c.side && p.x * c.side < -0.015) dMin += 10;
      if (c.minY !== undefined && p.y < c.minY) dMin += (c.minY - p.y) * 40;
      if (c.maxY !== undefined && p.y > c.maxY) dMin += (p.y - c.maxY) * 40;
      if (dMin < bestD) { bestD = dMin; bestC = ci; bestS = sAt; }
    });
    gChain[g] = bestC; gS[g] = bestS;
    const c = chains[bestC];
    // weights along the chain
    let acc = 0; const w = new Float32Array(c.bones.length);
    w[0] = 1;
    for (let k = 1; k < c.bones.length; k++) {
      acc += c.pts[k - 1].distanceTo(c.pts[k]);
      const bw = c.bands[k - 1], f = sst(acc - bw, acc + bw, bestS);
      for (let m = 0; m < k; m++) w[m] *= 1 - f; w[k] = f;
    }
    for (let k = 0; k < c.bones.length; k++) W[g * B + c.bones[k]] += w[k];
    if (c.rootBone !== undefined) { // blend the top of a limb into the body
      const f = 1 - sst(-c.rootBand, c.rootBand, bestS);
      for (let b = 0; b < B; b++) W[g * B + b] *= 1 - f;
      W[g * B + c.rootBone] += f;
    }
  }
  // drop triangles that fuse two body parts (a hand melted into a thigh, a
  // forearm into the ribs); they would stretch into sheets when posed.
  const I0 = geo.index.array, keep = [];
  const joinOK = (ca, sa, cb, sb) => {
    if (ca === cb) return true;
    if (ca === 0) return sb < (chains[cb].joinLen ?? 9);   // a limb stays attached to the body near its root
    if (cb === 0) return sa < (chains[ca].joinLen ?? 9);
    return false;                                // arm fused to leg (hand on thigh): cut
  };
  let dropped = 0;
  for (let t = 0; t < I0.length; t += 3) {
    const g = [gid[I0[t]], gid[I0[t + 1]], gid[I0[t + 2]]];
    let ok = true;
    for (let k = 0; k < 3 && ok; k++) { const a = g[k], b = g[(k + 1) % 3]; ok = joinOK(gChain[a], gS[a], gChain[b], gS[b]); }
    if (ok) keep.push(I0[t], I0[t + 1], I0[t + 2]); else dropped++;
  }
  geo.setIndex(keep);
  geo.userData.dropped = dropped;
  const I = geo.index.array, nb = Array.from({ length: G }, () => new Set());
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const a0 = gid[I[t + k]], a1 = gid[I[t + (k + 1) % 3]]; if (a0 !== a1) { nb[a0].add(a1); nb[a1].add(a0); } }
  let A = W, T = new Float32Array(G * B);
  for (let it = 0; it < smooth; it++) {
    for (let g = 0; g < G; g++) {
      const ns = nb[g], k = ns.size ? 0.4 / ns.size : 0, self = ns.size ? 0.6 : 1;
      for (let b = 0; b < B; b++) T[g * B + b] = A[g * B + b] * self;
      for (const h of ns) for (let b = 0; b < B; b++) T[g * B + b] += A[h * B + b] * k;
    }
    [A, T] = [T, A];
  }
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), ord = Array.from({ length: B }, (_, i) => i);
  for (let i = 0; i < n; i++) {
    const g = gid[i]; ord.sort((x, y) => A[g * B + y] - A[g * B + x]);
    let tot = 0; for (let k = 0; k < 4; k++) tot += A[g * B + ord[k]];
    for (let k = 0; k < 4; k++) { si[i * 4 + k] = ord[k]; sw[i * 4 + k] = A[g * B + ord[k]] / tot; }
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  return geo;
}

// invisible copy of the torso so hit tests and the red ripple can sit on it
export function torsoProxy(geo, chest, root, yMin, yMax, halfW) {
  const P = geo.attributes.position, I = geo.index.array, keep = [];
  const inv = new THREE.Matrix4().copy(chest.matrixWorld).invert().multiply(root.matrixWorld);
  const v = new THREE.Vector3(), map = new Map(), pos = [];
  for (let t = 0; t < I.length; t += 3) {
    let ok = true;
    for (let k = 0; k < 3; k++) { const y = P.getY(I[t + k]), x = P.getX(I[t + k]); if (y < yMin || y > yMax || Math.abs(x) > halfW) ok = false; }
    if (!ok) continue;
    for (let k = 0; k < 3; k++) {
      const i = I[t + k];
      if (!map.has(i)) { map.set(i, pos.length / 3); v.fromBufferAttribute(P, i).applyMatrix4(inv); pos.push(v.x, v.y, v.z); }
      keep.push(map.get(i));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(keep); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  m.castShadow = false; m.receiveShadow = false;
  return m;
}
