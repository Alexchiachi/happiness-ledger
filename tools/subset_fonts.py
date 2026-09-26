#!/usr/bin/env python3
"""
替幸福影響力記帳本產生「只含用到的字」的 Noto Serif TC 與 Cormorant Garamond，
放在 fonts/。

為什麼不直接用 Google Fonts：
`fonts.googleapis.com` 在中國大陸無法連線，而字型的 <link> 是阻擋渲染的請求 ——
連不到時瀏覽器會等到逾時，頁面長時間空白。自架子集同源、無外部請求，
大陸連得到，又能符合 DESIGN.md 的字體標準。

字集從哪來：
用無頭瀏覽器打開頁面，逐一走過每個文字節點，讀出它實際套用的字重，
把字依字重分組。這樣 300（大標）與 500（標籤、印章）只含真正用到的
幾個字，而不是把整份字集重複送三次 —— 差距在四百 KB 以上。
JS 裡的提示語、籤詩與 data/ledger.json 的紀錄內容一律再加進 400。

什麼時候要重跑：
改了 index.html 的文案之後。紀錄增加不必每次重跑 —— 子集裡沒有的字會用
系統明體補上，只是那幾個字字形略有不同。

用法（在專案根目錄）：
    python3 tools/subset_fonts.py

字型授權：SIL Open Font License 1.1，允許子集化與自行託管。
"""
import json
import pathlib
import re
import sys
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "fonts"
# 需要瀏覽器的 UA，否則 Google Fonts 會回傳 ttf 而不是 woff2
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
CHUNK = 400          # text= 參數一次的字數上限


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


PROBE = """
const out = {};
const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
let n;
while ((n = walk.nextNode())) {
  const t = n.textContent;
  if (!t || !t.trim()) continue;
  const el = n.parentElement;
  if (!el || el.closest('script, style')) continue;
  let w = parseInt(getComputedStyle(el).fontWeight, 10) || 400;
  w = w <= 350 ? 300 : (w >= 450 ? 500 : 400);
  out[w] = (out[w] || '') + t;
}
document.querySelectorAll('[placeholder]').forEach(e => {
  out[400] = (out[400] || '') + e.getAttribute('placeholder');
});
return out;
"""


def clean(text):
    return {c for c in text if c.isprintable() and not c.isspace()}


def collect_by_weight():
    """用無頭瀏覽器量出每個字實際套用的字重。"""
    import functools
    import http.server
    import subprocess
    import threading

    handler = functools.partial(http.server.SimpleHTTPRequestHandler,
                                directory=str(ROOT))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]

    probe = ROOT / "tools" / "_probe.js"
    probe.write_text(
        "const { chromium } = require('playwright');\n"
        "(async () => {\n"
        "  const b = await chromium.launch({ executablePath: "
        "process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });\n"
        "  const p = await b.newPage();\n"
        "  await p.goto('http://127.0.0.1:%d/index.html', "
        "{ waitUntil: 'networkidle' });\n"
        "  await p.waitForTimeout(1200);\n"
        "  const r = await p.evaluate(() => {%s});\n"
        "  console.log(JSON.stringify(r));\n"
        "  await b.close();\n"
        "})();\n" % (port, PROBE), encoding="utf-8")
    try:
        run = subprocess.run(["node", str(probe)], capture_output=True,
                             text=True, timeout=180, cwd=str(ROOT))
        if run.returncode != 0:
            raise RuntimeError(run.stderr[-600:])
        measured = json.loads(run.stdout.strip().splitlines()[-1])
    finally:
        probe.unlink(missing_ok=True)
        srv.shutdown()

    by_weight = {int(k): clean(v) for k, v in measured.items()}
    by_weight.setdefault(400, set())

    # JS 裡的提示語、籤詩、錯誤訊息（當下畫面看不到）一律算 400
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    js = html.split("<script>")[-1]
    for m in re.finditer(r"""['"`]([^'"`]*[一-鿿][^'"`]*)['"`]""", js):
        by_weight[400] |= clean(m.group(1))

    # 現有紀錄的內容也算 400（卡片內文是 400）
    ledger = ROOT / "data" / "ledger.json"
    if ledger.exists():
        try:
            for rec in json.loads(ledger.read_text(encoding="utf-8")):
                for k in ("author", "category", "content"):
                    by_weight[400] |= clean(str(rec.get(k, "")))
        except Exception as e:
            print("  ⚠️  讀取 ledger.json 失敗，略過：%s" % e)

    return {w: c for w, c in sorted(by_weight.items()) if c}


