import * as THREE from 'three';

// グラウンド（人工芝・内野の土・ライン・ベース）を描く。
// 寸法は公認野球規則の標準値。外周（フェンス）は PLATEAU のスタンドから求めたもの。

const BASE = 27.431; // 塁間
const MOUND = 18.44; // 本塁〜投手板
const ARC = 28.96; // 内野の土の円弧の半径（投手板から）
const TRACK = 4.5; // フェンス際の土の帯の幅（空中写真から目測）

export function outlinePoints(field) {
  const [mx, mz] = field.mound;
  return field.outline.map((r, k) => {
    const a = ((k / 2) * Math.PI) / 180;
    return [mx + Math.sin(a) * r, mz - Math.cos(a) * r];
  });
}

/** マウンドから見た方向 a の外周までの距離 */
export function outlineRadius(field, x, z) {
  const [mx, mz] = field.mound;
  let a = (Math.atan2(x - mx, -(z - mz)) * 180) / Math.PI;
  if (a < 0) a += 360;
  const k = a * 2;
  const k0 = Math.floor(k) % 720;
  const k1 = (k0 + 1) % 720;
  const f = k - Math.floor(k);
  const r = field.outline[k0] * (1 - f) + field.outline[k1] * f;
  return { r, d: Math.hypot(x - mx, z - mz) };
}

