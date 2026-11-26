import * as THREE from 'three';
import { RELEASE } from './human.js';

// 投球（右投げ）。球種ごとの球速と変化量は、プロ野球の一般的な値の目安。
// 変化量（cm）は回転による変化で、重力による落下とは別。
//   縦: 正 = ホップする向き（落ちにくい）、横: 正 = 投手の利き腕側（右投げなら三塁側）
export const PITCHES = [
  { id: 'fastball', label: 'ストレート', speed: 148, vert: 42, horz: 18 },
  { id: 'curve', label: 'カーブ', speed: 115, vert: -32, horz: -22 },
  { id: 'slider', label: 'スライダー', speed: 131, vert: 5, horz: -28 },
  { id: 'fork', label: 'フォーク', speed: 136, vert: -8, horz: 12 },
  { id: 'change', label: 'チェンジアップ', speed: 128, vert: 12, horz: 30 },
];

const G = 9.8;
const K_DRAG = 0.0064; // 打球と同じ空気抵抗 [1/m]
const BALL_R = 0.037;
const WINDUP = 1.6; // 投球動作の長さ [s]
const PLATE_U = 0.22; // ホームベースの中心（センター方向の座標）
const MITT_U = -0.85; // 捕手のミット
// ストライクゾーン（打者の膝〜胸の目安）
export const ZONE = { half: 0.216, low: 0.48, high: 1.06 };

