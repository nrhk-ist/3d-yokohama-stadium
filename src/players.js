import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { outlineRadius } from './field.js';

// 選手の人形（名前のない汎用の人形）。
// 実在の球団のユニフォームに見えないよう、背番号・文字・ロゴ・模様は入れない。

const COLORS = {
  uniform: 0xf2f2ee, // 守備側: 白
  accent: 0x232d50, // 帽子・ベルト: 紺
  batter: 0x96989c, // 打者: グレー
  helmet: 0x1b1b1e,
  umpire: 0x1e2a44,
  umpirePants: 0x55585e,
  skin: 0xdeb896,
  glove: 0x8f5a30,
  shoes: 0x1a1a1a,
  bat: 0xc9a26b,
};

// 守備位置（ホームからの距離 m と、センター方向からの角度 °。一塁側が正）
const FIELDERS = [
  { id: 'P', name: '投手', d: 18.44, a: 0, infield: true },
  { id: 'C', name: '捕手', d: -1.4, a: 0, infield: true, crouch: true },
  { id: '1B', name: '一塁手', d: 31, a: 38, infield: true },
  { id: '2B', name: '二塁手', d: 40, a: 16, infield: true },
  { id: 'SS', name: '遊撃手', d: 40, a: -16, infield: true },
  { id: '3B', name: '三塁手', d: 31, a: -38, infield: true },
  { id: 'LF', name: '左翼手', d: 82, a: -28 },
  { id: 'CF', name: '中堅手', d: 95, a: 0 },
  { id: 'RF', name: '右翼手', d: 82, a: 28 },
];

const REACTION_IN = 0.3; // 打球への反応時間（内野手）[s]
const REACTION_OUT = 0.6; // 打球への反応時間（外野手。落下点の判断を含む）[s]
const RUN = 7.0; // 走る速さ [m/s]
const REACH_H = 2.3; // 捕球できる高さ [m]

function part(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}

const box = (w, h, d, x, y, z, color) => part(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);

/** 人形を作る。前が +z。脚は走る動きのために別にする */
function figure(kind) {
  const body = kind === 'batter' ? COLORS.batter : kind === 'umpire' ? COLORS.umpire : COLORS.uniform;
  const pants = kind === 'umpire' ? COLORS.umpirePants : body;
  const capColor = kind === 'batter' ? COLORS.helmet : kind === 'umpire' ? COLORS.umpire : COLORS.accent;
  const parts = [
    box(0.42, 0.56, 0.24, 0, 1.2, 0, body), // 胴
    box(0.4, 0.07, 0.25, 0, 0.92, 0, kind === 'umpire' ? COLORS.umpire : COLORS.accent), // ベルト
    box(0.11, 0.55, 0.12, -0.27, 1.17, 0, body), // 腕
    box(0.11, 0.55, 0.12, 0.27, 1.17, 0, body),
    part(new THREE.IcosahedronGeometry(0.12, 1).translate(0, 1.63, 0), COLORS.skin), // 頭
    part(new THREE.CylinderGeometry(0.125, 0.13, 0.08, 10).translate(0, 1.72, 0), capColor), // 帽子
  ];
  if (kind === 'batter') {
    parts.push(part(new THREE.CylinderGeometry(0.035, 0.02, 0.84, 6).rotateZ(-0.9).translate(-0.32, 1.42, -0.05), COLORS.bat));
  } else if (kind !== 'umpire') {
    parts.push(box(0.14, 0.06, 0.06, 0, 1.72, 0.14, capColor)); // つば
    parts.push(box(0.16, 0.18, 0.08, -0.29, 0.86, 0.04, COLORS.glove)); // グラブ（左手）
  }
  const upper = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshLambertMaterial({ vertexColors: true }));
  upper.castShadow = true;
  const g = new THREE.Group();
  g.add(upper);
  const legs = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(s * 0.11, 0.9, 0);
    const m = new THREE.Mesh(
      mergeGeometries([box(0.15, 0.82, 0.16, 0, -0.43, 0, pants), box(0.15, 0.08, 0.26, 0, -0.86, 0.04, COLORS.shoes)]),
      upper.material,
    );
    m.castShadow = true;
    leg.add(m);
    g.add(leg);
    legs.push(leg);
  }
  g.userData.legs = legs;
  return g;
}

const reaction = (f) => (f.infield ? REACTION_IN : REACTION_OUT);