export function buildField(field, cfDir, maxTex) {
  const pts = outlinePoints(field);
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const x0 = Math.min(...xs) - 2;
  const z0 = Math.min(...zs) - 2;
  const S = Math.max(Math.max(...xs) - x0, Math.max(...zs) - z0) + 2;
  const N = maxTex;
  const k = N / S;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const ctx = cv.getContext('2d');
  const [cx, cz] = cfDir;

  // 世界座標 (x, z) で描く
  const world = () => ctx.setTransform(k, 0, 0, k, -k * x0, -k * z0);
  // グラウンド座標 (u = センター方向, v = 一塁側) で描く。原点はホームベース
  const fieldT = () => ctx.setTransform(k * cx, k * cz, -k * cz, k * cx, -k * x0, -k * z0);

  ctx.fillStyle = '#5a4a3a';
  ctx.fillRect(0, 0, N, N);

  // フェンス際の土
  world();
  ctx.beginPath();
  pts.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
  ctx.closePath();
  ctx.fillStyle = '#a5654a';
  ctx.fill();

  // 人工芝（外周から TRACK 内側）
  const [mx, mz] = field.mound;
  ctx.save();
  ctx.beginPath();
  field.outline.forEach((r, i) => {
    const a = ((i / 2) * Math.PI) / 180;
    const rr = Math.max(0, r - TRACK);
    const x = mx + Math.sin(a) * rr;
    const z = mz - Math.cos(a) * rr;
    i ? ctx.lineTo(x, z) : ctx.moveTo(x, z);
  });
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = '#3d8a3f';
  ctx.fillRect(x0, z0, S, S);
  // 芝の刈り目のような縞
  fieldT();
  for (let u = -60; u < 160; u += 10) {
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    ctx.fillRect(u, -150, 5, 300);
  }
  ctx.restore();

  fieldT();
  const half = BASE / Math.SQRT2;
  const first = [half, half];
  const second = [2 * half, 0];
  const third = [half, -half];

  // 内野の土（フェアゾーン内の投手板中心の円弧）
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-2, 0);
  ctx.lineTo(80, 82);
  ctx.lineTo(80, -82);
  ctx.closePath();
  ctx.clip();
  ctx.beginPath();
  ctx.arc(MOUND, 0, ARC, 0, Math.PI * 2);
  ctx.fillStyle = '#b5704f';
  ctx.fill();
  ctx.restore();
  // 一塁・三塁の切り欠き
  ctx.fillStyle = '#b5704f';
  for (const b of [first, third]) {
    ctx.beginPath();
    ctx.arc(b[0], b[1], 3.0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 内野の芝
  const d = 1.25;
  const h2 = half - d * Math.SQRT2;
  ctx.beginPath();
  ctx.moveTo(half - h2, 0);
  ctx.lineTo(half, h2);
  ctx.lineTo(half + h2, 0);
  ctx.lineTo(half, -h2);
  ctx.closePath();
  ctx.fillStyle = '#3f8c40';
  ctx.fill();

  // 本塁周りとマウンド
  ctx.fillStyle = '#b5704f';
  ctx.beginPath();
  ctx.arc(0, 0, 3.96, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(MOUND, 0, 2.74, 0, Math.PI * 2);
  ctx.fillStyle = '#ba7655';
  ctx.fill();

  // ライン（幅 7.6cm）
  ctx.strokeStyle = '#f4f4f0';
  ctx.lineWidth = 0.1;
  ctx.lineCap = 'butt';
  // ファウルライン（フェンスまで）
  for (const s of [1, -1]) {
    let L = 60;
    for (let t = 30; t < 140; t += 0.25) {
      const u = (t * Math.SQRT1_2) ;
      const v = s * t * Math.SQRT1_2;
      const x = u * cx - v * cz;
      const z = u * cz + v * cx;
      const o = outlineRadius(field, x, z);
      if (o.d > o.r) {
        L = t;
        break;
      }
    }
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(L * Math.SQRT1_2, s * L * Math.SQRT1_2);
    ctx.stroke();
  }
  // バッターボックス・キャッチャーボックス
  for (const s of [1, -1]) {
    ctx.strokeRect(-1.1, s > 0 ? 0.37 : -0.37 - 1.22, 1.83, 1.22);
  }
  ctx.beginPath();
  ctx.moveTo(-1.1, -1.09);
  ctx.lineTo(-3.5, -1.09);
  ctx.lineTo(-3.5, 1.09);
  ctx.lineTo(-1.1, 1.09);
  ctx.stroke();
  // ネクストバッターズサークル
  for (const s of [1, -1]) {
    ctx.beginPath();
    ctx.arc(-6, s * 11, 0.76, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ベース
  ctx.fillStyle = '#ffffff';
  for (const b of [first, second, third]) {
    ctx.save();
    ctx.translate(b[0], b[1]);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-0.19, -0.19, 0.38, 0.38);
    ctx.restore();
  }
  // ホームベース（五角形）
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0.216, 0.216);
  ctx.lineTo(0.432, 0.216);
  ctx.lineTo(0.432, -0.216);
  ctx.lineTo(0.216, -0.216);
  ctx.closePath();
  ctx.fill();
  // 投手板
  ctx.fillRect(MOUND - 0.08, -0.305, 0.15, 0.61);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  // マウンドを中心にした扇形の三角形で外周を埋める
  const y = field.y + 0.03;
  const pos = [];
  const uv = [];
  const push = (x, z) => {
    pos.push(x, y, z);
    uv.push((x - x0) / S, 1 - (z - z0) / S);
  };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    push(mx, mz);
    push(b[0], b[1]);
    push(a[0], a[1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ map: tex });
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;

  // マウンドの盛り上がり（高さ 25cm）
  const moundGeo = new THREE.CylinderGeometry(0.6, 2.74, 0.25, 40, 1);
  const moundMat = new THREE.MeshLambertMaterial({ color: 0xba7655 });
  const moundMesh = new THREE.Mesh(moundGeo, moundMat);
  moundMesh.position.set(cx * MOUND, field.y + 0.03 + 0.125, cz * MOUND);
  moundMesh.receiveShadow = true;

  const group = new THREE.Group();
  group.add(mesh, moundMesh);

  // ファウルポール
  const poleMat = new THREE.MeshLambertMaterial({ color: 0xf2d230 });
  for (const s of [1, -1]) {
    for (let t = 60; t < 140; t += 0.25) {
      const u = t * Math.SQRT1_2;
      const v = s * t * Math.SQRT1_2;
      const x = u * cx - v * cz;
      const z = u * cz + v * cx;
      const o = outlineRadius(field, x, z);
      if (o.d > o.r) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 22, 10), poleMat);
        pole.position.set(x, field.y + 11, z);
        group.add(pole);
        break;
      }
    }
  }
  return group;
}
