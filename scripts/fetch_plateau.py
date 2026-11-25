"""PLATEAU の配布 ZIP から必要なファイルだけを HTTP Range で取り出す。

使い方: python3 scripts/fetch_plateau.py <ZIP の URL> <出力先> <ZIP 内のパス>...
ZIP 全体（数 GB）を落とさずに、中央ディレクトリと対象ファイルの範囲だけを取得する。
接続が途中で切れても、取得済みのバイトから再開する。
"""
import os
import struct
import subprocess
import sys
import urllib.request
import zipfile
import zlib


class HttpFile:
    """zipfile が読める、Range リクエストで読むファイルもどき。"""

    def __init__(self, url):
        self.url = url
        self.pos = 0
        req = urllib.request.Request(url, method="HEAD")
        self.size = int(urllib.request.urlopen(req).headers["Content-Length"])

    def seekable(self):
        return True

    def seek(self, offset, whence=0):
        base = {0: 0, 1: self.pos, 2: self.size}[whence]
        self.pos = base + offset
        return self.pos

    def tell(self):
        return self.pos

    def read(self, n=-1):
        if n < 0:
            n = self.size - self.pos
        if n == 0:
            return b""
        end = min(self.pos + n, self.size) - 1
        for _ in range(8):
            try:
                req = urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{end}"})
                data = urllib.request.urlopen(req, timeout=120).read()
                break
            except OSError:
                continue
        else:
            raise OSError("range read failed")
        self.pos += len(data)
        return data


def fetch_range(url, start, end, path):
    """start..end-1 を path に追記しながら取得（切れたら続きから）。"""
    for _ in range(100):
        have = os.path.getsize(path) if os.path.exists(path) else 0
        if have >= end - start:
            return
        with open(path, "ab") as f:
            subprocess.run(
                ["curl", "-s", "--max-time", "600", "-r", f"{start + have}-{end - 1}", url, "-o", "-"],
                stdout=f,
                check=False,
            )
    raise OSError("download failed: " + url)


def main():
    url, out, names = sys.argv[1], sys.argv[2], sys.argv[3:]
    z = zipfile.ZipFile(HttpFile(url))
    for name in names:
        dest = os.path.join(out, name)
        if os.path.exists(dest):
            print("skip", name)
            continue
        info = z.getinfo(name)
        start = info.header_offset
        end = start + 30 + len(info.orig_filename.encode()) + 4096 + info.compress_size
        end = min(end, z.fp.size)
        part = dest + ".part"
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        fetch_range(url, start, end, part)
        with open(part, "rb") as f:
            head = f.read(30)
            nlen, elen = struct.unpack("<HH", head[26:30])
            f.seek(30 + nlen + elen)
            data = f.read(info.compress_size)
        raw = zlib.decompress(data, -15) if info.compress_type == zipfile.ZIP_DEFLATED else data
        if zlib.crc32(raw) != info.CRC:
            os.remove(part)
            raise OSError("CRC mismatch: " + name)
        with open(dest, "wb") as f:
            f.write(raw)
        os.remove(part)
        print("ok", name, len(raw))


if __name__ == "__main__":
    main()
