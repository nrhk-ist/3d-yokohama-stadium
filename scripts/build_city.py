"""PLATEAU（横浜市 2024年度）からスタジアム・周辺の建物・樹木・ラベルを作る。

出力（public/data）:
  stadium.bin / stadium_tex.jpg  スタジアム（写真の貼り付けあり）
  city.bin                        周辺の建物（色分けのみ）
  trees.bin                       樹木（位置と高さ）
  seats.bin                       座席（PLATEAU のスタンド斜面に沿って配置）
  scene.json                      上記の配置情報、グラウンド外周、ブロック、ラベル
出典: 3D都市モデル（Project PLATEAU）横浜市（2024年度）を加工して作成
"""
import json
import math
import os
import shutil
import struct
import xml.etree.ElementTree as ET

import mapbox_earcut as earcut
import numpy as np
from PIL import Image, ImageDraw

from common import CF_DIR, OUT, PLATEAU, to_local

NS = {
    "bldg": "http://www.opengis.net/citygml/building/2.0",
    "gml": "http://www.opengis.net/gml",
    "app": "http://www.opengis.net/citygml/appearance/2.0",
    "veg": "http://www.opengis.net/citygml/vegetation/2.0",
}
B = "{%s}" % NS["bldg"]
G = "{%s}" % NS["gml"]
A = "{%s}" % NS["app"]
V = "{%s}" % NS["veg"]
GID = G + "id"

BLDG_MESHES = ["53391531", "53391530", "53391521", "53391520"]
VEG_MESHES = ["53391531", "53391530"]
STADIUM_MESH = "53391531"
STADIUM_TEX = "53391531_bldg_6697_appearance/yok1127.jpg"
RADIUS = 750.0  # 建物を入れる範囲（ホームベースからの距離）
CITY_SCALE = 40  # 建物の座標の量子化（1/40 m）


def parse_poslist(text):
    v = np.array(text.split(), dtype=np.float64).reshape(-1, 3)
    x, z = to_local(v[:, 1], v[:, 0])
    return np.stack([x, v[:, 2], z], axis=1)  # (x, y=標高, z)


def ring_points(ring):
    pl = ring.find(G + "posList")
    pts = parse_poslist(pl.text)
    if len(pts) > 1 and np.allclose(pts[0], pts[-1]):
        pts = pts[:-1]
    return pts


def triangulate(rings):
    """3D 多角形（外周 + 穴）を三角形分割。返り値: 頂点 (N,3), 三角形インデックス (M,)"""
    pts = np.concatenate(rings)
    if len(pts) < 3:
        return pts, np.zeros(0, dtype=np.uint32)
    # Newell 法で法線を求め、最も大きい成分の軸を落として 2D に投影
    ext = rings[0]
    nx = ny = nz = 0.0
    for i in range(len(ext)):
        a, b = ext[i], ext[(i + 1) % len(ext)]
        nx += (a[1] - b[1]) * (a[2] + b[2])
        ny += (a[2] - b[2]) * (a[0] + b[0])
        nz += (a[0] - b[0]) * (a[1] + b[1])
    ax = int(np.argmax(np.abs([nx, ny, nz])))
    keep = [i for i in range(3) if i != ax]
    p2 = pts[:, keep]
    ends = np.cumsum([len(r) for r in rings]).astype(np.uint32)
    try:
        idx = earcut.triangulate_float64(p2, ends)
    except Exception:
        idx = np.zeros(0, dtype=np.uint32)
    return pts, np.asarray(idx, dtype=np.uint32)


def polygon_rings(poly):
    rings = []
    ext = poly.find(G + "exterior/" + G + "LinearRing")
    if ext is None:
        return None, []
    rings.append(ext)
    rings += poly.findall(G + "interior/" + G + "LinearRing")
    return ext, rings


def building_polys(b):
    """建物の LOD2 面（なければ LOD1）を (面の種類, Polygon 要素) で返す。"""
    out = []
    for bb in b.iter(B + "boundedBy"):
        for surf in bb:
            kind = surf.tag.split("}")[1]
            for ms in surf.findall(B + "lod2MultiSurface"):
                for poly in ms.iter(G + "Polygon"):
                    out.append((kind, poly))
    if not out:
        for solid in b.iter(B + "lod1Solid"):
            for poly in solid.iter(G + "Polygon"):
                out.append(("lod1", poly))
    return out


