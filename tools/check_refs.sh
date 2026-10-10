#!/usr/bin/env bash
# 核对"页面引用得到的路径"在盘上真的存在 —— 包括 manifest 里那组图标。
#
# 为什么值得单独一条闸：这个仓没有构建步骤，index.html 直读仓库根，所以本地永远
# 是对的；Pages 却是一份手写的 cp 清单。曾经只拷 index.html/css/js/vendor，那样
# manifest.webmanifest、sw.js、icons/、og/ 上了部署站全是 404，而本地 109 条断言
# 一条都不会红 —— 因为浏览器根本没在"前缀 + 只拷四个路径"的那个环境下跑过。
#
#   ./tools/check_refs.sh            # 查仓库
#   ./tools/check_refs.sh _site      # 查已组装好的产物（相对路径，pages.yml 就是这么传的）
#
# 传相对目录时下面会 cd 进去，所以 $ROOT 必须先绝对化再交给后面的消费者：位图那一段
# 是 `python3 - "$ROOT"`、拿 os.path.join(root, rel) 拼路径，留着 "_site" 就会去找
# _site/_site/icons/icon-1024.png，把一份完好的产物报成 MISSING（2026-09-30 与 10-02
# 两次 Pages 红就是这个，不是缺文件）。默认走 $HERE（绝对）时症状不出现，所以这条
# 形态由 ci.yml 的 check 任务显式跑一遍兜住，别只测绝对路径那半边。
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
ROOT=${1:-$HERE}
cd "$ROOT" || { echo "no such dir: $ROOT" >&2; exit 2; }
ROOT=$(pwd)   # 唯一权威值：cd 之后取绝对路径，相对入参在这里被归一
fail=0

check() { # $1 = 相对路径, $2 = 出处
  [ -f "$1" ] && return 0
  echo "MISSING  $1   <- $2" >&2
  fail=1
}

[ -f index.html ] || { echo "no index.html in $ROOT" >&2; exit 2; }

# index.html 里的 href/src（跳过 data: 与绝对 URL，那两类不在盘上）
while IFS= read -r p; do
  case "$p" in ''|data:*|http:*|https:*|\#*) continue ;; esac
  check "${p#./}" index.html
done < <(grep -o 'href="[^"]*"\|src="[^"]*"' index.html | sed 's/^[a-z]*="//; s/"$//')

# manifest 的 icons / screenshots：Chrome 装不装得上就看这几个文件在不在
if [ -f manifest.webmanifest ]; then
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    check "${p#./}" manifest.webmanifest
  done < <(python3 -c "
import json,sys
d=json.load(open('manifest.webmanifest'))
for k in ('icons','screenshots'):
    for i in d.get(k) or []:
        print(i.get('src',''))
" 2>/dev/null || echo '')
  # start_url / scope 必须相对，写死 '/' 会在 Pages 的 /<repo>/ 前缀下跳出作用域
  python3 - <<'PY' || fail=1
import json, sys
d = json.load(open('manifest.webmanifest'))
bad = [k for k in ('name', 'short_name', 'start_url', 'scope', 'display', 'theme_color', 'background_color') if not d.get(k)]
if bad: sys.exit('manifest 缺字段: ' + ', '.join(bad))
for k in ('start_url', 'scope'):
    if not str(d[k]).startswith('./'): sys.exit(f'{k}={d[k]!r} 不是相对路径，前缀部署会跳出作用域')
big = [i for i in d.get('icons') or [] if any(int(s.split('x')[0]) >= 512 for s in [i.get('sizes', '0x0')])]
if not big: sys.exit('manifest 没有 >=512 的图标，Chrome 不会给安装提示')
PY
fi

# 位图必须是真 PNG 且尺寸对得上，不许 0 字节、不许 SVG 冒充
python3 - "$ROOT" <<'PY' || fail=1
import os, struct, sys
root = sys.argv[1]
want = {'icons/icon-1024.png': (1024, 1024), 'icons/icon-512.png': (512, 512),
        'icons/icon-192.png': (192, 192), 'icons/icon-180.png': (180, 180),
        'icons/apple-touch-icon.png': (180, 180), 'icons/icon-maskable-512.png': (512, 512),
        'icons/favicon-32.png': (32, 32), 'icons/favicon-16.png': (16, 16),
        'textures/ash-grain-256.png': (256, 256), 'og/ashen-ring-og-1200x630.png': (1200, 630)}
for rel, (ew, eh) in want.items():
    p = os.path.join(root, rel)
    if not os.path.isfile(p):
        print('MISSING  %s' % rel); sys.exit(1)
    with open(p, 'rb') as f:
        head = f.read(24)
    if head[:8] != b'\x89PNG\r\n\x1a\n':
        print('NOT-PNG  %s' % rel); sys.exit(1)
    w, h = struct.unpack('>II', head[16:24])
    if (w, h) != (ew, eh) or os.path.getsize(p) == 0:
        print('BAD-SIZE %s %dx%d (%d B), 预期 %dx%d' % (rel, w, h, os.path.getsize(p), ew, eh)); sys.exit(1)
print('bitmaps ok: %d 张真 PNG，尺寸与预期逐张相等' % len(want))
PY

if [ "$fail" = 0 ]; then
  echo "check_refs ok in $ROOT: 所有引用路径与位图都在盘上"
else
  echo "check_refs FAILED in $ROOT" >&2
fi
exit $fail
