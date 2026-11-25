import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { buildField, outlineRadius } from './field.js';
import { PRESETS, simulate } from './ball.js';
import { createPlayers } from './players.js';

const DATA = './data/';
const isMobile = matchMedia('(max-width: 700px)').matches || /Mobi|Android/i.test(navigator.userAgent);

// ------------------------------------------------------------------ 読み込み

const loadingBar = document.getElementById('loading-bar');
let loaded = 0;
const TOTAL = 9;
const tick = () => {
  loaded++;
  loadingBar.style.width = `${Math.min(100, (loaded / TOTAL) * 100)}%`;
};
const fetchJson = (f) => fetch(DATA + f).then((r) => r.json()).finally(tick);
const fetchBin = (f) => fetch(DATA + f).then((r) => r.arrayBuffer()).finally(tick);
const texLoader = new THREE.TextureLoader();
const loadTex = (f) =>
  new Promise((res, rej) =>
    texLoader.load(
      DATA + f,
      (t) => {
        tick();
        t.colorSpace = THREE.SRGBColorSpace;
        res(t);
      },
      undefined,
      rej,
    ),
  );

function part(buf, p) {
  const T = { int32: Int32Array, int16: Int16Array, uint16: Uint16Array, uint8: Uint8Array }[p.dtype];
  return new T(buf, p.offset, p.length);
}

const toFloat = (a, s = 100) => {
  const f = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) f[i] = a[i] / s;
  return f;
};

// ------------------------------------------------------------------ 描画の準備

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
labelRenderer.domElement.id = 'labels';
document.body.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe0ef, 1500, 6000);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 12000);