def bbox_of(b):
    lats, lons = [], []
    for pl in b.iter(G + "posList"):
        v = pl.text.split()
        lats.append(float(v[0]))
        lons.append(float(v[1]))
    return lats, lons


# ---------------------------------------------------------------- 建物


def build_buildings():
    city_pos, city_col = [], []
    stadium = None
    rng = np.random.default_rng(1)
    names = []
    for mesh in BLDG_MESHES:
        path = os.path.join(PLATEAU, "udx", "bldg", f"{mesh}_bldg_6697_op.gml")
        for _, b in ET.iterparse(path):
            if b.tag != B + "Building":
                continue
            lats, lons = bbox_of(b)
            if not lats:
                b.clear()
                continue
            cx, cz = to_local(np.mean(lons), np.mean(lats))
            if math.hypot(cx, cz) > RADIUS:
                b.clear()
                continue
            span = (max(lats) - min(lats)) * 111000
            is_stadium = mesh == STADIUM_MESH and span > 200 and math.hypot(cx, cz) < 150
            polys = building_polys(b)
            if is_stadium:
                stadium = [(k, p) for k, p in polys]
                # 要素を保持するため clear しない
                continue
            h = b.find(B + "measuredHeight")
            nm = b.find(G + "name")
            if nm is not None and nm.text and h is not None:
                names.append((nm.text, cx, cz, float(h.text)))
            tint = rng.uniform(-12, 12)
            for kind, poly in polys:
                ext, rings = polygon_rings(poly)
                if ext is None:
                    continue
                pts, idx = triangulate([ring_points(r) for r in rings])
                if len(idx) == 0:
                    continue
                if kind == "RoofSurface":
                    col = (168 + tint, 164 + tint, 158 + tint)
                elif kind == "GroundSurface":
                    continue
                else:
                    col = (222 + tint, 218 + tint, 210 + tint)
                tri = pts[idx]
                city_pos.append(tri)
                city_col.append(np.tile(np.clip(col, 0, 255), (len(tri), 1)))
            b.clear()
    return np.concatenate(city_pos), np.concatenate(city_col).astype(np.uint8), stadium, names


def stadium_uvs(stadium_ring_ids):
    """スタジアムの面のテクスチャ座標（リング ID → uv 配列）"""
    path = os.path.join(PLATEAU, "udx", "bldg", f"{STADIUM_MESH}_bldg_6697_op.gml")
    uvs = {}
    for _, el in ET.iterparse(path):
        if el.tag == A + "ParameterizedTexture":
            uri = el.find(A + "imageURI")
            if uri is not None and uri.text == STADIUM_TEX:
                for tc in el.iter(A + "textureCoordinates"):
                    rid = tc.get("ring", "").lstrip("#")
                    if rid in stadium_ring_ids:
                        uvs[rid] = np.array(tc.text.split(), dtype=np.float64).reshape(-1, 2)
            el.clear()
        elif el.tag == B + "Building":
            el.clear()
    return uvs


def build_stadium(stadium):
    ring_ids = set()
    for _, poly in stadium:
        _, rings = polygon_rings(poly)
        for r in rings:
            ring_ids.add(r.get(GID))
    uvs = stadium_uvs(ring_ids)
    tex_pos, tex_uv, kinds = [], [], []
    plain_pos = []
    stand_tris = []  # 座席を置くスタンド斜面
    all_tris = []
    for kind, poly in stadium:
        ext, rings = polygon_rings(poly)
        if ext is None:
            continue
        rp = [ring_points(r) for r in rings]
        pts, idx = triangulate(rp)
        if len(idx) == 0:
            continue
        tri = pts[idx]
        all_tris.append((kind, tri))
        if kind == "OuterFloorSurface":
            stand_tris.append(tri)
        ruv = []
        ok = True
        for r, p in zip(rings, rp):
            uv = uvs.get(r.get(GID))
            if uv is None:
                ok = False
                break
            ruv.append(uv[: len(p)])
        if ok and all(len(u) == len(p) for u, p in zip(ruv, rp)):
            uv_all = np.concatenate(ruv)
            tex_pos.append(tri)
            tex_uv.append(uv_all[idx])
            kinds.append(np.full(len(tri), {"OuterFloorSurface": 1, "RoofSurface": 2}.get(kind, 0), np.uint8))
        else:
            plain_pos.append(tri)
    return (
        np.concatenate(tex_pos),
        np.concatenate(tex_uv),
        np.concatenate(kinds),
        np.concatenate(plain_pos) if plain_pos else np.zeros((0, 3)),
        np.concatenate(stand_tris).reshape(-1, 3, 3),
        all_tris,
    )


