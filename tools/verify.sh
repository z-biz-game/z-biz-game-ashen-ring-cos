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
( sleep ${WD_TIMEOUT:-420}; cleanup ) </dev/null >/dev/null 2>&1 & WD=$!

# A fresh --user-data-dir binds DevTools noticeably later than a warm profile,
# so wait on the endpoint rather than guessing a sleep duration.
for i in $(seq 1 60); do
  curl -fsS -m 1 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS -m 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 || {
  echo "devtools never bound on :$PORT" >&2; exit 3; }

export CDP_PORT=$PORT
export BASE_URL=$BASE
cd "$HERE"
node tools/playtest.mjs open "$BASE" | head -3
# The scenarios read window.ashen directly, and the driver only waits 2.2 s after
# navigating — enough for a local server, not for a CDN serving 750 KB of vendor.
BOOT=""
for i in $(seq 1 60); do
  BOOT=$(node tools/playtest.mjs eval "window.ashen?window.ashen.state:'nope'" nonav 2>/dev/null | tr -d '\n" ')
  case "$BOOT" in *nope*|"") sleep 0.5 ;; *) break ;; esac
done
echo "boot state: $BOOT"
[ "$BOOT" = "nope" ] && { echo "window.ashen never appeared at $BASE" >&2; exit 4; }
# The loop skips frames on a hidden page (by design) and headless reports hidden.
node tools/playtest.mjs eval "Object.defineProperty(document,'hidden',{get:()=>false,configurable:true});Object.defineProperty(document,'visibilityState',{get:()=>'visible',configurable:true});'visible'" nonav >/dev/null 2>&1
FAILED=0
# SCENARIOS="save run" tools/verify.sh   → iterate on a subset.
# The balance rig is a tuning instrument, not a per-commit gate: it runs ~150
# CPU-only duels, so it stays out of the default set. Run it with
#   SCENARIOS=balance tools/verify.sh
# and BAL_FAST=1 in front of that for a ~15-duel smoke pass while editing the rig.
[ -n "${BAL_FAST:-}" ] && node tools/playtest.mjs eval "window.__balFast=1" nonav >/dev/null 2>&1
for s in ${SCENARIOS:-combat spell save run}; do
  echo "=== @$s ==="
  node tools/playtest.mjs eval "@$s" nonav 2>&1 | python3 -c "
import sys,json,re
raw=sys.stdin.read()
m=re.search(r'\{.*\}', raw, re.S)
if not m: print('NO RESULT', raw[-300:]); sys.exit(1)
d=json.loads(m.group(0))
rows=d.get('rows',[])
print('rows:',len(rows),'fail:',d.get('fail'))
tb=d.get('table')
if tb:
    print('  %-7s %-2s %-8s %-17s %-15s %5s %5s %5s %5s %6s %6s %6s %5s' % ('kind','dp','skill','relic','pack','win%','sur%','attr','ttk','dealt','took','drink','starv'))
    def row(r, kind=None):
        print('  %-7s %-2s %-8s %-17s %-15s %5.0f %5.0f %6.2f %5.1f %6d %6d %6.1f %5.1f%s' % (kind or r['kind'], r['depth'], r['skill'], r['relic'], r.get('pack',''), r['winRate']*100, r['surviveRate']*100, r['attr'], r['ttk'], r['dealt'], r['took'], r['drank'], r['starved'], ' TIMEOUT' if r['timeouts'] else ''))
    for r in tb: row(r)
    for r in d.get('bosses',[]): row(r, 'BOSS')
    if d.get('bossGreen'): row(d['bossGreen'], 'BOSS')
    dp=d.get('dps')
    if dp:
        base=dp[0]['dps'] or 1
        print('  damage meter, 12s on an invincible dummy (baseline %s dps):' % base)
        for r in dp:
            print('  %-17s %6.1f %6.2fx  swings=%d starved=%.1fs' % (r['relic'], r['dps'], r['dps']/base, r['swings'], r['starved']))
    print('  duels:',d.get('duels'))
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