// 空
{
  const geo = new THREE.SphereGeometry(9000, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {},
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);}`,
    fragmentShader: `varying vec3 vP; void main(){
      float h = clamp(vP.y, 0.0, 1.0);
      vec3 top = vec3(0.28, 0.52, 0.86);
      vec3 hor = vec3(0.82, 0.89, 0.95);
      gl_FragColor = vec4(mix(hor, top, pow(h, 0.55)), 1.0);
    }`,
  });
  scene.add(new THREE.Mesh(geo, mat));
}

scene.add(new THREE.HemisphereLight(0xe8f2ff, 0x8a7a60, 1.5));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
sun.position.set(-160, 260, 140); // 南西の高い位置（午後）
sun.castShadow = true;
sun.shadow.mapSize.set(isMobile ? 2048 : 4096, isMobile ? 2048 : 4096);
Object.assign(sun.shadow.camera, { left: -170, right: 170, top: 170, bottom: -170, near: 10, far: 800 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.3;
scene.add(sun);
scene.add(sun.target);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 20;
controls.maxDistance = 3000;

// ------------------------------------------------------------------ 状態

const S = {
  scene: null,
  ground: null,
  field: null,
  stadiumMesh: null,
  seats: null, // { pos: Float32Array, yaw, block, mesh, grid }
  mode: 'overview',
  seatIndex: -1,
  yaw: 0,
  pitch: 0,
  fov: 55,
  labels: [],
  blockLabels: [],
  balls: [],
  follow: true,
  tween: null,
};

// ------------------------------------------------------------------ 地面

function buildGround(g, texture, lowerInside, offset) {
  const { n, half, step, heights } = g.grid;
  const pos = new Float32Array(n * n * 3);
  const uv = new Float32Array(n * n * 2);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const x = -half + i * step;
      const z = -half + j * step;
      let y = heights[k] + offset;
      if (lowerInside) {
        const o = outlineRadius(S.scene.field, x, z);
        if (o.d < o.r + 25) y = S.scene.field.y - 0.4;
      }
      pos.set([x, y, z], k * 3);
      uv.set([(x - g.west) / (g.east - g.west), 1 - (z - g.north) / (g.south - g.north)], k * 2);
    }
  }
  const idx = [];
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  texture.anisotropy = 8;
  const mat = new THREE.MeshLambertMaterial({ map: texture });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

// ------------------------------------------------------------------ 建物・スタジアム

function buildStadium(sc, buf, tex) {
  const P = sc.stadium.parts;
  const pos = toFloat(part(buf, P[0]));
  const uvi = part(buf, P[1]);
  const uv = new Float32Array(uvi.length);
  for (let i = 0; i < uvi.length; i++) uv[i] = uvi[i] / 65535;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  tex.anisotropy = 8;
  const mat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const plain = toFloat(part(buf, P[3]));
  const g2 = new THREE.BufferGeometry();
  g2.setAttribute('position', new THREE.BufferAttribute(plain, 3));
  g2.computeVertexNormals();
  const mesh2 = new THREE.Mesh(g2, new THREE.MeshLambertMaterial({ color: 0x9aa3ad, side: THREE.DoubleSide }));
  mesh2.castShadow = true;
  mesh2.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh, mesh2);
  S.stadiumMesh = group;
  return group;
}

function buildCity(sc, buf) {
  const P = sc.city.parts;
  const pos = toFloat(part(buf, P[0]), sc.city.scale || 100);
  const col = part(buf, P[1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

function buildTrees(sc, buf) {
  const t = part(buf, sc.trees.parts[0]);
  const n = t.length / 5;
  const crownGeo = new THREE.IcosahedronGeometry(1, 1);
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 1, 6);
  trunkGeo.translate(0, 0.5, 0);
  const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: 0x4f7d3a, flatShading: true }), n);
  const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x6b5138 }), n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < n; i++) {
    const x = t[i * 5] / 100;
    const y = t[i * 5 + 1] / 100;
    const z = t[i * 5 + 2] / 100;
    const h = Math.max(2, t[i * 5 + 3] / 100);
    const r = Math.min(Math.max(t[i * 5 + 4] / 100, h * 0.25), h * 0.45);
    m.compose(new THREE.Vector3(x, y + h - r, z), q, new THREE.Vector3(r, r * 0.9, r));
    crown.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, h - r, 1));
    trunk.setMatrixAt(i, m);
  }
  crown.castShadow = true;
  const g = new THREE.Group();
  g.add(crown, trunk);
  return g;
}

// ------------------------------------------------------------------ 座席

function seatGeometry() {
  // 前（グラウンド側）が +z。原点は列の床面。
  // 4 万席を描くので、見える面だけの軽い形にする（座面・背もたれ・支柱で 12 三角形）
  const quads = [
    // 座面（上・前）
    [[-0.22, 0.45, -0.13], [0.22, 0.45, -0.13], [0.22, 0.45, 0.25], [-0.22, 0.45, 0.25]],
    [[-0.22, 0.39, 0.25], [-0.22, 0.45, 0.25], [0.22, 0.45, 0.25], [0.22, 0.39, 0.25]],
    // 背もたれ（前・上・後ろ）
    [[-0.22, 0.45, -0.13], [-0.22, 0.88, -0.17], [0.22, 0.88, -0.17], [0.22, 0.45, -0.13]],
    [[-0.22, 0.88, -0.17], [-0.22, 0.88, -0.22], [0.22, 0.88, -0.22], [0.22, 0.88, -0.17]],
    [[0.22, 0.45, -0.18], [0.22, 0.88, -0.22], [-0.22, 0.88, -0.22], [-0.22, 0.45, -0.18]],
    // 支柱（前）
    [[-0.04, 0.0, 0.1], [-0.04, 0.39, 0.1], [0.04, 0.39, 0.1], [0.04, 0.0, 0.1]],
  ];
  const pos = [];
  for (const [a, b, c, d] of quads) pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function buildSeats(sc, buf) {
  const P = sc.seats.parts;
  const pos = toFloat(part(buf, P[0]));
  const yaw = toFloat(part(buf, P[1]), 1000);
  const block = part(buf, P[2]);
  const n = yaw.length;
  const mesh = new THREE.InstancedMesh(seatGeometry(), new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  const grid = new Map();
  for (let i = 0; i < n; i++) {
    q.setFromAxisAngle(up, yaw[i]);
    m.compose(new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]), q, one);
    mesh.setMatrixAt(i, m);
    // 横浜スタジアムの座席は青が基調（空中写真より）
    const v = 0.9 + 0.1 * Math.sin(i * 12.9898);
    c.setRGB(0.1 * v, 0.27 * v, 0.66 * v);
    mesh.setColorAt(i, c);
    const key = `${Math.floor(pos[i * 3] / 2)},${Math.floor(pos[i * 3 + 2] / 2)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  }
  mesh.instanceMatrix.needsUpdate = true;
  S.seats = { pos, yaw, block, mesh, grid, n };
  return mesh;
}

