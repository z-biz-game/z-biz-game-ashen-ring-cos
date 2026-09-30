#!/usr/bin/env python3
"""灰烬王冠的品牌位图与游戏内位图 —— 一条命令可复现，不依赖网络、不依赖外部资产。

    python3 assets/gen/make_art.py                 # 全量重画进 icons/ textures/ og/
    python3 assets/gen/make_art.py --only icons    # 只重画图标
    python3 assets/gen/make_art.py --check         # 读 PNG IHDR 校验产物（不依赖 PIL）

为什么在仓里自己画：主编的 `007_美术资产/icons` 里根本没有本仓条目（`ls` 实测无
*ashen*），而工单要求图标是真位图且风格与玩法一致。等一个不存在的东西不是方案。

视觉母题：**一枚裂开的王冠坐在灰烬之环里**。
  - 环 = 肉鸽轮回（死了回到同一堆营火），被切三个断口 = 「王冠碎成三次轮回」；
  - 冠 = 抢的那顶，五齿，冠带上三颗宝石用 HUD 的 HP / FP / STAMINA 实测三色；
  - 底 = 余烬从画面下缘烧上来落在近黑上，叠一层确定性 ash 噪点（同一张纹理也进游戏）。
配色不凭空编：全部从 css/hud.css 的 :root 变量实测抽取，HUD 改色之后重跑本命令图标
跟着改，不会出现「图标一套色、游戏另一套色」。所有随机都走 LCG(seed)，同 seed 逐像素同图。
"""

