#!/usr/bin/env python3
"""重做中文宋体子集 fonts/noto-serif-sc-400-skin.woff2(只一个字重 400)。

用法(本机不全局装 fonttools,用 uv 临时环境):
    uv run --with fonttools --with brotli python -I tools/build-fonts.py /path/to/NotoSerifCJKsc-Regular.otf

字表 = 《GB 2312》一级 3755 个常用字(本地用 Python 自带的 gb2312 编解码生成,不用下载字表)
     ∪ index.html 和 js/ 下全部模块里实际出现的汉字(v2;v1 时是 index.html / ai.js)
     ∪ fonts/extra-chars.txt 的领域字表(护肤成分、症状、皮肤科病名、HRT 药名:鲨 脓疱 钛 睾 荟 ……
        这些不在一级字表里,顾问一写就落到系统字体,一段话里一半宋体一半苹方)
     ∪ 全角标点、中文引号、省略号。
重做之后原地覆盖同一个文件名:一定要给 sw.js 的 CACHE_NAME 升版(t/engine-unit.mjs 会核)。
顾问写出来的话基本落在常用字里,离线也是宋体;子集外的生僻字落到下一个字体(见 index.html 的 --serif)。

输出:
    fonts/noto-serif-sc-400-skin.woff2       子集(内部字体名改成 Skin Serif SC,版权和 OFL 许可原样保留)
    fonts/noto-serif-sc-400-skin.chars.txt   子集覆盖的字符(t/s-60-offline.mjs 用它检查界面用字有没有漏)
    fonts/noto-serif-sc-400-skin.meta.json   来源字体的版本和 sha256
"""
import hashlib
import json
import re
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "fonts" / "noto-serif-sc-400-skin.woff2"
CHARS = ROOT / "fonts" / "noto-serif-sc-400-skin.chars.txt"
META = ROOT / "fonts" / "noto-serif-sc-400-skin.meta.json"
FAMILY = "Skin Serif SC"
UI_FILES = ["index.html"] + sorted(str(p.relative_to(ROOT)) for p in (ROOT / "js").rglob("*.js"))
EXTRA = ROOT / "fonts" / "extra-chars.txt"
CJK = re.compile(r"[　-〿㐀-䶿一-鿿豈-﫿＀-￯]")
PUNCT = "·—‘’“”…、。，：；！？（）《》〈〉「」『』【】〔〕～－"


def gb2312_level1() -> str:
    out = []
    for hi in range(0xB0, 0xD8):
        for lo in range(0xA1, 0xFF):
            if hi == 0xD7 and lo > 0xF9:
                continue
            out.append(bytes([hi, lo]).decode("gb2312"))
    return "".join(out)


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    src = Path(sys.argv[1])
    ui = "".join(CJK.findall("".join((ROOT / f).read_text(encoding="utf-8") for f in UI_FILES)))
    extra = "".join(CJK.findall("".join(l for l in EXTRA.read_text(encoding="utf-8").splitlines() if not l.startswith("#")))) if EXTRA.exists() else ""
    wanted = set(gb2312_level1()) | set(ui) | set(extra) | set(PUNCT) | {chr(c) for c in range(0x3000, 0x3040)}
    font = TTFont(src)
    cmap = font.getBestCmap()
    have = sorted(ch for ch in wanted if ord(ch) in cmap)
    missing = sorted(ch for ch in set(ui) if ord(ch) not in cmap)
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.hinting = False
    opts.desubroutinize = True
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.notdef_outline = True
    sub = subset.Subsetter(opts)
    sub.populate(text="".join(have))
    sub.subset(font)
    # 改名:子集是改过的字体,按 OFL 的惯例换个内部名字;版权(0)、许可(13/14)不动
    name = font["name"]
    for rec in list(name.names):
        if rec.nameID in (1, 16):
            rec.string = FAMILY
        elif rec.nameID == 4:
            rec.string = FAMILY + " Regular"
        elif rec.nameID == 6:
            rec.string = "SkinSerifSC-Regular"
        elif rec.nameID == 3:
            rec.string = "SkinSerifSC-Regular;subset-of;" + str(rec)
    if "CFF " in font:
        cff = font["CFF "].cff
        cff.fontNames = ["SkinSerifSC-Regular"]
    OUT.parent.mkdir(exist_ok=True)
    font.flavor = "woff2"
    font.save(OUT)
    CHARS.write_text("".join(have), encoding="utf-8")
    src_name = TTFont(src, lazy=True)["name"]
    meta = {
        "source_font": str(src_name.getName(4, 3, 1, 0x409)),
        "source_version": str(src_name.getName(5, 3, 1, 0x409)),
        "source_sha256": hashlib.sha256(src.read_bytes()).hexdigest(),
        "license": "SIL Open Font License 1.1 (fonts/LICENSES.txt)",
        "charset": "GB 2312 level 1 + UI text of index.html/js/**/*.js + fonts/extra-chars.txt + CJK punctuation",
        "extra_characters": len(set(extra)),
        "character_count": len(have),
        "ui_characters": len(set(ui)),
        "ui_missing_in_source": "".join(missing),
        "bytes": OUT.stat().st_size,
        "font_sha256": hashlib.sha256(OUT.read_bytes()).hexdigest(),
    }
    META.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(meta, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