function nearestSeat(x, y, z, maxD = 3, exclude = -1, filter = null) {
  const { pos, grid } = S.seats;
  const cx = Math.floor(x / 2);
  const cz = Math.floor(z / 2);
  const R = Math.ceil(maxD / 2);
  let best = -1;
  let bd = maxD * maxD;
  for (let i = -R; i <= R; i++) {
    for (let j = -R; j <= R; j++) {
      const cell = grid.get(`${cx + i},${cz + j}`);
      if (!cell) continue;
      for (const k of cell) {
        if (k === exclude || (filter && !filter(k))) continue;
        const dx = pos[k * 3] - x;
        const dy = (pos[k * 3 + 1] - y) * 1.5;
        const dz = pos[k * 3 + 2] - z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
    }
  }
  return best;
}

// ------------------------------------------------------------------ ラベル

function makeLabel(text, cls, x, y, z) {
  const el = document.createElement('div');
  el.className = `label ${cls}`;
  el.textContent = text;
  const o = new CSS2DObject(el);
  o.position.set(x, y, z);
  scene.add(o);
  return o;
}

function buildLabels(sc) {
  const fy = sc.field.y;
  for (const l of sc.labels) {
    const y = l.kind === 'building' ? (l.h || 20) + 6 : l.kind === 'park' ? 18 : 14;
    const cls = l.kind === 'station' ? 'station' : l.kind === 'park' ? 'park' : '';
    S.labels.push(makeLabel(l.name, cls, l.x, y, l.z));
  }
  for (const b of sc.blocks) {
    S.blockLabels.push(makeLabel(b.name, 'block', b.label[0], b.label[1], b.label[2]));
  }
  S.labels.push(makeLabel('ホームベース', '', 0, fy + 3, 0));
}

function updateLabelVisibility() {
  const on = document.getElementById('chk-labels').checked;
  for (const l of S.labels) l.visible = on;
  for (const l of S.blockLabels) l.visible = on && S.mode === 'overview';
}

// ------------------------------------------------------------------ 座席の目線

const EYE = 1.12; // 座ったときの目の高さ（座席の床から）

function lookAtPoint(eye, target) {
  const d = new THREE.Vector3().subVectors(target, eye);
  S.yaw = Math.atan2(d.x, d.z);
  S.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
}

function seatEye(i) {
  const p = S.seats.pos;
  const yaw = S.seats.yaw[i];
  // 座面のやや前、背もたれから離れた位置に目を置く
  return new THREE.Vector3(p[i * 3] + Math.sin(yaw) * 0.05, p[i * 3 + 1] + EYE, p[i * 3 + 2] + Math.cos(yaw) * 0.05);
}

function homeTarget() {
  const fy = S.scene.field.y;
  const [cx, cz] = S.scene.cfDir;
  return new THREE.Vector3(cx * 9, fy + 1, cz * 9);
}

function sitAt(i, keepView = false) {
  if (i < 0) return;
  const prevMode = S.mode;
  S.mode = 'seat';
  S.seatIndex = i;
  controls.enabled = false;
  const eye = seatEye(i);
  const fromPos = camera.position.clone();
  const fromQ = camera.quaternion.clone();
  if (!keepView || prevMode !== 'seat') lookAtPoint(eye, homeTarget());
  const toQ = viewQuaternion();
  const fromFov = camera.fov;
  if (prevMode !== 'seat') S.fov = 60;
  startTween(fromPos, fromQ, fromFov, eye, toQ, S.fov, prevMode === 'seat' ? 0.5 : 1.8);
  if (prevMode !== 'seat') S.tween.ctrl = new THREE.Vector3(eye.x, Math.max(fromPos.y, eye.y + 60), eye.z);
  const bid = S.seats.block[i];
  const b = S.scene.blocks.find((x) => x.id === bid);
  document.getElementById('seat-name').textContent = `${b ? b.name : ''}（目安）`;
  document.getElementById('seat-tools').hidden = false;
  document.getElementById('mode-label').textContent = `座席から見る：${b ? b.name : ''}`;
  for (const btn of document.querySelectorAll('#blocks button')) btn.classList.toggle('active', Number(btn.dataset.id) === bid);
  history.replaceState(null, '', `#seat=${i}`);
  updateLabelVisibility();
}

function viewQuaternion() {
  const e = new THREE.Euler(S.pitch, S.yaw + Math.PI, 0, 'YXZ');
  // three のカメラは -z を向くので、yaw に π を足して +z 基準に合わせる
  e.x = S.pitch;
  return new THREE.Quaternion().setFromEuler(e);
}

function startTween(p0, q0, f0, p1, q1, f1, dur) {
  S.tween = { p0, q0, f0, p1, q1, f1, t: 0, dur };
}

function overview() {
  S.mode = 'overview';
  S.seatIndex = -1;
  document.getElementById('seat-tools').hidden = true;
  document.getElementById('mode-label').textContent = '全体を見る';
  for (const btn of document.querySelectorAll('#blocks button')) btn.classList.remove('active');
  const [cx, cz] = S.scene.cfDir;
  const target = new THREE.Vector3(cx * 50, S.scene.field.y, cz * 50);
  const pos = new THREE.Vector3(-cx * 230 + cz * 120, 190, -cz * 230 - cx * 120);
  const m = new THREE.Matrix4().lookAt(pos, target, new THREE.Vector3(0, 1, 0));
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  startTween(camera.position.clone(), camera.quaternion.clone(), camera.fov, pos, q, 50, 1.4);
  S.tween.onEnd = () => {
    controls.target.copy(target);
    controls.enabled = true;
  };
  history.replaceState(null, '', location.pathname);
  updateLabelVisibility();
}

function moveSeat(dir) {
  if (S.seatIndex < 0) return;
  const i = S.seatIndex;
  const p = S.seats.pos;
  const yaw = S.seats.yaw[i];
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const rise = S.scene.seats.rowRise;
  let x = p[i * 3];
  let y = p[i * 3 + 1];
  let z = p[i * 3 + 2];
  // 座席の前 = グラウンド側。左右は座席に座ってグラウンドを向いたときの左右
  if (dir === 'front') {
    x += fx * 0.85;
    z += fz * 0.85;
    y -= rise * 0.7;
  } else if (dir === 'back') {
    x -= fx * 0.85;
    z -= fz * 0.85;
    y += rise * 0.7;
  } else {
    const s = dir === 'right' ? -1 : 1;
    x += fz * s * 1.0;
    z += -fx * s * 1.0;
  }
  const filter =
    dir === 'front'
      ? (k) => p[k * 3 + 1] < p[i * 3 + 1] - 0.03
      : dir === 'back'
        ? (k) => p[k * 3 + 1] > p[i * 3 + 1] + 0.03
        : (k) => Math.abs(p[k * 3 + 1] - p[i * 3 + 1]) < 0.15;
  const k = nearestSeat(x, y, z, 2.5, i, filter);
  if (k >= 0) sitAt(k, true);
}

// ------------------------------------------------------------------ 打球

const raycaster = new THREE.Raycaster();
const ballGeo = new THREE.SphereGeometry(1, 16, 12);
const ballMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

function groundAtFactory() {
  const field = S.scene.field;
  const down = new THREE.Vector3(0, -1, 0);
  const R = 0.12;
  return (x, z, prevY, y) => {
    const o = outlineRadius(field, x, z);
    if (o.d <= o.r) {
      return y <= field.y + R ? { y: field.y + R, kind: 'field' } : null;
    }
    // 外周を越えたところ: フェンス（高さ約 4.5m と仮定）より低ければフェンスに当たる
    if (o.d < o.r + 1.0 && y < field.y + 4.5) return { y, kind: 'fence' };
    raycaster.set(new THREE.Vector3(x, Math.max(prevY, y) + 0.5, z), down);
    raycaster.far = Math.max(prevY, y) + 2;
    const hits = raycaster.intersectObject(S.stadiumMesh, true);
    if (hits.length) {
      const hy = hits[0].point.y;
      return y <= hy + R ? { y: hy + R, kind: 'stand' } : null;
    }
    if (o.d > o.r + 40) {
      // スタジアムの外
      return y <= 1.5 ? { y: 1.5, kind: 'outside' } : null;
    }
    return y <= field.y + R ? { y: field.y + R, kind: 'stand' } : null;
  };
}

function hitBall(preset) {
  const o = { ...preset };
  if (o.spray == null) o.spray = (Math.random() * 2 - 1) * 38;
  const fy = S.scene.field.y;
  const [cx, cz] = S.scene.cfDir;
  const res = simulate(o, {
    start: { x: cx * 0.6 - cz * 0.6, y: fy + 0.9, z: cz * 0.6 + cx * 0.6 },
    cfDir: S.scene.cfDir,
    groundAt: groundAtFactory(),
  });
  const play = S.players.react(res);
  const n = res.points.length;
  const positions = new Float32Array(n * 3);
  res.points.forEach((p, i) => positions.set(p, i * 3));
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  lineGeo.setDrawRange(0, 1);
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xffe14d }));
  const ball = new THREE.Mesh(ballGeo, ballMat);
  ball.scale.setScalar(0.18);
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 16).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  scene.add(line, ball, shadow);
  const b = { res, line, ball, shadow, t0: performance.now() / 1000, done: false, o, play };
  S.players.start(play, b.t0);
  S.balls.push(b);
  while (S.balls.length > 6) removeBall(S.balls.shift());
  document.getElementById('ball-result').textContent = '打球を追跡中…';
}