import argparse
import math
import os
import re
import struct
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.abspath(os.path.dirname(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
CSS = os.path.join(REPO, 'css', 'hud.css')

MASTER = 1024                      # 母图；其余尺寸全部由它派生
ICON_SIZES = [512, 192, 180, 96, 64, 48, 32, 16]
SMALL_BOLD = 64                    # <= 这个尺寸走"无噪点"的加粗轮廓变体

FONT_CANDIDATES = {
    'serif_cjk': ['/System/Library/Fonts/Supplemental/Songti.ttc',
                  '/System/Library/Fonts/STHeiti Medium.ttc',
                  '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc'],
    'serif_latin': ['/System/Library/Fonts/Supplemental/Georgia.ttf',
                    '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
                    '/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf'],
}


# ------------------------------------------------------------------ palette
def rgb(h):
    h = h.lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    return tuple(a[i] * (1 - t) + b[i] * t for i in range(3))


def lerp(a, b, t):
    return a * (1 - t) + b * t


def shade(c, f):
    return tuple(min(255.0, max(0.0, v * f)) for v in c)


def rgba(c, a=255):
    return tuple(int(round(v)) for v in c[:3]) + (a,)


def palette():
    """从 css/hud.css 的 :root 抽 CSS 变量；抽不到就直接失败，不许悄悄退回编好的色。"""
    src = open(CSS, encoding='utf-8').read()
    root = re.search(r':root\s*\{(.*?)\n\}', src, re.S)
    if not root:
        raise SystemExit('css/hud.css 里没有 :root 块，抽不到配色')
    found = dict(re.findall(r'--([\w-]+)\s*:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\b', root.group(1)))
    want = ['gold', 'gold-hi', 'gold-dim', 'bone', 'ash', 'bg', 'hp-hi', 'fp-hi', 'st-hi']
    missing = [k for k in want if k not in found]
    if missing:
        raise SystemExit('css/hud.css 缺少配色变量: ' + ', '.join(missing))
    pal = {k.replace('-', '_'): rgb(v) for k, v in found.items()}
    pal['names'] = found
    return pal


# --------------------------------------------------------------------- rng
class LCG:
    def __init__(self, seed=20260930):
        self.s = seed & 0xFFFFFFFF

    def u(self):
        self.s = (self.s * 1664525 + 1013904223) & 0xFFFFFFFF
        return self.s / 4294967296.0

    def range(self, a, b):
        return a + self.u() * (b - a)


# --------------------------------------------------------- periodic noise
def _hash2(x, y, seed):
    h = (x * 374761393 + y * 668265263 + seed * 2654435761) & 0xFFFFFFFF
    h = (h ^ (h >> 13)) & 0xFFFFFFFF
    h = (h * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFFFFFF) / 4294967296.0


def pnoise(x, y, period, seed):
    """可平铺 value noise：格点坐标对 period 取模，所以左右/上下边缘天然接得上。"""
    xi, yi = int(math.floor(x)), int(math.floor(y))
    xf, yf = x - xi, y - yi
    wx = xf * xf * (3 - 2 * xf)
    wy = yf * yf * (3 - 2 * yf)

    def p(a, b):
        return _hash2(a % period, b % period, seed + (a % period) * 31 + (b % period) * 17)

    return lerp(lerp(p(xi, yi), p(xi + 1, yi), wx), lerp(p(xi, yi + 1), p(xi + 1, yi + 1), wx), wy)


def pfbm(x, y, period, seed, octaves=4):
    tot, amp, freq, norm = 0.0, 1.0, 1, 0.0
    for _ in range(octaves):
        tot += amp * pnoise(x * freq, y * freq, period * freq, seed)
        norm += amp
        amp *= 0.5
        freq *= 2
        seed += 977
    return tot / norm


# ---------------------------------------------------------------- textures
_GRAIN = {}


def ash_grain(S=256, seed=13131):
    """平铺 ash 纹理：一层暗尘 + 一层亮灰，alpha 承载数据。

    这既是图标的底噪，也直接进游戏当 `#grain` 那一层（见 css/hud.css），
    所以品牌图和画面是同一张纸。平铺性由 --check 实测，不是嘴上说说。
    """
    key = (S, seed)
    if key in _GRAIN:
        return _GRAIN[key]
    lo, hi = Image.new('L', (S, S)), Image.new('L', (S, S))
    lp, hp = lo.load(), hi.load()
    for y in range(S):
        for x in range(S):
            n = pfbm(x / S * 14.0, y / S * 14.0, 14, seed, 3)
            s = pfbm(x / S * 56.0, y / S * 56.0, 56, seed + 71, 2)
            lp[x, y] = int(max(0.0, min(1.0, (0.575 - n) * 2.4)) * 62)
            hp[x, y] = int(max(0.0, min(1.0, (s - 0.70) * 3.4)) * 46)
    dark = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    dark.putalpha(lo)
    lit = Image.new('RGBA', (S, S), (232, 222, 202, 0))
    lit.putalpha(hi)
    out = Image.alpha_composite(dark, lit)
    _GRAIN[key] = out
    return out


def vgrad(S, top, bottom):
    """竖直金属渐变（一行一色再拉伸，比逐像素填快两个量级）。"""
    strip = Image.new('RGB', (1, S))
    for y in range(S):
        strip.putpixel((0, y), tuple(int(v) for v in mix(top, bottom, y / max(1, S - 1))))
    return strip.resize((S, S), Image.BILINEAR).convert('RGBA')


# ---------------------------------------------------------------- backdrop
def backdrop(S, pal, detail=True, ember_y=0.70, aspect=None):
    """近黑底 + 从下缘烧上来的余烬 + ash 噪点。

    余烬用 160 格网格算完再 LANCZOS 拉伸：径向渐变本身是平滑的，降采样看不出来，
    而 1024² 的纯 Python 逐像素循环要跑十几秒，不划算。
    """
    W, H = aspect or (S, S)
    bg = pal['bg']
    g = 160
    hot = mix(bg, pal['gold_dim'], 0.62)
    warm = mix(bg, pal['gold'], 0.30)
    grid = Image.new('RGB', (g, g))
    gp = grid.load()
    cx = (g - 1) / 2.0
    maxd = math.hypot(cx, (g - 1) * 0.75)
    for y in range(g):
        dy = (y - (g - 1) * ember_y) / maxd
        for x in range(g):
            dx = (x - cx) / maxd
            t = max(0.0, 1.0 - math.hypot(dx, dy) * 1.18) ** 2.0
            c = mix(hot, warm, min(1.0, t * 1.7))
            gp[x, y] = tuple(int(v) for v in mix(bg, c, min(1.0, t * 1.35 + 0.10)))
    img = grid.resize((W, H), Image.LANCZOS).convert('RGBA')
    if detail:
        # 噪点按接近目标的格距现算，再从 512 拉伸一次：256→1024 会把细灰糊成斑块
        nat = max(128, min(512, min(W, H)))
        grain = ash_grain(nat)
        if (nat, nat) != (W, H):
            grain = grain.resize((W, H), Image.BILINEAR)
        img = Image.alpha_composite(img, grain)
    return img


# -------------------------------------------------------------------- art
def ring_layer(S, pal, breaks=True):
    """灰烬之环：金属圆环 + 三处断口 + 内外缘各一道线（不然只是一块金色圆饼）。"""
    cx = cy = S / 2.0
    r_o, r_i = S * 0.398, S * 0.306
    mask = Image.new('L', (S, S), 0)
    d = ImageDraw.Draw(mask)
    d.ellipse([cx - r_o, cy - r_o, cx + r_o, cy + r_o], fill=255)
    d.ellipse([cx - r_i, cy - r_i, cx + r_i, cy + r_i], fill=0)
    if breaks:
        # 三个等分断口：「碎成三次轮回」。用宽描边的弧挖，比多边形好控角度
        cut = Image.new('L', (S, S), 0)
        cd = ImageDraw.Draw(cut)
        rr = (r_o + r_i) / 2
        w = int((r_o - r_i) * 1.06)
        for i in range(3):
            a = 90 + i * 120
            cd.arc([cx - rr, cy - rr, cx + rr, cy + rr], a - 4.2, a + 4.2, fill=255, width=w)
        mask = Image.composite(Image.new('L', (S, S), 0), mask, cut)
    out = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    out.paste(vgrad(S, shade(pal['gold_hi'], 1.02), shade(pal['gold_dim'], 0.80)), (0, 0), mask)
    d = ImageDraw.Draw(out)
    # 内缘暗线
    wi = max(2, int(S * 0.006))
    d.ellipse([cx - r_i, cy - r_i, cx + r_i, cy + r_i], outline=rgba(shade(pal['bg'], 1.6), 200), width=wi)
    # 外缘上半圈高光
    d.arc([cx - r_o + 1, cy - r_o + 1, cx + r_o - 1, cy + r_o - 1], 200, 340,
          fill=rgba(pal['gold_hi'], 210), width=max(2, int(S * 0.005)))
    return out


def crown_polygon(S):
    """五齿王冠轮廓（左下起，顺时针）。坐标全是 S 的分数，母图与派生尺寸同形。"""
    return [(0.292, 0.672), (0.292, 0.408), (0.352, 0.536), (0.408, 0.330),
            (0.462, 0.506), (0.500, 0.278), (0.538, 0.506), (0.592, 0.330),
            (0.648, 0.536), (0.708, 0.408), (0.708, 0.672)]


def crack_polyline(S):
    """贯过冠身的主裂纹，走的是一条抖动的折线 —— 断口，不是划痕。"""
    rng = LCG(70707)
    pts, y = [], 0.286
    while y < 0.672:
        pts.append(((0.470 + 0.140 * (y - 0.286) / 0.386) + rng.range(-0.022, 0.022), y))
        y += rng.range(0.026, 0.048)
    pts.append((0.610, 0.676))
    return pts


def crown_layer(S, pal, detail=True):
    pal_gems = [pal['hp_hi'], pal['gold_hi'], pal['fp_hi']]
    shape = Image.new('L', (S, S), 0)
    pts = [(x * S, y * S) for x, y in crown_polygon(S)]
    ImageDraw.Draw(shape).polygon(pts, fill=255)
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    img.paste(vgrad(S, shade(pal['gold_hi'], 1.06), shade(pal['gold'], 0.58)), (0, 0), shape)
    # 冠带：横过冠底的一条暗带 + 三颗宝石（HUD 的红/金/蓝，戴冠的人一眼认得出这是那套系统）
    band = Image.new('L', (S, S), 0)
    ImageDraw.Draw(band).rectangle([0.292 * S, 0.606 * S, 0.708 * S, 0.654 * S], fill=255)
    dark = Image.new('RGBA', (S, S), rgba(shade(pal['gold_dim'], 0.50), 240))
    img = Image.alpha_composite(img, Image.composite(dark, Image.new('RGBA', (S, S), (0, 0, 0, 0)), band))
    d = ImageDraw.Draw(img)
    for frac, col in zip((0.383, 0.500, 0.617), pal_gems):
        r, by = 0.024 * S, 0.656 * S
        d.polygon([(frac * S, by - 2.1 * r), (frac * S + r, by - 0.5 * r),
                   (frac * S, by + 0.7 * r), (frac * S - r, by - 0.5 * r)], fill=rgba(col, 255))
    if detail:
        # 齿尖高光 + 裂纹
        for x, y in crown_polygon(S)[1:-1:2]:
            r = 0.010 * S
            d.ellipse([x * S - r, y * S - r, x * S + r, y * S + r], fill=rgba(pal['gold_hi'], 255))
        cp = [(x * S, y * S) for x, y in crack_polyline(S)]
        d.line(cp, fill=rgba(pal['bg'], 255), width=max(3, int(0.013 * S)), joint='curve')
        for i in range(1, len(cp) - 1, 2):
            x, y = cp[i][0] + 0.022 * S, cp[i][1]
            d.line([(x, y), (x + 0.030 * S, y - 0.026 * S)], fill=rgba(pal['gold'], 130),
                   width=max(2, int(0.0045 * S)))
    # 暗描边：金冠压在金色环上，不描一圈就会糊成一团
    halo = shape.filter(ImageFilter.MaxFilter(max(3, int(S * 0.007) | 1)))
    halo = Image.composite(Image.new('L', (S, S), 0), halo, shape)
    ink = Image.new('RGBA', (S, S), rgba(shade(pal['bg'], 2.4), 225))
    return Image.alpha_composite(Image.composite(ink, img, halo), img)


def motes(S, pal, n=30, seed=4242):
    """飘起来的余烬尘。只进母图与小尺寸派生之外的大图，16px 上它只是脏点。"""
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    rng = LCG(seed)
    for _ in range(n):
        a = rng.range(0, math.tau)
        r = rng.range(0.20, 0.50) * S
        x, y = S / 2 + math.cos(a) * r, S / 2 + math.sin(a) * r * 0.94
        rad = rng.range(0.0035, 0.010) * S
        d.ellipse([x - rad, y - rad, x + rad, y + rad], fill=rgba(pal['gold_hi'], int(rng.range(70, 200))))
    return img.filter(ImageFilter.GaussianBlur(S * 0.0022))


def master_icon(S=MASTER, pal=None, detail=True):
    """灰烬王冠的母图。detail=False 用于小尺寸：噪点/断口/高光全去掉，只留能读的形状。"""
    pal = pal or palette()
    img = backdrop(S, pal, detail=detail, ember_y=0.74)
    img = Image.alpha_composite(img, ring_layer(S, pal, breaks=detail))
    img = Image.alpha_composite(img, crown_layer(S, pal, detail=detail))
    if detail:
        img = Image.alpha_composite(img, motes(S, pal))
    return img


_CACHE = {}


def derived(size, pal):
    """按尺寸派生：<=SMALL_BOLD 用无噪点的加粗版，其余从母图 LANCZOS 下来。"""
    key = (size, id(pal))
    if key in _CACHE:
        return _CACHE[key]
    if size <= SMALL_BOLD:
        im = master_icon(512, pal, detail=False).resize((size, size), Image.LANCZOS)
    else:
        im = master_icon(MASTER, pal, detail=True).resize((size, size), Image.LANCZOS)
    _CACHE[key] = im
    return im


# --------------------------------------------------------------- og 社交卡
def load_font(kind, size):
    for p in FONT_CANDIDATES[kind]:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size, index=0)
            except OSError:
                continue
    raise SystemExit('找不到 %s 字体（候选：%s）' % (kind, ', '.join(FONT_CANDIDATES[kind])))


def tracked(d, xy, text, font, fill, tracking=0.0):
    """PIL 没有字距，逐字画。魂系标题全靠字距撑，挤成一坨就毁了。"""
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=font, fill=fill)
        x += d.textlength(ch, font=font) + tracking
    return x - tracking