# ---------------------------------------------------------------- グラウンド


def field_outline(all_tris, mound):
    """スタンド・壁を真上から塗った画像で、マウンドから見えるグラウンドの外周を求める。"""
    res = 0.2
    half = 140
    size = int(2 * half / res)
    img = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(img)
    for kind, tri in all_tris:
        if kind == "GroundSurface":
            continue
        for t in tri.reshape(-1, 3, 3):
            d.polygon([((p[0] + half) / res, (p[2] + half) / res) for p in t], fill=255)
    mask = np.asarray(img) > 0
    rs = []
    for k in range(720):
        a = math.radians(k / 2)
        dx, dz = math.sin(a), -math.cos(a)  # 北から時計回り
        r = 5.0
        while r < 135:
            x, z = mound[0] + dx * r, mound[1] + dz * r
            i, j = int((x + half) / res), int((z + half) / res)
            if mask[j, i]:
                break
            r += res / 2
        rs.append(round(r, 2))
    return rs


# ---------------------------------------------------------------- 座席

ROW_RISE = 0.42  # 1 列あたりの高さの差の上限 [m]（推定）
ROW_DEPTH = 0.85  # 1 列の奥行き [m]（推定）
SEAT_W = 0.5  # 座席の幅 [m]（推定）


def build_seats(stand_tris, field_center):
    seats = []
    for t in stand_tris:
        a, b, c = t
        n = np.cross(b - a, c - a)
        ln = np.linalg.norm(n)
        if ln < 1e-6:
            continue
        n = n / ln
        if n[1] < 0:
            n = -n
        slope = math.degrees(math.acos(min(1.0, n[1])))
        if not (4 <= slope <= 50):
            continue
        # 傾きがゆるい面は列の高さの差を小さくして、奥行きを一定に保つ
        rise = min(ROW_RISE, ROW_DEPTH * math.tan(math.radians(slope)))
        rise = max(0.06, round(rise / 0.02) * 0.02)
        down = np.array([n[0], 0, n[2]])
        down /= np.linalg.norm(down)
        cen = t.mean(axis=0)
        to_c = np.array([field_center[0] - cen[0], 0, field_center[1] - cen[2]])
        dist = np.linalg.norm(to_c)
        if dist > 130 or np.dot(down, to_c / dist) < 0.4:
            continue
        ys = t[:, 1]
        k0 = math.ceil(ys.min() / rise + 0.5)
        k1 = math.floor(ys.max() / rise - 0.5)
        yaw = math.atan2(down[0], down[2])  # 座席の向き（スタンドの下り方向）
        for k in range(k0, k1 + 1):
            h = k * rise
            seg = []
            for p, q in ((a, b), (b, c), (c, a)):
                if (p[1] - h) * (q[1] - h) < 0:
                    s = (h - p[1]) / (q[1] - p[1])
                    seg.append(p + (q - p) * s)
            if len(seg) != 2:
                continue
            p, q = seg
            L = np.linalg.norm(q - p)
            m = int(L / SEAT_W)
            for i in range(m):
                s = (i + 0.5) / m
                pos = p + (q - p) * s
                seats.append((pos[0], pos[1], pos[2], yaw))
    return np.array(seats, dtype=np.float32)


UPPER_Y = 8.3  # 内野の下段と上段を分ける高さ（PLATEAU の通路の高さ 約7.9m の少し上）


# ブロック（一般的な区分。公式の区分ではない）
def classify(seats, home):
    out = []
    cfx, cfz = CF_DIR
    for x, y, z, _ in seats:
        dx, dz = x - home[0], z - home[1]
        # センター方向を 0°、一塁側（右）を正とする角度
        fwd = dx * cfx + dz * cfz
        right = dx * (-cfz) + dz * cfx  # 右手方向（CF を向いて右）
        ang = math.degrees(math.atan2(right, fwd))
        aa = abs(ang)
        side = "1" if ang > 0 else "3"
        if aa < 44:
            if y > 26 and ang > 0:
                key = "RW"
            else:
                key = "R" if ang > 13 else ("L" if ang < -13 else "C")
        elif aa > 148:
            key = "BU" if y > UPPER_Y else "BL"
        else:
            key = side + ("U" if y > UPPER_Y else "L")
        out.append(key)
    return out


