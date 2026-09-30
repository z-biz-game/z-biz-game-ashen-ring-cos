'use strict';
/*
 * service worker 注册。单独一个文件、单独一个 <script>，不动 js/main.js 那棵模块树。
 *
 * 三条提前返回都是必要的，不是装饰：
 *  - file:// —— 双击 index.html 或 Electron 打包直开时，navigator.serviceWorker 在
 *    非安全上下文里根本不存在，register() 会抛一个未捕获的 SecurityError 把控制台
 *    染红。这里直接跳过，不 try/catch 掩盖。
 *  - 没有 serviceWorker（老浏览器、隐私模式、Firefox 的某些配置）。
 *  - 非安全上下文（http:// 且不是 localhost）：Chrome 会拒绝注册，抛错同样没人接。
 *
 * './sw.js' 是相对文档解析的，所以 Pages 的 /z-biz-game-ashen-ring-cos/ 前缀形态和
 * server.cjs 的根形态用的是同一行代码 —— 写死 '/sw.js' 会在前缀部署下 404。
 */
(function registerServiceWorker() {
  var loc = self.location;
  if (!loc || loc.protocol === 'file:' || loc.protocol === 'chrome-extension:') return;
  if (!('serviceWorker' in navigator)) return;
  if (self.isSecureContext === false) return;

  function go() {
    try {
      var reg = navigator.serviceWorker.register('./sw.js', { scope: './' });
      // 注册失败在离线调试里太常见（无 https、SW 被禁用、scope 越界），别冒未捕获拒绝
      if (reg && reg.catch) reg.catch(function () {});
    } catch (e) { /* 同上：同步抛出的那一路也要哑掉 */ }
  }

  if (self.document && document.readyState === 'complete') go();
  else self.addEventListener('load', go, { once: true });
}());
