#!/usr/bin/env python3
"""主屏图标:纸色底 + 宋体「膚」+ 右下一个红点。字形从 Noto Serif CJK SC 里取轮廓,写成 icon.svg(不依赖设备上有没有这个字体)。

用法:
    uv run --with fonttools python -I tools/build-icons.py /path/to/NotoSerifCJKsc-Regular.otf
    node tools/render-icons.mjs        # icon.svg → icon-180.png / icon-192.png / icon-512.png
想换成「护」:改 GLYPH。
"""
import sys
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
GLYPH = "膚"
PAPER, INK, MEDICAL = "#f4f1ea", "#1f1d1a", "#8a2f1d"
SIZE = 512
GLYPH_H = 0.52 * SIZE           # 字面高度占画面 52%,连红点都留在 maskable 的安全圈(半径 40%)里


def main() -> int:
    font = TTFont(sys.argv[1])
    gs = font.getGlyphSet()
    name = font.getBestCmap()[ord(GLYPH)]
    bp = BoundsPen(gs)
    gs[name].draw(bp)
    x0, y0, x1, y1 = bp.bounds
    k = GLYPH_H / (y1 - y0)
    w = (x1 - x0) * k
    ox = (SIZE - w) / 2 - x0 * k - SIZE * 0.015
    oy = (SIZE + GLYPH_H) / 2 + y0 * k - SIZE * 0.035
    sp = SVGPathPen(gs)
    gs[name].draw(TransformPen(sp, (k, 0, 0, -k, ox, oy)))
    d = sp.getCommands()
    dot_x, dot_y, dot_r = SIZE * 0.75, SIZE * 0.80, SIZE * 0.03   # 落在字的右下、低于字脚:像钤印,不像句号
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}" width="{SIZE}" height="{SIZE}">'
           f'<rect width="{SIZE}" height="{SIZE}" fill="{PAPER}"/>'
           f'<path fill="{INK}" d="{d}"/>'
           f'<circle cx="{dot_x:.1f}" cy="{dot_y:.1f}" r="{dot_r:.1f}" fill="{MEDICAL}"/></svg>\n')
    (ROOT / "icon.svg").write_text(svg, encoding="utf-8")
    print("icon.svg", len(svg), "bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
