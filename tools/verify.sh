#!/usr/bin/env bash
# One-shot verification: real GPU, small viewport, trap + watchdog teardown.
#
# Do NOT add --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader.
# Software rasterization saturates ~10 cores and, with no CDP client attached,
# the process will not exit on its own.
#
#   ./tools/verify.sh            # runs @combat @spell @run, writes /tmp screenshots
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
PORT=${CDP_PORT:-9334}
BASE=${BASE_URL:-http://127.0.0.1:5173/}
CHROME=${CHROME_BIN:-}
if [ -z "$CHROME" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "/Applications/Chromium.app/Contents/MacOS/Chromium" \
           google-chrome chromium chromium-browser; do
    if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then CHROME=$c; break; fi
  done
fi
[ -x "$CHROME" ] || { echo "no Chrome found; set CHROME_BIN" >&2; exit 2; }

UDD=$(mktemp -d)
"$CHROME" --headless=new --remote-debugging-port=$PORT --user-data-dir=$UDD \
  --window-size=820,620 --no-first-run --no-default-browser-check about:blank >/tmp/ashen-chrome.log 2>&1 &
CPID=$!
cleanup() { kill -9 $CPID 2>/dev/null; rm -rf $UDD; }
trap cleanup EXIT
# Watchdog redirects its fds: a background subshell inherits the script's stdout,
# and if this runs inside a pipeline it will hold the write end open for the full
# timeout and stall the consumer long after the tests finished.
( sleep 420; cleanup ) </dev/null >/dev/null 2>&1 & WD=$!

export CDP_PORT=$PORT
export BASE_URL=$BASE
cd "$HERE"
node tools/playtest.mjs open "$BASE" | head -3
# The loop skips frames on a hidden page (by design) and headless reports hidden.
node tools/playtest.mjs eval "Object.defineProperty(document,'hidden',{get:()=>false,configurable:true});Object.defineProperty(document,'visibilityState',{get:()=>'visible',configurable:true});'visible'" nonav >/dev/null 2>&1
FAILED=0
for s in combat spell run; do
  echo "=== @$s ==="
  node tools/playtest.mjs eval "@$s" nonav 2>&1 | python3 -c "
import sys,json,re
raw=sys.stdin.read()
m=re.search(r'\{.*\}', raw, re.S)
if not m: print('NO RESULT', raw[-300:]); sys.exit(1)
d=json.loads(m.group(0))
rows=d.get('rows',[])
print('rows:',len(rows),'fail:',d.get('fail'))
for r in rows:
    if not r['pass']: print('  FAIL', r['test'], json.dumps(r['detail'])[:220])
sys.exit(1 if d.get('fail') else 0)
" || FAILED=1
done
echo "=== logs ==="
node tools/playtest.mjs logs
kill $WD 2>/dev/null
[ $FAILED -eq 0 ] && echo "=== ALL GREEN ===" || echo "=== FAILURES ABOVE ==="
exit $FAILED
