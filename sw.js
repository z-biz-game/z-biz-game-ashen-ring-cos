'use strict';
/*
 * 离线可用，但**绝不 cache-first**。
 *
 * 这个仓没有构建步骤：index.html 直接 <script type="module" src="./js/main.js">，
 * js/ 下 20 个 ES 模块靠 importmap 解析 three。一旦把 js/*.js 做成 cache-first +
 * 手工 VERSION 号，就等于把整棵模块树钉死在缓存里 —— 忘了 bump 就是"新 HTML 配旧
 * JS"的鬼状态，而且因为缓存命中是同步的，你在屏幕上看到的行为和仓库里的代码不是
 * 同一份，这种 bug 查起来最费时间。
 *
 * 所以：同源 GET 一律网络优先，命中网络就顺手回填缓存；只有网络真的失败（断网、
 * 地铁、飞机模式）才退回到上次成功抓取的那份。导航请求额外兜一层缓存里的 index.html，
 * 让离线第二次打开不白屏。CACHE 名带版本号，activate 时清掉所有旧版本桶。
 */
const VERSION = 'ashen-ring-v1';
const NAV_FALLBACK = './index.html';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && (res.type === 'basic' || res.type === 'default')) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req, { ignoreSearch: false });
        if (hit) return hit;
        if (req.mode === 'navigate') {
          const nav = (await caches.match(NAV_FALLBACK)) || (await caches.match('./'));
          if (nav) return nav;
        }
        return Response.error();
      })
  );
});
