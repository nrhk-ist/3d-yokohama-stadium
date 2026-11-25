import * as THREE from 'three';

// 関節のある人形（身長 約1.83m）。前が +z、足の裏が y=0。
// 特定のチーム・選手に見えないよう、背番号・文字・ロゴ・模様は入れない。

const C = {
  white: 0xf3f2ec,
  navy: 0x232d50,
  gray: 0x9a9ca1,
  black: 0x1b1b1e,
  umpire: 0x1e2a44,
  umpirePants: 0x5a5d63,
  skin: 0xd9ae88,
  glove: 0x8f5a30,
  shoe: 0x161616,
  bat: 0xc9a26b,
};

const mats = {};
const mat = (c) => (mats[c] ||= new THREE.MeshLambertMaterial({ color: c }));

// 寸法 [m]
const L = {
  thigh: 0.45,
  shin: 0.44,
  foot: 0.075,
  hipW: 0.1,
  torso: 0.52,
  shoulderW: 0.2,
  upperArm: 0.3,
  foreArm: 0.27,
};
const STAND_HIP = L.thigh + L.shin + L.foot;

function mesh(geo, color, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

/** 関節から下に伸びる手足（カプセル）。上端が関節の位置 */
function limb(parent, length, r0, color, segs = 8) {
  const g = new THREE.CapsuleGeometry(r0, Math.max(0.01, length - 2 * r0), 3, segs);
  return mesh(g, color, parent, 0, -length / 2, 0);
}

function joint(parent, x, y, z) {
  const j = new THREE.Group();
  j.position.set(x, y, z);
  parent.add(j);
  return j;
}

const STYLE = {
  fielder: { shirt: C.white, pants: C.white, sock: C.navy, belt: C.navy, cap: C.navy, sleeve: C.navy, glove: true },
  catcher: { shirt: C.white, pants: C.white, sock: C.navy, belt: C.navy, cap: C.navy, sleeve: C.navy, glove: true, gear: C.navy, helmet: true },
  batter: { shirt: C.gray, pants: C.gray, sock: C.black, belt: C.black, cap: C.black, sleeve: C.black, helmet: true, bat: true },
  umpire: { shirt: C.umpire, pants: C.umpirePants, sock: C.black, belt: C.black, cap: C.black, sleeve: C.umpire },
};

export function makeHuman(kind) {
  const s = STYLE[kind] || STYLE.fielder;
  const root = new THREE.Group();
  const hips = joint(root, 0, STAND_HIP, 0);

  // 腰（ベルト）
  mesh(new THREE.CylinderGeometry(0.155, 0.16, 0.06, 14), s.belt, hips, 0, 0.03, 0).scale.set(1, 1, 0.72);
  mesh(new THREE.SphereGeometry(0.16, 14, 10), s.pants, hips, 0, -0.03, 0).scale.set(1, 0.7, 0.72);

  // 胴（腰から上。前傾できるよう関節にする）
  const spine = joint(hips, 0, 0.05, 0);
  const torsoGeo = new THREE.CapsuleGeometry(0.15, 0.26, 4, 14);
  const torso = mesh(torsoGeo, s.shirt, spine, 0, 0.24, 0);
  torso.scale.set(1.18, 1, 0.72);
  if (s.gear) mesh(new THREE.BoxGeometry(0.3, 0.38, 0.06), s.gear, spine, 0, 0.27, 0.11); // プロテクター
  // 首と頭
  mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.1, 10), C.skin, spine, 0, L.torso + 0.02, 0);
  const neck = joint(spine, 0, L.torso + 0.06, 0);
  const head = mesh(new THREE.SphereGeometry(0.105, 18, 14), C.skin, neck, 0, 0.11, 0.005);
  head.scale.set(0.92, 1.08, 1);
  mesh(new THREE.SphereGeometry(0.02, 8, 6), C.skin, neck, 0, 0.1, 0.105); // 鼻
  if (s.helmet) {
    mesh(new THREE.SphereGeometry(0.122, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), s.cap, neck, 0, 0.12, -0.005);
    mesh(new THREE.BoxGeometry(0.2, 0.025, 0.07), s.cap, neck, 0, 0.13, 0.12).rotation.x = 0.15; // つば
  } else {
    mesh(new THREE.SphereGeometry(0.113, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), s.cap, neck, 0, 0.14, 0);
    const brim = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 16, 1, false, -Math.PI / 2, Math.PI), s.cap, neck, 0, 0.14, 0.09);
    brim.scale.set(1.1, 1, 1.2);
  }

  // 腕
  const arms = [];
  for (const side of [-1, 1]) {
    const sh = joint(spine, side * L.shoulderW, L.torso - 0.06, 0);
    mesh(new THREE.SphereGeometry(0.06, 10, 8), s.shirt, sh, 0, 0, 0); // 肩
    limb(sh, 0.14, 0.052, s.sleeve); // 半袖の下のアンダーシャツ
    mesh(new THREE.CapsuleGeometry(0.058, 0.06, 3, 10), s.shirt, sh, 0, -0.06, 0); // 袖
    const el = joint(sh, 0, -L.upperArm, 0);
    limb(sh, L.upperArm, 0.045, s.sleeve);
    limb(el, L.foreArm, 0.04, kind === 'umpire' ? s.sleeve : C.skin);
    const hand = joint(el, 0, -L.foreArm, 0);
    mesh(new THREE.SphereGeometry(0.045, 10, 8), C.skin, hand, 0, -0.03, 0).scale.set(0.8, 1.1, 0.6);
    // 前が +z なので x<0 が右手、x>0 が左手。グラブは左手
    if (s.glove && side === 1) {
      const gl = mesh(new THREE.SphereGeometry(0.1, 12, 10), C.glove, hand, 0, -0.06, 0.03);
      gl.scale.set(0.75, 1.15, 0.45);
    }
    arms.push({ sh, el, hand, side });
  }
  if (s.bat) {
    // バットは右手に持たせる
    const bat = new THREE.Group();
    arms[0].hand.add(bat);
    // 手の関節は指先側が -y。バットは握りから先（太い方）が -y 側に伸びる
    mesh(new THREE.CylinderGeometry(0.014, 0.033, 0.84, 10), C.bat, bat, 0, -0.36, 0);
    bat.position.set(0, -0.05, 0.02);
    arms[0].bat = bat;
  }

  // 脚
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = joint(hips, side * L.hipW, -0.02, 0);
    const thigh = limb(hip, L.thigh, 0.075, s.pants, 10);
    thigh.scale.set(1, 1, 0.95);
    const knee = joint(hip, 0, -L.thigh, 0);
    const shinLen = L.shin;
    mesh(new THREE.CapsuleGeometry(0.06, 0.16, 3, 10), s.pants, knee, 0, -0.1, 0); // ひざ下まで
    limb(knee, shinLen, 0.052, s.sock, 10); // ストッキング
    const ankle = joint(knee, 0, -shinLen, 0);
    const shoe = mesh(new THREE.CapsuleGeometry(0.045, 0.16, 3, 8), C.shoe, ankle, 0, -0.035, 0.05);
    shoe.rotation.x = Math.PI / 2;
    shoe.scale.set(1.1, 1, 0.8);
    legs.push({ hip, knee, ankle, side });
  }

  const body = { root, hips, spine, neck, arms, legs };
  root.userData.setPose = (name, phase = 0) => setPose(body, name, phase);
  root.userData.kind = kind;
  root.userData.neck = neck; // 目線の位置を求めるため
  setPose(body, kind === 'batter' ? 'batter' : kind === 'catcher' ? 'catcher' : kind === 'umpire' ? 'umpire' : 'ready');
  return root;
}