function removeBall(b) {
  scene.remove(b.line, b.ball, b.shadow);
  b.line.geometry.dispose();
  b.shadow.geometry.dispose();
}

function describe(b) {
  const r = b.res;
  const l = r.firstLand;
  const dist = Math.hypot(l[0], l[2]);
  const apex = r.apex - S.scene.field.y;
  const li = r.firstLandIndex >= 0 && r.firstLandIndex < r.t.length ? r.firstLandIndex : r.t.length - 1;
  const tl = b.play.caught && b.play.fly ? r.t[r.t.length - 1] : r.t[li];
  const foul = Math.abs(b.o.spray) > 45;
  const kinds = { stand: 'ホームラン', outside: '場外ホームラン', fence: 'フェンス直撃', field: 'ヒット' };
  let what = foul ? 'ファウル' : kinds[r.kind];
  if (foul && (r.kind === 'stand' || r.kind === 'outside')) what = 'ファウル（スタンドへ）';
  const who = b.play.fielder.name;
  const liner = apex < 4;
  if (b.play.caught && b.play.fly) {
    what = foul ? `ファウルフライ（${who}がキャッチ）` : liner ? `ライナーでアウト（${who}がキャッチ）` : `フライでアウト（${who}がキャッチ）`;
  }
  else if (b.play.caught) what = foul ? 'ファウル' : b.play.fielder.infield ? `ゴロ（${who}が捕球）` : `ヒット（${who}が捕球）`;
  return (
    `<strong>${what}</strong><br>` +
    `打球速度 ${b.o.speed.toFixed(0)} km/h・角度 ${b.o.angle.toFixed(0)}°<br>` +
    `飛距離 約${dist.toFixed(0)} m・最高 約${apex.toFixed(0)} m・滞空 ${tl.toFixed(1)} 秒`
  );
}

