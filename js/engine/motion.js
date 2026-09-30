// prefers-reduced-motion 的唯一读口。
//
// 为什么要单独一个模块而不是各处各写一次 matchMedia：这个开关要在三个地方被消费
// （粒子上屏、镜头抖动、标题环绕运镜），而且它**会在运行时被改** —— 系统设置里关掉
// 动效不该要求刷新页面。所以这里挂一次 listener，把状态镜像到一个布尔上。
//
// 注意 `matchMedia` 本身在老 Safari / 非浏览器环境里可能不存在，也可能存在但
// addEventListener 是老的 addListener。两条都探一次，探不到就退化成"不动效"，
// 因为对这个开关来说，误判成"要减少动效"只是画面朴素一点，误判成"随便动"是有人
// 会晕。宁可错杀。
const q = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  let m = null;
  try { m = window.matchMedia('(prefers-reduced-motion: reduce)'); } catch { return true; }
  return !m || !!m.matches;
};

export const REDUCED_MOTION = { value: q() };

if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  try {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = (e) => { REDUCED_MOTION.value = !!(e && e.matches); };
    if (typeof m.addEventListener === 'function') m.addEventListener('change', on);
    else if (typeof m.addListener === 'function') m.addListener(on);
  } catch { /* 保持初值 */ }
}

export function prefersReducedMotion() { return REDUCED_MOTION.value; }
export function setReducedMotion(on) { REDUCED_MOTION.value = !!on; }