BLOCKS = {
    "BL": "バックネット裏 下段",
    "BU": "バックネット裏",
    "1L": "1塁側 内野 下段",
    "1U": "1塁側 内野 上段",
    "3L": "3塁側 内野 下段",
    "3U": "3塁側 内野 上段",
    "R": "ライト 外野",
    "C": "センター 外野",
    "L": "レフト 外野",
    "RW": "ライト ウィング席",
}


# ---------------------------------------------------------------- 樹木


def build_trees():
    trees = []
    for mesh in VEG_MESHES:
        path = os.path.join(PLATEAU, "udx", "veg", f"{mesh}_veg_6697_op.gml")
        for _, el in ET.iterparse(path):
            if el.tag != V + "SolitaryVegetationObject":
                continue
            h = el.find(V + "height")
            pts = [parse_poslist(pl.text) for pl in el.iter(G + "posList")]
            if h is None or not pts:
                el.clear()
                continue
            p = np.concatenate(pts)
            x, z = p[:, 0].mean(), p[:, 2].mean()
            if math.hypot(x, z) < RADIUS:
                r = max(1.0, (np.ptp(p[:, 0]) + np.ptp(p[:, 2])) / 4)
                trees.append((x, p[:, 1].min(), z, float(h.text), min(r, 8.0)))
            el.clear()
    return np.array(trees, dtype=np.float32)


# ---------------------------------------------------------------- ラベル


# ラベルにする種類（交番や郵便局などは数が多く見づらいので外す）
LANDMARK_KINDS = {"ランドマーク", "地方の機関", "博物館・美術館"}
FAMOUS = {"横浜税関", "神奈川県庁舎", "横浜市中区役所"}


def build_labels(names):
    labels = []
    rel = os.path.join(PLATEAU)
    for f, key, kind in (
        ("14104_yokohama-shi_city_2023_naka-ku_station.geojson", "駅名", "station"),
        ("14104_yokohama-shi_city_2023_naka-ku_landmark.geojson", "名称", "landmark"),
    ):
        with open(os.path.join(rel, f), encoding="utf-8") as fp:
            d = json.load(fp)
        seen = set()
        feats = d["features"]
        if kind == "station":
            # 同じ名前の駅が複数あるとき（地下鉄と JR など）は、地上に駅舎が見える JR の位置を使う
            feats = sorted(feats, key=lambda f: f["properties"].get("運営会社") != "東日本旅客鉄道")
        for ft in feats:
            lon, lat = ft["geometry"]["coordinates"][:2]
            x, z = to_local(lon, lat)
            nm = ft["properties"][key]
            if kind == "landmark" and ft["properties"].get("種類") not in LANDMARK_KINDS:
                continue
            if math.hypot(x, z) < 900 and nm not in seen:
                seen.add(nm)
                label = nm + ("駅" if kind == "station" and not nm.endswith("駅") else "")
                labels.append({"name": label, "x": round(x, 1), "z": round(z, 1), "kind": kind})
    with open(os.path.join(rel, "14100_yokohama-shi_city_2023_park.geojson"), encoding="utf-8") as fp:
        d = json.load(fp)
    for ft in d["features"]:
        if ft["properties"].get("公園名") in ("横浜公園", "日本大通り", "山下公園"):
            lon, lat = ft["geometry"]["coordinates"][:2]
            x, z = to_local(lon, lat)
            if math.hypot(x, z) < 900:
                labels.append({"name": ft["properties"]["公園名"], "x": round(x, 1), "z": round(z, 1), "kind": "park"})
    names_have = {l["name"] for l in labels}
    for nm, x, z, h in names:
        if nm in FAMOUS and nm not in names_have:
            labels.append({"name": nm, "x": round(x, 1), "z": round(z, 1), "kind": "building", "h": h})
    return labels


# ---------------------------------------------------------------- 出力


def write_bin(path, arrays):
    """複数の配列を 4 バイト境界で連結。返り値は各配列の (offset, 要素数)。"""
    meta = []
    with open(path, "wb") as f:
        for a in arrays:
            off = f.tell()
            f.write(a.tobytes())
            pad = (-f.tell()) % 4
            f.write(b"\0" * pad)
            meta.append({"offset": off, "length": int(a.size), "dtype": str(a.dtype)})
    return meta