export function createPitching({ scene, field, cfDir, pitcher }) {
  const [cx, cz] = cfDir;
  const fy = field.y;
  // グラウンド座標 (u: センター方向, v: 一塁側, h: 地面からの高さ) → 世界座標
  const W = (u, v, h) => new THREE.Vector3(u * cx - v * cz, fy + h, u * cz + v * cx);
  const toUVH = (p) => {
    const x = p.x;
    const z = p.z;
    return { u: x * cx + z * cz, v: -x * cz + z * cx, h: p.y - fy };
  };

  // ストライクゾーンの枠
  const zoneGeo = new THREE.BufferGeometry().setFromPoints([
    W(PLATE_U, -ZONE.half, ZONE.low),
    W(PLATE_U, ZONE.half, ZONE.low),
    W(PLATE_U, ZONE.half, ZONE.high),
    W(PLATE_U, -ZONE.half, ZONE.high),
    W(PLATE_U, -ZONE.half, ZONE.low),
  ]);
  const zone = new THREE.Line(zoneGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
  zone.visible = false;
  scene.add(zone);

  const ballMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), ballMat);
  ball.scale.setScalar(0.06); // 実物(半径 3.7cm)より少し大きく
  ball.visible = false;
  const trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x8fd3ff }));
  trail.visible = false;
  scene.add(ball, trail);

  let cur = null;

  /** 球が手を離れる位置（投球動作の RELEASE の瞬間の右手） */
  function releasePoint() {
    const obj = pitcher.obj;
    obj.userData.setPose('pitch', RELEASE);
    obj.updateMatrixWorld(true);
    const p = obj.userData.rightHand.localToWorld(new THREE.Vector3(0, -0.06, 0));
    obj.userData.setPose('pitcher');
    return p;
  }

  /** 初速の向き (yaw, pitch) で投げたときの軌道 */
  function fly(start, speedKmh, yaw, el, acc) {
    const v0 = speedKmh / 3.6;
    // ホーム方向（-u）を基準にした向き
    const dirU = -Math.cos(el) * Math.cos(yaw);
    const dirV = Math.cos(el) * Math.sin(yaw);
    const dirH = Math.sin(el);
    let p = toUVH(start);
    let v = { u: v0 * dirU, v: v0 * dirV, h: v0 * dirH };
    const dt = 1 / 600;
    const pts = [{ ...p, t: 0 }];
    let t = 0;
    let atPlate = null;
    while (p.u > MITT_U && t < 3) {
      const s = Math.hypot(v.u, v.v, v.h);
      v = {
        u: v.u - K_DRAG * s * v.u * dt,
        v: v.v + (-K_DRAG * s * v.v + acc.v) * dt,
        h: v.h + (-G - K_DRAG * s * v.h + acc.h) * dt,
      };
      const np = { u: p.u + v.u * dt, v: p.v + v.v * dt, h: p.h + v.h * dt };
      t += dt;
      if (!atPlate && np.u <= PLATE_U) {
        const f = (p.u - PLATE_U) / (p.u - np.u);
        atPlate = { v: p.v + (np.v - p.v) * f, h: p.h + (np.h - p.h) * f, t: t - dt + dt * f, speed: s * 3.6 };
      }
      p = np;
      if (p.h < BALL_R) break; // ワンバウンド
      pts.push({ ...p, t });
    }
    return { pts, atPlate };
  }

  /**
   * 投げる。target は ホームベース上を通す位置 { v, h }（省略時はゾーンの内外をランダムに）
   */
  function throwPitch(type, now, target) {
    const pt = PITCHES.find((x) => x.id === type) || PITCHES[0];
    const start = releasePoint();
    const p0 = toUVH(start);
    if (!target) {
      const strike = Math.random() < 0.65;
      const m = strike ? 0.85 : 1.6;
      target = {
        v: (Math.random() * 2 - 1) * ZONE.half * m,
        h: (ZONE.low + ZONE.high) / 2 + (Math.random() * 2 - 1) * ((ZONE.high - ZONE.low) / 2) * m,
      };
    }
    // 変化（回転による加速度）: 変化量 = 1/2 a t^2 から、到達時間の見込みで決める
    const tEst = (p0.u - PLATE_U) / ((pt.speed / 3.6) * 0.95);
    // 横の正 = 利き腕側（右投げは三塁側 = v の負の向き）
    const acc = { v: (-2 * (pt.horz / 100)) / (tEst * tEst), h: (2 * (pt.vert / 100)) / (tEst * tEst) };
    // ねらった位置を通るよう、向きを少しずつ直す
    const dist = p0.u - PLATE_U;
    let yaw = Math.atan2(target.v - p0.v, dist);
    // 重力と縦の変化で落ちる分を見込んで、少し上に向けて投げる
    const drop = 0.5 * (G - acc.h) * tEst * tEst;
    let el = Math.atan2(target.h - p0.h + drop, dist);
    let res;
    for (let i = 0; i < 6; i++) {
      res = fly(start, pt.speed, yaw, el, acc);
      if (!res.atPlate) {
        el += 0.02; // ホームの手前で落ちたら上に直す
        continue;
      }
      yaw += Math.atan2(target.v - res.atPlate.v, dist);
      el += Math.atan2(target.h - res.atPlate.h, dist);
    }
    res = fly(start, pt.speed, yaw, el, acc);
    const ap = res.atPlate;
    const strike = !!ap && Math.abs(ap.v) <= ZONE.half + BALL_R && ap.h >= ZONE.low - BALL_R && ap.h <= ZONE.high + BALL_R;
    const world = res.pts.map((q) => W(q.u, q.v, q.h));
    // 点の数が投球ごとに違うので、軌跡の形状は作り直す
    trail.geometry.dispose();
    trail.geometry = new THREE.BufferGeometry().setFromPoints(world);
    trail.geometry.setDrawRange(0, 0);
    trail.visible = true;
    ball.visible = false;
    cur = {
      pt,
      res,
      world,
      t0: now,
      release: now + WINDUP * RELEASE,
      strike,
      done: false,
      stopT: null, // 打たれたときはホームベースの上で球を止める（res.atPlate.t）
      plateWorld: ap ? W(PLATE_U, ap.v, ap.h) : null,
    };
    return cur;
  }

  /** 毎フレーム。投球動作と球を進める。投げ終わったら結果を返す */
  function update(now) {
    if (!cur) return null;
    const phase = (now - cur.t0) / WINDUP;
    if (phase <= 1) pitcher.obj.userData.setPose('pitch', phase);
    else if (phase > 1.6) pitcher.obj.userData.setPose('pitcher');
    const t = now - cur.release;
    if (t < 0) return null;
    const pts = cur.res.pts;
    let i = 0;
    while (i < pts.length - 1 && pts[i + 1].t < t) i++;
    const hit = cur.stopT != null && t >= cur.stopT;
    ball.visible = !hit;
    ball.position.copy(cur.world[i]);
    cur.u = pts[i].u;
    if (!hit || !cur.done) trail.geometry.setDrawRange(0, i + 1);
    if ((hit || i >= pts.length - 1) && !cur.done) {
      cur.done = true;
      return cur;
    }
    if (cur.done && phase > 1.6) {
      cur = null;
      pitcher.obj.userData.setPose('pitcher');
    }
    return null;
  }

  function clear() {
    trail.visible = false;
    ball.visible = false;
  }

  const active = () => !!cur && !cur.done;
  // 目で追うのはホームベースに来るまで（そのあと捕手のミットまで追うと足元を見てしまう）
  const following = () => active() && ball.visible && cur.u > PLATE_U + 0.3;

  return { throwPitch, update, clear, zone, ball, active, following };
}