def subset_han(by_weight: dict) -> list:
    """依字重向 Google Fonts 要子集，下載 woff2，回傳 @font-face 規則。"""
    faces = []
    for weight, chars in by_weight.items():
        ordered = "".join(sorted(chars))
        groups = [ordered[i:i + CHUNK] for i in range(0, len(ordered), CHUNK)]
        for idx, group in enumerate(groups):
            url = ("https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@"
                   f"{weight}&text={urllib.parse.quote(group)}&display=swap")
            css = fetch(url).decode("utf-8")
            src = re.search(r"src: url\((https://[^)]+)\)", css)
            rng = re.search(r"unicode-range: ([^;]+);", css)
            if not src:
                print(f"  ⚠️  weight {weight} 第 {idx} 段沒有回傳字型，略過")
                continue
            name = f"noto-serif-tc-{weight}-{idx}.woff2"
            (OUT / name).write_bytes(fetch(src.group(1)))
            face = (f"@font-face {{ font-family: 'Noto Serif TC'; font-style: normal; "
                    f"font-weight: {weight}; font-display: swap; "
                    f"src: url({name}) format('woff2');")
            if rng:
                face += f" unicode-range: {rng.group(1)};"
            faces.append(face + " }")
            print(f"  Noto Serif TC {weight} 第 {idx + 1}/{len(groups)} 段 → {name}")
    return faces


def subset_latin() -> list:
    """Cormorant Garamond 只需要拉丁字母，直接取官方的 latin 子集。"""
    url = ("https://fonts.googleapis.com/css2?family=Cormorant+Garamond:"
           "ital,wght@0,300;0,400;0,500;1,400&display=swap")
    css = fetch(url).decode("utf-8")
    faces = []
    for block in re.findall(r"@font-face \{[^}]+\}", css):
        if "unicode-range" in block and "U+0000-00FF" not in block:
            continue  # 只留 latin，跳過 latin-ext、cyrillic、vietnamese
        style = re.search(r"font-style: (\w+)", block).group(1)
        weight = re.search(r"font-weight: (\d+)", block).group(1)
        src = re.search(r"src: url\((https://[^)]+)\)", block)
        if not src:
            continue
        name = f"cormorant-garamond-{weight}-{style}.woff2"
        (OUT / name).write_bytes(fetch(src.group(1)))
        faces.append(
            f"@font-face {{ font-family: 'Cormorant Garamond'; font-style: {style}; "
            f"font-weight: {weight}; font-display: swap; "
            f"src: url({name}) format('woff2'); }}")
        print(f"  Cormorant Garamond {weight} {style} → {name}")
    return faces


def main():
    OUT.mkdir(exist_ok=True)
    for old in OUT.glob("*.woff2"):
        old.unlink()

    by_weight = collect_by_weight()
    for w, c in by_weight.items():
        print(f"  字重 {w}：{len(c)} 個字元")
    print()

    faces = subset_han(by_weight) + subset_latin()

    header = ("/* 由 tools/subset_fonts.py 產生，不要手改。\n"
              "   只含 index.html 與現有紀錄用到的字；授權見 OFL.txt。\n"
              "   不從 fonts.googleapis.com 載入：該網域在中國大陸無法連線，\n"
              "   且字型 <link> 會阻擋渲染。 */\n")
    (OUT / "fonts.css").write_text(header + "\n".join(faces) + "\n", encoding="utf-8")

    total = sum(f.stat().st_size for f in OUT.glob("*.woff2"))
    print(f"\n共 {len(list(OUT.glob('*.woff2')))} 個檔案，合計 {total // 1024} KB")


if __name__ == "__main__":
    sys.exit(main())
