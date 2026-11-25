// 打球の軌道（空気抵抗とバックスピンの揚力を入れた簡単なモデル）
// 座標: x 東, y 上, z 南。dir はセンター方向の単位ベクトル (x, z)。

const G = 9.8;
const K_DRAG = 0.0064; // 0.5 * ρ * Cd * A / m [1/m]
const K_LIFT = 0.0024; // 揚力（バックスピン）[1/m]

export const PRESETS = [
  { id: 'hr-left', label: 'レフトへHR', speed: 165, angle: 28, spray: -24 },
  { id: 'hr-center', label: 'センターへHR', speed: 172, angle: 27, spray: 0 },
  { id: 'hr-right', label: 'ライトへHR', speed: 165, angle: 28, spray: 24 },
  { id: 'fly', label: '外野フライ', speed: 128, angle: 34, spray: null },
  { id: 'liner', label: 'ライナー', speed: 150, angle: 14, spray: null },
  { id: 'pop', label: '内野フライ', speed: 115, angle: 62, spray: null },
];

/**
 * 軌道を計算する。
 * @param {object} o speed [km/h], angle [deg], spray [deg]（右=一塁側が正）
 * @param {object} env start {x,y,z}, cfDir [x,z], groundAt(x,z,prevY,y) → {y, kind} or null
 *   kind: 'field'（グラウンド）| 'stand'（スタンド）| 'fence'（フェンス）| 'outside'（場外）
 * @returns {{points: number[][], t: number[], firstLand: number[], apex: number, kind: string}}
 */
export function simulate(o, env) {
  const v0 = (o.speed * 1000) / 3600;
  const el = (o.angle * Math.PI) / 180;
  const sp = (o.spray * Math.PI) / 180;
  const [cx, cz] = env.cfDir;
  // 右手方向 = (-cz, cx)
  const hx = Math.cos(sp) * cx + Math.sin(sp) * -cz;
  const hz = Math.cos(sp) * cz + Math.sin(sp) * cx;
  let p = [env.start.x, env.start.y, env.start.z];
  let v = [v0 * Math.cos(el) * hx, v0 * Math.sin(el), v0 * Math.cos(el) * hz];
  const dt = 1 / 240;
  const points = [p.slice()];
  const ts = [0];
  let t = 0;
  let apex = p[1];
  let bounces = 0;
  let kind = null;
  let firstLand = null;
  while (t < 15) {
    const s = Math.hypot(v[0], v[1], v[2]);
    // 揚力: 速度に垂直で、水平進行方向に対して上向き（バックスピン）
    const vh = Math.hypot(v[0], v[2]) || 1;
    const lift = [(-v[1] * v[0]) / vh, vh, (-v[1] * v[2]) / vh];
    const a = [
      -K_DRAG * s * v[0] + K_LIFT * s * lift[0],
      -G - K_DRAG * s * v[1] + K_LIFT * s * lift[1],
      -K_DRAG * s * v[2] + K_LIFT * s * lift[2],
    ];
    const np = [p[0] + v[0] * dt, p[1] + v[1] * dt, p[2] + v[2] * dt];
    v = [v[0] + a[0] * dt, v[1] + a[1] * dt, v[2] + a[2] * dt];
    t += dt;
    const hit = env.groundAt(np[0], np[2], p[1], np[1]);
    if (hit) {
      np[1] = hit.y;
      if (!firstLand) {
        firstLand = np.slice();
        kind = hit.kind;
      }
      // スタンド・場外・フェンスに当たったら終わり。グラウンドでは数回弾む
      if (hit.kind !== 'field' || bounces >= 3 || Math.abs(v[1]) < 2) {
        points.push(np);
        ts.push(t);
        p = np;
        break;
      }
      bounces++;
      v = [v[0] * 0.6, -v[1] * 0.42, v[2] * 0.6];
    }
    p = np;
    apex = Math.max(apex, p[1]);
    points.push(p.slice());
    ts.push(t);
  }
  return { points, t: ts, firstLand: firstLand || p, apex, kind: kind || 'field' };
}