def og_card(out_dir, pal, crest_path=None):
    W, H = 1200, 630
    img = backdrop(W, pal, detail=True, ember_y=0.86, aspect=(W, H)).copy()
    crest = (Image.open(crest_path).convert('RGBA') if crest_path else master_icon(MASTER, pal))
    crest = crest.resize((452, 452), Image.LANCZOS)
    img.alpha_composite(crest, (58, 89))
    d = ImageDraw.Draw(img)
    # 方框是有意的：母图自带余烬底，不框起来会读成一次贴歪了的对齐
    d.rectangle([58, 89, 510, 541], outline=rgba(pal['gold'], 200), width=2)
    d.rectangle([66, 97, 502, 533], outline=rgba(pal['gold_dim'], 150), width=1)
    x0 = 578
    tracked(d, (x0, 128), '灰烬王冠', load_font('serif_cjk', 104), rgba(pal['gold_hi'], 255), tracking=14)
    tracked(d, (x0 + 4, 272), 'ASHEN RING', load_font('serif_latin', 40), rgba(pal['gold'], 255), tracking=13)
    d.line([(x0, 340), (W - 60, 340)], fill=rgba(pal['gold_dim'], 210), width=1)
    tracked(d, (x0 + 2, 358), '浏览器原生 3D 魂系肉鸽', load_font('serif_cjk', 26), rgba(pal['bone'], 240), 3)
    px, py = x0 + 2, 418
    pill = load_font('serif_cjk', 21)
    for t in ['程序化地城', '无敌帧翻滚', '完美弹反', '营火轮回', '圣物三选一', '三场首领战']:
        w = pill.getlength(t) + 26
        if px + w > W - 60:
            px, py = x0 + 2, py + 44
        d.rectangle([px, py, px + w, py + 34], outline=rgba(pal['gold'], 160), width=1)
        d.text((px + 13, py + 4), t, font=pill, fill=rgba(pal['gold_hi'], 235))
        px += w + 12
    d.text((x0 + 2, 528), '王冠碎成三次轮回 · 进度存本地 · 打开即玩', font=load_font('serif_cjk', 19),
           fill=rgba(shade(pal['ash'], 1.2), 235))
    # 右缘压暗：社交卡被裁成 1.91:1 时字仍在安全区
    vig = Image.new('L', (W, H), 0)
    ImageDraw.Draw(vig).rectangle([W - 260, 0, W, H], fill=70)
    veil = Image.new('RGBA', (W, H), rgba(pal['bg'], 255))
    img = Image.alpha_composite(img, Image.composite(veil, Image.new('RGBA', (W, H), (0, 0, 0, 0)), vig))
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, 'ashen-ring-og-1200x630.png')
    img.convert('RGB').save(path, 'PNG', optimize=True)
    return path