// 関節の角度（ラジアン）。脚・腕は正で前、胴は正で前傾。out は正で外側へ開く。
function legPose(leg, hipA, kneeA, out = 0) {
  leg.hip.rotation.set(-hipA, 0, out * leg.side);
  leg.knee.rotation.x = kneeA;
  leg.ankle.rotation.x = hipA - kneeA; // 足の裏を地面と平行に
}

function armPose(arm, fwd, out, elbow) {
  arm.sh.rotation.set(-fwd, 0, out * arm.side);
  arm.el.rotation.x = -elbow;
}

/** 腰の高さを、脚の角度から足の裏が地面に着くように決める */
function hipHeight(hipA, kneeA) {
  return L.thigh * Math.cos(hipA) + L.shin * Math.cos(kneeA - hipA) + L.foot + 0.02;
}

function setPose(b, name, phase) {
  const [ra, la] = b.arms; // 右腕・左腕
  const [rl, ll] = b.legs;
  b.hips.rotation.set(0, 0, 0);
  b.spine.rotation.set(0, 0, 0);
  b.neck.rotation.set(0, 0, 0);
  if (ra.bat) ra.bat.rotation.set(0, 0, 0);
  let h;
  const both = (f) => {
    f(rl);
    f(ll);
  };
  switch (name) {
    case 'ready': {
      // 守備の構え: ひざを曲げ、前傾して両手を前に
      both((l) => legPose(l, 0.55, 0.85, 0.14));
      b.spine.rotation.x = 0.5;
      b.neck.rotation.x = -0.45;
      armPose(ra, 0.85, -0.12, 0.55);
      armPose(la, 0.85, -0.12, 0.55);
      h = hipHeight(0.55, 0.85);
      break;
    }
    case 'pitcher': {
      both((l) => legPose(l, 0.04, 0.08, 0.06));
      b.spine.rotation.x = 0.06;
      armPose(ra, 0.55, -0.3, 1.75);
      armPose(la, 0.6, -0.3, 1.65);
      h = hipHeight(0.04, 0.08);
      break;
    }
    case 'catcher': {
      // しゃがんで構える
      both((l) => legPose(l, 1.45, 2.45, 0.45));
      b.spine.rotation.x = 0.35;
      b.neck.rotation.x = -0.3;
      armPose(la, 1.25, 0.1, 0.35);
      armPose(ra, 0.45, 0.2, 0.7);
      h = hipHeight(1.45, 2.45);
      break;
    }
    case 'umpire': {
      both((l) => legPose(l, 0.7, 1.1, 0.3));
      b.spine.rotation.x = 0.55;
      b.neck.rotation.x = -0.45;
      armPose(ra, 0.45, 0.3, 0.9);
      armPose(la, 0.45, 0.3, 0.9);
      h = hipHeight(0.7, 1.1);
      break;
    }
    case 'batter': {
      // 右打者の構え（投手は左肩の側）。バットを右肩の上に立てる
      both((l) => legPose(l, 0.25, 0.42, 0.22));
      b.spine.rotation.x = 0.22;
      b.neck.rotation.y = 1.15; // 投手の方を見る
      armPose(ra, 0.45, 0.25, 2.35);
      armPose(la, 0.95, -0.85, 1.75);
      ra.bat.rotation.set(-0.75, 0, 0.45);
      h = hipHeight(0.25, 0.42);
      break;
    }
    case 'run': {
      // 走る: phase はラジアンで進む
      const sn = Math.sin(phase);
      const cs = Math.cos(phase);
      legPose(rl, 0.15 + 0.75 * sn, 0.35 + 1.0 * Math.max(0, -cs), 0.02);
      legPose(ll, 0.15 - 0.75 * sn, 0.35 + 1.0 * Math.max(0, cs), 0.02);
      b.spine.rotation.x = 0.25;
      b.neck.rotation.x = -0.2;
      armPose(ra, -0.75 * sn, 0.08, 1.4);
      armPose(la, 0.75 * sn, 0.08, 1.4);
      h = hipHeight(0.15, 0.55) + 0.05 * Math.abs(cs);
      break;
    }
    case 'catch': {
      // フライを捕る: グラブを顔の上に
      both((l) => legPose(l, 0.08, 0.14, 0.1));
      b.spine.rotation.x = -0.05;
      b.neck.rotation.x = -0.5;
      armPose(la, 2.7, -0.15, 0.45);
      armPose(ra, 2.3, -0.2, 0.8);
      h = hipHeight(0.08, 0.14);
      break;
    }
    default: {
      both((l) => legPose(l, 0, 0, 0.04));
      armPose(ra, 0.05, 0.12, 0.15);
      armPose(la, 0.05, 0.12, 0.15);
      h = hipHeight(0, 0);
    }
  }
  b.hips.position.y = h;
}