function updateBalls(now) {
  for (const b of S.balls) {
    if (b.done) continue;
    const t = now - b.t0;
    const ts = b.res.t;
    let i = 0;
    while (i < ts.length - 1 && ts[i + 1] < t) i++;
    const p = b.res.points[i];
    b.ball.position.set(p[0], p[1], p[2]);
    b.line.geometry.setDrawRange(0, i + 1);
    b.shadow.position.set(p[0], groundY(p[0], p[2]) + 0.05, p[2]);
    if (i >= ts.length - 1) {
      b.done = true;
      document.getElementById('ball-result').innerHTML = describe(b);
    }
  }
}

function groundY(x, z) {
  const o = outlineRadius(S.scene.field, x, z);
  return o.d <= o.r ? S.scene.field.y : S.scene.field.y + 0.2;
}

function activeBall() {
  for (let k = S.balls.length - 1; k >= 0; k--) if (!S.balls[k].done) return S.balls[k];
  return null;
}

// ------------------------------------------------------------------ 操作

const pointers = new Map();
let pinchStart = null;
let downInfo = null;

renderer.domElement.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  downInfo = { x: e.clientX, y: e.clientY, t: performance.now(), n: pointers.size };
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), fov: S.fov };
  }
});

renderer.domElement.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const cur = { x: e.clientX, y: e.clientY };
  pointers.set(e.pointerId, cur);
  if (S.mode !== 'seat' || S.tween) return;
  if (pointers.size === 2 && pinchStart) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    S.fov = THREE.MathUtils.clamp((pinchStart.fov * pinchStart.d) / d, 8, 80);
    return;
  }
  const k = (S.fov / 60) * 0.0045;
  S.yaw += (cur.x - prev.x) * k;
  S.pitch = THREE.MathUtils.clamp(S.pitch + (cur.y - prev.y) * k, -1.3, 1.3);
  S.userLook = performance.now();
});