export function createPlayers(field, cfDir) {
  const [cx, cz] = cfDir;
  const toWorld = (u, v) => new THREE.Vector3(u * cx - v * cz, field.y + 0.03, u * cz + v * cx);
  const home = toWorld(0, 0);
  const group = new THREE.Group();

  const faceTo = (obj, target) => {
    obj.rotation.y = Math.atan2(target.x - obj.position.x, target.z - obj.position.z);
  };

  const fielders = FIELDERS.map((f) => {
    const a = (f.a * Math.PI) / 180;
    const p = toWorld(f.d * Math.cos(a), f.d * Math.sin(a));
    if (f.id === 'P') p.y += 0.25; // マウンドの上
    const obj = figure('fielder');
    obj.position.copy(p);
    if (f.crouch) obj.scale.set(1, 0.62, 1);
    faceTo(obj, f.id === 'C' ? toWorld(18.44, 0) : home);
    group.add(obj);
    return { ...f, obj, base: p.clone(), baseYaw: obj.rotation.y, from: null, to: null, start: 0 };
  });

  // 右打者（三塁側のバッターボックス）。投手の方を向いて立つ
  const batter = figure('batter');
  batter.position.copy(toWorld(0.2, -0.95));
  faceTo(batter, toWorld(0.2, 2));
  group.add(batter);
  // 球審（捕手の後ろ）
  const ump = figure('umpire');
  ump.position.copy(toWorld(-2.6, 0));
  faceTo(ump, toWorld(18.44, 0));
  group.add(ump);

  let play = null;

  const inField = (x, z, margin = 0.5) => {
    const o = outlineRadius(field, x, z);
    return o.d <= o.r - margin;
  };

  /**
   * 打球に対する守備を決める。捕球できたら打球をその時点で止める（res を書き換える）。
   * 返り値: { fielder, caught, fly } または null
   */
  function react(res) {
    const pts = res.points;
    const ts = res.t;
    const reachTime = (f, p) => reaction(f) + Math.hypot(p[0] - f.base.x, p[2] - f.base.z) / RUN;
    const firstLandIdx = res.firstLandIndex;
    let best = null;
    // 打球の各点で、間に合う野手がいるか（もっとも早い点で捕る）
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const t = ts[i];
      if (t < 0.25) continue;
      if (p[1] > field.y + REACH_H) continue;
      if (!inField(p[0], p[2])) continue;
      if (Math.hypot(p[0] - home.x, p[2] - home.z) < 4) continue;
      for (const f of fielders) {
        if (f.id === 'C' && Math.hypot(p[0] - home.x, p[2] - home.z) > 12) continue;
        const rt = reachTime(f, p);
        // 間に合う野手のうち、いちばん早く着く野手が捕る
        if (rt <= t && (!best || rt < best.rt)) best = { f, i, t, p, rt };
      }
      if (best) break;
    }
    let target;
    let fielder;
    let caught = false;
    let fly = false;
    if (best) {
      fielder = best.f;
      target = best.p;
      caught = true;
      fly = firstLandIdx < 0 || best.i < firstLandIdx;
      // 捕球した所で打球を止める
      res.points = pts.slice(0, best.i + 1);
      res.t = ts.slice(0, best.i + 1);
      if (fly) res.firstLand = best.p;
    } else {
      // 間に合わない: 落下点にいちばん近い野手が向かう（フェンスの手前まで）
      let l = res.firstLand;
      if (!inField(l[0], l[2], 1.5)) {
        const o = outlineRadius(field, l[0], l[2]);
        const [mx, mz] = field.mound;
        const k = (o.r - 1.5) / o.d;
        l = [mx + (l[0] - mx) * k, l[1], mz + (l[2] - mz) * k];
      }
      target = l;
      fielder = fielders
        .filter((f) => f.id !== 'C')
        .reduce((a, b) => (Math.hypot(l[0] - a.base.x, l[2] - a.base.z) < Math.hypot(l[0] - b.base.x, l[2] - b.base.z) ? a : b));
    }
    return { fielder, target: new THREE.Vector3(target[0], fielder.base.y, target[2]), caught, fly };
  }

  function start(r, now) {
    reset();
    play = { ...r, t0: now, done: null };
    faceTo(r.fielder.obj, r.target);
  }

  function reset() {
    for (const f of fielders) {
      f.obj.position.copy(f.base);
      f.obj.rotation.y = f.baseYaw;
      f.obj.userData.legs.forEach((l) => (l.rotation.x = 0));
    }
    play = null;
  }

  function update(now, ballDone) {
    if (!play) return;
    const f = play.fielder;
    const t = now - play.t0 - reaction(f);
    const dist = f.base.distanceTo(play.target);
    const run = Math.max(0, Math.min(dist, t * RUN));
    const running = t > 0 && run < dist;
    if (dist > 0.01) f.obj.position.lerpVectors(f.base, play.target, run / dist);
    const legs = f.obj.userData.legs;
    const swing = running ? Math.sin(now * 14) * 0.7 : 0;
    legs[0].rotation.x = swing;
    legs[1].rotation.x = -swing;
    if (!running && t > 0) faceTo(f.obj, home);
    // プレーが終わって少ししたら守備位置に戻す
    if (ballDone && !play.done) play.done = now;
    if (play.done && now - play.done > 4) reset();
  }

  return { group, react, start, update, reset };
}