def main():
    os.makedirs(OUT, exist_ok=True)
    city_pos, city_col, stadium, names = build_buildings()
    print("city triangles", len(city_pos) // 3, "names", len(names))
    tex_pos, tex_uv, kinds, plain_pos, stand_tris, all_tris = build_stadium(stadium)
    print("stadium textured tris", len(tex_pos) // 3, "plain", len(plain_pos) // 3, "stand tris", len(stand_tris))

    home = (0.0, 0.0)
    mound = (CF_DIR[0] * 18.44, CF_DIR[1] * 18.44)
    # グラウンド面の高さ: ホーム付近の最も低い壁の下端
    field_y = min(t[:, 1].min() for k, t in all_tris if k == "WallSurface" and np.hypot(t[:, 0], t[:, 2]).min() < 40)
    outline = field_outline(all_tris, mound)
    print("field y", field_y)

    seats = build_seats(stand_tris, (mound[0] + CF_DIR[0] * 20, mound[1] + CF_DIR[1] * 20))
    keys = classify(seats, home)
    order = list(BLOCKS)
    block_id = np.array([order.index(k) for k in keys], dtype=np.uint8)
    print("seats", len(seats), {k: keys.count(k) for k in order})

    trees = build_trees()
    print("trees", len(trees))

    # 量子化して軽くする（cm 単位の int16 / int32）
    def q(a, s=100):
        return np.round(np.asarray(a) * s).astype(np.int32)

    shutil.copy(os.path.join(PLATEAU, "udx", "bldg", STADIUM_TEX), os.path.join(OUT, "stadium_tex.jpg"))
    st_meta = write_bin(
        os.path.join(OUT, "stadium.bin"),
        [
            q(tex_pos.reshape(-1, 3)),
            np.round(tex_uv.reshape(-1, 2) * 65535).clip(0, 65535).astype(np.uint16),
            kinds,
            q(plain_pos.reshape(-1, 3)),
        ],
    )
    # 建物は ±750m の範囲なので 2.5cm 単位の int16 に収まる
    city_meta = write_bin(
        os.path.join(OUT, "city.bin"),
        [np.round(city_pos.reshape(-1, 3) * CITY_SCALE).astype(np.int16), city_col.reshape(-1)],
    )
    seat_meta = write_bin(os.path.join(OUT, "seats.bin"), [q(seats[:, :3]), q(seats[:, 3], 1000), block_id])
    tree_meta = write_bin(os.path.join(OUT, "trees.bin"), [q(trees)])

    # ブロックごとの代表席（中ほどの列の中央付近）
    blocks = []
    for i, k in enumerate(order):
        m = block_id == i
        if not m.any():
            continue
        s = seats[m]
        ymed = np.median(s[:, 1])
        cand = s[np.abs(s[:, 1] - ymed) < 0.8]
        c = cand[:, [0, 2]].mean(axis=0)
        best = cand[np.argmin(np.hypot(cand[:, 0] - c[0], cand[:, 2] - c[1]))]
        blocks.append(
            {
                "id": i,
                "key": k,
                "name": BLOCKS[k],
                "count": int(m.sum()),
                "seat": [round(float(v), 2) for v in best],
                "label": [round(float(s[:, 0].mean()), 1), round(float(s[:, 1].max()) + 2, 1), round(float(s[:, 2].mean()), 1)],
            }
        )

    scene = {
        "origin": {"lon": float(__import__("common").LON0), "lat": float(__import__("common").LAT0)},
        "cfDir": CF_DIR,
        "field": {"y": round(float(field_y), 2), "mound": mound, "outline": outline},
        "stadium": {"bin": "stadium.bin", "texture": "stadium_tex.jpg", "parts": st_meta},
        "city": {"bin": "city.bin", "parts": city_meta, "scale": CITY_SCALE},
        "seats": {"bin": "seats.bin", "parts": seat_meta, "rowRise": ROW_RISE, "seatWidth": SEAT_W},
        "trees": {"bin": "trees.bin", "parts": tree_meta},
        "blocks": blocks,
        "labels": build_labels(names),
    }
    with open(os.path.join(OUT, "scene.json"), "w", encoding="utf-8") as f:
        json.dump(scene, f, ensure_ascii=False, separators=(",", ":"))
    for fn in os.listdir(OUT):
        print(fn, os.path.getsize(os.path.join(OUT, fn)))


if __name__ == "__main__":
    main()