const endPointer = (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchStart = null;
  if (e.type === 'pointerup' && downInfo && downInfo.n === 1) {
    const moved = Math.hypot(e.clientX - downInfo.x, e.clientY - downInfo.y);
    if (moved < 6 && performance.now() - downInfo.t < 500) onTap(e);
  }
};
renderer.domElement.addEventListener('pointerup', endPointer);
renderer.domElement.addEventListener('pointercancel', endPointer);

renderer.domElement.addEventListener(
  'wheel',
  (e) => {
    if (S.mode !== 'seat') return;
    e.preventDefault();
    S.fov = THREE.MathUtils.clamp(S.fov * Math.exp(e.deltaY * 0.001), 8, 80);
  },
  { passive: false },
);

function onTap(e) {
  const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  raycaster.far = 5000;
  const targets = [S.stadiumMesh];
  if (S.seats.mesh.visible) targets.push(S.seats.mesh);
  const hits = raycaster.intersectObjects(targets, true);
  if (!hits.length) return;
  const p = hits[0].point;
  const k = nearestSeat(p.x, p.y, p.z, 4, S.mode === 'seat' ? S.seatIndex : -1);
  if (k >= 0) sitAt(k);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  labelRenderer.setSize(innerWidth, innerHeight);
});

// ------------------------------------------------------------------ UI

function buildUI(sc) {
  const blocks = document.getElementById('blocks');
  for (const b of sc.blocks) {
    const btn = document.createElement('button');
    btn.textContent = b.name;
    btn.dataset.id = b.id;
    btn.addEventListener('click', () => {
      const [x, y, z] = b.seat;
      sitAt(nearestSeat(x, y, z, 2));
    });
    blocks.appendChild(btn);
  }
  const presets = document.getElementById('presets');
  for (const p of PRESETS) {
    const btn = document.createElement('button');
    btn.textContent = p.label;
    btn.addEventListener('click', () => hitBall(p));
    presets.appendChild(btn);
  }
  document.getElementById('btn-random').addEventListener('click', () =>
    hitBall({
      speed: 105 + Math.random() * 72,
      angle: -2 + Math.random() * 58,
      spray: (Math.random() * 2 - 1) * 52,
    }),
  );
  document.getElementById('btn-clear').addEventListener('click', () => {
    S.balls.forEach(removeBall);
    S.balls = [];
    S.players.reset();
    document.getElementById('ball-result').textContent = '';
  });
  document.getElementById('btn-overview').addEventListener('click', overview);
  document.getElementById('btn-look-home').addEventListener('click', () => {
    if (S.seatIndex < 0) return;
    lookAtPoint(seatEye(S.seatIndex), homeTarget());
    S.fov = 60;
  });
  for (const btn of document.querySelectorAll('[data-move]')) btn.addEventListener('click', () => moveSeat(btn.dataset.move));
  document.getElementById('chk-follow').addEventListener('change', (e) => (S.follow = e.target.checked));
  document.getElementById('chk-labels').addEventListener('change', updateLabelVisibility);
  document.getElementById('chk-seats').addEventListener('change', (e) => (S.seats.mesh.visible = e.target.checked));
  document.getElementById('chk-players').addEventListener('change', (e) => (S.players.group.visible = e.target.checked));
  const panel = document.getElementById('panel');
  document.getElementById('panel-toggle').addEventListener('click', () => panel.classList.toggle('open'));
  if (isMobile) panel.classList.remove('open');
}

