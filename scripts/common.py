"""座標変換などの共通処理。

表示用の座標系（three.js）:
  x = 東向き [m]、y = 上向き（東京湾平均海面からの標高）[m]、z = 南向き [m]
  原点（x=0, z=0）はホームベース。
"""
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "scripts", ".cache")
PLATEAU = os.path.join(CACHE, "plateau")
OUT = os.path.join(ROOT, "public", "data")

# ホームベースと二塁ベースの位置（国土地理院 シームレス空中写真 z18 から読み取り）。
# z18 タイル (232753, 103438) を左上とする 768px 画像上のピクセル位置。
_TILE0 = (232753, 103438)
HOME_PX = (483.0, 471.5)
SECOND_PX = (460.0, 396.0)


def px_to_lonlat(px, py, z=18, tile0=_TILE0):
    n = 2 ** z
    tx = tile0[0] + px / 256.0
    ty = tile0[1] + py / 256.0
    lon = tx / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * ty / n))))
    return lon, lat


LON0, LAT0 = px_to_lonlat(*HOME_PX)
_phi = math.radians(LAT0)
M_LAT = 111132.92 - 559.82 * math.cos(2 * _phi) + 1.175 * math.cos(4 * _phi)
M_LON = 111412.84 * math.cos(_phi) - 93.5 * math.cos(3 * _phi)


def to_local(lon, lat):
    """経度緯度 → (x 東, z 南) [m]"""
    return (lon - LON0) * M_LON, -(lat - LAT0) * M_LAT


def to_lonlat(x, z):
    return LON0 + x / M_LON, LAT0 - z / M_LAT


def tile_xy(lon, lat, z):
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    r = math.radians(lat)
    y = (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n
    return x, y


_sx, _sz = to_local(*px_to_lonlat(*SECOND_PX))
# センター方向（ホーム→二塁）の単位ベクトル（x, z）
CF_DIR = (_sx / math.hypot(_sx, _sz), _sz / math.hypot(_sx, _sz))