# ------------------------------------------------------------------- emit
def png(im, path, flatten_to=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if flatten_to is not None:
        base = Image.new('RGB', im.size, tuple(int(v) for v in flatten_to))
        base.paste(im, (0, 0), im.split()[3])
        im = base
    im.save(path, 'PNG', optimize=True)
    return path


def build(only=None, root=REPO):
    only = set(only or ('icons', 'textures', 'og'))
    pal = palette()
    made, icons = [], os.path.join(root, 'icons')
    if 'icons' in only:
        m = master_icon(MASTER, pal)
        made.append(png(m, os.path.join(icons, 'icon-1024.png')))
        for s in ICON_SIZES:
            made.append(png(derived(s, pal), os.path.join(icons, 'icon-%d.png' % s)))
        # favicon 用加粗的小尺寸变体，16px 上噪点只会把冠尖糊掉
        made.append(png(derived(32, pal), os.path.join(icons, 'favicon-32.png')))
        made.append(png(derived(16, pal), os.path.join(icons, 'favicon-16.png')))
        # maskable：图形缩进 80% 安全区、背景铺满，否则 Android 启动图会裁掉冠尖
        bg = backdrop(512, pal, detail=False, ember_y=0.74)
        art = m.resize((410, 410), Image.LANCZOS)
        bg.alpha_composite(art, (51, 51))
        made.append(png(bg, os.path.join(icons, 'icon-maskable-512.png')))
        # apple-touch-icon 不能带 alpha（iOS 把透明压成黑块），拍平到底色
        made.append(png(derived(180, pal), os.path.join(icons, 'apple-touch-icon.png'),
                        flatten_to=pal['bg']))
    if 'textures' in only:
        made.append(png(ash_grain(256), os.path.join(root, 'textures', 'ash-grain-256.png')))
    if 'og' in only:
        made.append(og_card(os.path.join(root, 'og'), pal,
                            os.path.join(icons, 'icon-1024.png') if 'icons' in only else None))
    return made


def png_size(path):
    """直接读 PNG IHDR，不走 PIL —— 校验不该受 PIL 装没装影响。"""
    with open(path, 'rb') as f:
        head = f.read(33)
    if head[:8] != b'\x89PNG\r\n\x1a\n':
        raise SystemExit('%s 不是 PNG（签名不符）' % path)
    return struct.unpack('>II', head[16:24])


EXPECT = {
    'icons/icon-1024.png': (1024, 1024), 'icons/icon-512.png': (512, 512),
    'icons/icon-192.png': (192, 192), 'icons/icon-180.png': (180, 180),
    'icons/icon-96.png': (96, 96), 'icons/icon-64.png': (64, 64),
    'icons/icon-48.png': (48, 48), 'icons/icon-32.png': (32, 32),
    'icons/icon-16.png': (16, 16), 'icons/icon-maskable-512.png': (512, 512),
    'icons/apple-touch-icon.png': (180, 180),
    'icons/favicon-32.png': (32, 32), 'icons/favicon-16.png': (16, 16),
    'og/ashen-ring-og-1200x630.png': (1200, 630),
    'textures/ash-grain-256.png': (256, 256),
}


def check(root=REPO):
    bad = []
    for rel, (w, h) in EXPECT.items():
        p = os.path.join(root, rel)
        if not os.path.exists(p):
            bad.append('%s 缺失' % rel)
            continue
        if os.path.getsize(p) == 0:
            bad.append('%s 是 0 字节' % rel)
            continue
        got = png_size(p)
        if got != (w, h):
            bad.append('%s 实测 %dx%d，预期 %dx%d' % (rel, got[0], got[1], w, h))
            continue
        print('ok  %-36s %5dx%-5d %8d B' % (rel, w, h, os.path.getsize(p)))
    # 平铺性实测：把纹理与自身平移半周期对齐，比较接缝两侧那一列 alpha
    g = os.path.join(root, 'textures', 'ash-grain-256.png')
    if os.path.exists(g):
        a = Image.open(g).convert('RGBA').split()[3]
        col0 = [a.getpixel((0, y)) for y in range(256)]
        colN = [a.getpixel((255, y)) for y in range(256)]
        edge = sum(abs(x - y) for x, y in zip(col0, colN)) / 256.0
        interior = sum(abs(a.getpixel((128, y)) - a.getpixel((129, y))) for y in range(256)) / 256.0
        print('ok  ash-grain 接缝列平均差 %.2f / 内部相邻列差 %.2f' % (edge, interior))
        if edge > max(6.0, interior * 3.0):
            bad.append('ash-grain 接缝比内部突变大 %.1f 倍，不平铺' % (edge / max(0.5, interior)))
    if bad:
        print('\n'.join('FAIL ' + x for x in bad))
        return 1
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', action='append', choices=['icons', 'textures', 'og'])
    ap.add_argument('--check', action='store_true')
    a = ap.parse_args()
    if a.check:
        sys.exit(check())
    for p in build(a.only):
        print('wrote %-38s %8d B  %dx%d' % (os.path.relpath(p, REPO), os.path.getsize(p), *png_size(p)))


if __name__ == '__main__':
    main()