// ------------------------------------------------------------------ ループ

const clock = new THREE.Clock();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const now = performance.now() / 1000;
  updateBalls(now);
  if (S.players) S.players.update(now, !activeBall());

  if (S.tween) {
    const tw = S.tween;
    tw.t += dt;
    const f = Math.min(1, tw.t / tw.dur);
    const e = f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2;
    if (tw.ctrl) {
      // 上から席に降りるように（スタンドの構造物をすり抜けないように）
      const u = 1 - e;
      camera.position.set(
        u * u * tw.p0.x + 2 * u * e * tw.ctrl.x + e * e * tw.p1.x,
        u * u * tw.p0.y + 2 * u * e * tw.ctrl.y + e * e * tw.p1.y,
        u * u * tw.p0.z + 2 * u * e * tw.ctrl.z + e * e * tw.p1.z,
      );
    } else {
      camera.position.lerpVectors(tw.p0, tw.p1, e);
    }
    camera.quaternion.slerpQuaternions(tw.q0, tw.q1, e);
    camera.fov = tw.f0 + (tw.f1 - tw.f0) * e;
    camera.updateProjectionMatrix();
    if (f >= 1) {
      S.tween = null;
      if (tw.onEnd) tw.onEnd();
    }
  } else if (S.mode === 'seat') {
    const b = activeBall();
    if (b && S.follow && !(S.userLook && performance.now() - S.userLook < 1500)) {
      // 打球を目で追う
      const eye = camera.position;
      const d = new THREE.Vector3().subVectors(b.ball.position, eye);
      const ty = Math.atan2(d.x, d.z);
      const tp = Math.atan2(d.y, Math.hypot(d.x, d.z));
      let dy = ty - S.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const s = 1 - Math.exp(-dt * 8);
      S.yaw += dy * s;
      S.pitch += (tp - S.pitch) * s;
    }
    camera.quaternion.copy(viewQuaternion());
    camera.fov += (S.fov - camera.fov) * (1 - Math.exp(-dt * 12));
    camera.updateProjectionMatrix();
  } else {
    controls.update();
  }

  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ 開始

async function main() {
  const [sc, gr] = await Promise.all([fetchJson('scene.json'), fetchJson('ground.json')]);
  S.scene = sc;
  const [stBuf, cityBuf, seatBuf, treeBuf, stTex, nearTex, farTex] = await Promise.all([
    fetchBin(sc.stadium.bin),
    fetchBin(sc.city.bin),
    fetchBin(sc.seats.bin),
    fetchBin(sc.trees.bin),
    loadTex(sc.stadium.texture),
    loadTex(gr.near.file),
    loadTex(gr.far.file),
  ]);

  const near = buildGround(gr.near, nearTex, true, 0);
  scene.add(near);
  scene.add(buildGround(gr.far, farTex, false, -1.5));
  const maxTex = Math.min(renderer.capabilities.maxTextureSize, isMobile ? 2048 : 4096);
  scene.add(buildField(sc.field, sc.cfDir, maxTex));
  S.players = createPlayers(sc.field, sc.cfDir);
  scene.add(S.players.group);
  scene.add(buildStadium(sc, stBuf, stTex));
  scene.add(buildCity(sc, cityBuf));
  scene.add(buildTrees(sc, treeBuf));
  scene.add(buildSeats(sc, seatBuf));
  buildLabels(sc);
  buildUI(sc);

  // 初期視点
  const [cx, cz] = sc.cfDir;
  controls.target.set(cx * 50, sc.field.y, cz * 50);
  camera.position.set(-cx * 230 + cz * 120, 190, -cz * 230 - cx * 120);
  controls.update();
  updateLabelVisibility();

  const m = location.hash.match(/seat=(\d+)/);
  if (m && Number(m[1]) < S.seats.n) sitAt(Number(m[1]));

  document.getElementById('loading').classList.add('done');
  frame();
}

main().catch((e) => {
  console.error(e);
  document.querySelector('#loading p').textContent = '読み込みに失敗しました。ページを再読み込みしてください。';
});
