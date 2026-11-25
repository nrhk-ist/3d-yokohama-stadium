"""地面（国土地理院の空中写真と標高）を作る。

出力:
  public/data/ortho_near.jpg  スタジアム周辺の空中写真（z18）
  public/data/ortho_far.jpg   広域の空中写真（z15）
  public/data/ground.json     写真の範囲と標高グリッド
出典: 国土地理院（シームレス空中写真、数値標高モデル DEM5A / DEM10B）
"""
import io
import json
import math
import os
import time
import urllib.request

import numpy as np
from PIL import Image

from common import CACHE, OUT, LON0, LAT0, tile_xy, to_local, to_lonlat

TILE_CACHE = os.path.join(CACHE, "gsi")


def get_tile(kind, z, x, y, ext):
    path = os.path.join(TILE_CACHE, kind, str(z), str(x), f"{y}.{ext}")
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        url = f"https://cyberjapandata.gsi.go.jp/xyz/{kind}/{z}/{x}/{y}.{ext}"
        data = None
        for _ in range(5):
            try:
                data = urllib.request.urlopen(url, timeout=60).read()
                break
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    data = b""
                    break
                time.sleep(2)
            except OSError:
                time.sleep(2)
        if data is None:
            raise OSError(url)
        with open(path, "wb") as f:
            f.write(data)
    with open(path, "rb") as f:
        data = f.read()
    return Image.open(io.BytesIO(data)) if data else None


def ortho(z, half_m, name, max_px):
    """原点を中心に一辺 2*half_m の範囲をタイル単位で切り出す。"""
    lon_w, lat_n = to_lonlat(-half_m, -half_m)
    lon_e, lat_s = to_lonlat(half_m, half_m)
    x0, y0 = tile_xy(lon_w, lat_n, z)
    x1, y1 = tile_xy(lon_e, lat_s, z)
    tx0, ty0, tx1, ty1 = int(x0), int(y0), int(x1), int(y1)
    w, h = (tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256
    img = Image.new("RGB", (w, h), (90, 110, 120))
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            t = get_tile("seamlessphoto", z, tx, ty, "jpg")
            if t is not None:
                img.paste(t.convert("RGB"), ((tx - tx0) * 256, (ty - ty0) * 256))
    n = 2 ** z

    def tile_to_local(tx, ty):
        lon = tx / n * 360 - 180
        lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * ty / n))))
        return to_local(lon, lat)

    xw, zn = tile_to_local(tx0, ty0)
    xe, zs = tile_to_local(tx1 + 1, ty1 + 1)
    if max(w, h) > max_px:
        s = max_px / max(w, h)
        img = img.resize((int(w * s), int(h * s)), Image.LANCZOS)
    img.save(os.path.join(OUT, name), quality=82, optimize=True, progressive=True)
    print(name, img.size)
    return {"file": name, "west": xw, "east": xe, "north": zn, "south": zs}


class Dem:
    """国土地理院 標高タイル（PNG）から標高を引く。"""

    def __init__(self, kind, z):
        self.kind, self.z = kind, z
        self.tiles = {}

    def tile(self, tx, ty):
        key = (tx, ty)
        if key not in self.tiles:
            img = get_tile(self.kind, self.z, tx, ty, "png")
            if img is None:
                self.tiles[key] = None
            else:
                a = np.asarray(img.convert("RGB")).astype(np.int64)
                v = a[:, :, 0] * 65536 + a[:, :, 1] * 256 + a[:, :, 2]
                v = np.where(v < 2 ** 23, v, v - 2 ** 24).astype(np.float64) * 0.01
                v[(a[:, :, 0] == 128) & (a[:, :, 1] == 0) & (a[:, :, 2] == 0)] = np.nan
                self.tiles[key] = v
        return self.tiles[key]

    def height(self, lon, lat):
        x, y = tile_xy(lon, lat, self.z)
        t = self.tile(int(x), int(y))
        if t is None:
            return math.nan
        return t[min(255, int((y % 1) * 256)), min(255, int((x % 1) * 256))]


def grid(half_m, step, dems):
    n = int(round(2 * half_m / step)) + 1
    h = np.zeros((n, n))
    for j in range(n):
        for i in range(n):
            x = -half_m + i * step
            zz = -half_m + j * step
            lon, lat = to_lonlat(x, zz)
            v = math.nan
            for d in dems:
                v = d.height(lon, lat)
                if not math.isnan(v):
                    break
            h[j, i] = v
    h = np.where(np.isnan(h), 0.0, h)  # 海など値のない所は 0 m
    h = np.maximum(h, 0.0)
    return {"half": half_m, "step": step, "n": n, "heights": [round(float(v), 2) for v in h.ravel()]}


def main():
    os.makedirs(OUT, exist_ok=True)
    near = ortho(18, 700, "ortho_near.jpg", 4096)
    far = ortho(15, 3500, "ortho_far.jpg", 2048)
    dem5 = Dem("dem5a_png", 15)
    dem10 = Dem("dem_png", 14)
    g_near = grid(700, 10, [dem5, dem10])
    g_far = grid(3500, 50, [dem5, dem10])
    with open(os.path.join(OUT, "ground.json"), "w") as f:
        json.dump({"near": {**near, "grid": g_near}, "far": {**far, "grid": g_far}}, f, separators=(",", ":"))
    print("origin", LON0, LAT0)


if __name__ == "__main__":
    main()
