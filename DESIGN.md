# 设计文档 · Ashen Ring

面向维护者的技术说明：为什么这样实现、哪些约束不能破坏、踩过的坑写在哪。
玩法与内容清单见 [README.md](README.md)。

---

## 1. 技术选型：为什么是浏览器 + Three.js

魂系手感 = **帧级判定 + 镜头 + 反馈**，与引擎品牌无关。真正决定选型的是三条约束：

1. **可验证性**。代理写代码的前提是能自己跑起来看。浏览器 + CDP 让「启动 → 注入输入 → 读取运行时对象 → 断言」成为一条命令的事；
   换成 Godot/Unity，需要额外的 headless runner、场景序列化、截图比对，反馈环从秒级掉到分钟级。
2. **零安装分发**。`npm start` 或直接双击 `index.html`（配合 `server.cjs`）就能玩；Electron 只是同一份代码的壳。
3. **视觉上限够用**。本作的表现力瓶颈在**光照分层、后期滤镜、动作反馈**，而不是几何精度或材质库，Three.js + 自建后期链完全覆盖。

**什么时候应该换引擎**（触发任一条件即重新评估）：
- 目标变成 Steam / 主机发行，需要原生存档、成就、手柄强制策略；
- 引入人工制作的模型/动画资产（glTF 蒙皮 + Avatar Mask 的动画混合树超出本作的程序化拼装能力）；
- 联网合作 / PVP，需要确定性回滚与服务器权威状态。

代价说清楚：没有物理引擎、没有动画状态机编辑器、没有场景编辑器，**碰撞、动作状态机、地城生成、音频合成、后期滤镜全部自建**。
本仓库约 6.3k 行里有相当比例是在补引擎自带的能力，这是选择的成本，不是缺陷。

---

## 2. 全局约定（破坏即出 bug）

### 2.1 朝向与 yaw
```
forward = (sin yaw, cos yaw)      yaw = 0 → +Z,  yaw = π/2 → +X
```
镜头位于 `focus + (sin rigYaw, cos rigYaw) · dist`，因此**要落在角色背后必须 `rigYaw = playerYaw + π`**。
房间入口的朝向来自 `layout.entry.yaw`（门洞沿 X 轴，西→东，所以是 `π/2`）；
`enterRoom` 里任何硬编码的 yaw/rigYaw 都会让镜头在进门瞬间横过来并被墙推进角色身体。

### 2.2 单一时间源
`Game.loop(ts)` 是全游戏唯一的推进入口，`dt` 只在这里计算一次：
```js
const d = (ts - this._last) / 1000;
const raw = Math.min(0.048, d > 0 ? d : 0.016);
```
- **`d > 0` 的下界不是防御性代码，是必需的**：`damp()` 的实现是 `cur + (target-cur) * (1 - exp(-λ·dt))`，
  传入负 `dt` 时 `exp` 的指数为正，系数变成负且绝对值可以远大于 1，逐帧复利放大。
  实测镜头 Y 在几十个坏帧后到达 `1.4e35`。任何「手动驱动帧」的调试代码都可能制造负增量。
- 顿帧与慢动作通过缩放 `dt`（`hitStopT → dt*0.09`、`slowT → dt*0.4`）实现，**不复制一份逻辑**，
  所以所有系统必须只依赖传入的 `dt`，不允许自己读 `performance.now()`。

### 2.3 网格与碰撞
`world/grid.js` 是唯一的物理真相。单元格类型与其顶面高度：

| CELL | top | SOLID | 说明 |
| --- | --- | --- | --- |
| FLOOR | 0 | 否 | |
| WALL | 4.6 | 是 | 不可通行，镜头会被推高 |
| PILLAR | 4.1 | 是 | 含雾门封锁格 |
| RUBBLE | 0.5 | 是 | 低于 `STEP`，可走过 |
| LOWWALL | 1.15 | 是 | 高于 `STEP`，需跳跃或绕行 |

`STEP = 0.6`：**「实心」的判定是 `top - footY > STEP`，不是「是否 SOLID」**。
所以矮墙不会挡住镜头探针（`solidAtWorld` 走的是同一套规则），这是有意为之——
否则过肩镜头会被脚边的碎砖顶飞。想要「能踩上去」就调 `top`，不要往 `blocked()` 里塞特例。

`blocked(x, z, r, footY)` 用「点到单元格 AABB 的最近点」做圆-矩形检测，而不是逐格全阻挡，
因此贴墙滑行是平滑的；`support()` 同理给出可站立高度。

### 2.4 地城生成的三条硬约束
`layout.buildRoomGrid` 之后：
1. **门洞行必须干净**：入口/出口所在行（`doorRow`）在 `cx < 4 || cx > w-5` 的范围内不得出现 RUBBLE / LOWWALL，
   否则角色一出生就站在一块石头上，镜头也没有退让空间。
2. **雾门必须内缩**：`layout.gate` 是雾门唯一的坐标来源（网格封锁、mesh 位置、交互锚点三处共用）。
   它内缩 `2.7` 格，用来给玩家一段「走向雾门」的构图距离。
   把三处坐标各自写死会让封锁格与可见雾门错位。
3. **入口要有退让距离**：`enterRoom` 会沿 `+X` 试探性前推最多 2.4 单位（用 `grid.blocked` 校验），
   使镜头至少有 ~3.5 单位 standoff。出生点紧贴边界墙时，`heightAtWorld` 会把镜头抬到 4.6 以上，形成俯视镜头。

### 2.5 渲染层的两条不变量
1. **不要切换 `light.visible`**。会改变场景光照集合，Three.js 会对**所有**已编译材质重建 shader program。
   实测每次换房做灯光轮换，program 数从 18 → 22 → 32 持续增长。灯光池因此常驻可见，只把 `intensity` 置 0。
2. **中间目标必须是半浮点线性空间**，ACES 只由链尾的 `OutputPass` 做一次。
   任何在 `GradeShader` 里再次做色调映射的改动都会导致高光死白。

### 2.6 粒子池
`ParticlePool` 采用紧凑 swap-remove：存活区间 `[0, live)`，只上传 `live` 段
（`setDrawRange` + `addUpdateRange(0, live*3)`）。回收时把末尾元素整体拷到空洞位置。
新增字段必须同时改三处：`emit`、`_recycle` 的字段拷贝表、`clear` 的归零。漏掉 `_recycle` 会出现「幽灵粒子」。

---

## 3. 战斗判定

- **状态机优先于动画**：`player.state ∈ idle/run/attack/roll/block/parry/heavy/cast/hurt/dead`，
  `busy` 由状态决定，`canAct` 是唯一的输入闸门。所有「手感」参数集中在 `meta/stats.js` 的默认属性里
  （`lightCost / heavyCost / rollCost / iframe / attackSpeed`），圣物只做乘加修正，不改结构。
- **无敌帧**：`iFrameT` 在 `takeDamage` 前检查，且弹反/落地会额外授予短暂无敌（`iFrameT = max(iFrameT, 0.22)`）。
- **弹反**：`parryT = 0.19s`，冷却 `0.62s`。法术与坠落伤害显式绕过弹反（`info.magic / info.fall`），
  因为「用脸接火球」不该产生弹反窗口。
- **背刺**：判定条件包含「目标未察觉」与「攻击方向落在目标背后扇区」，倍率走独立分支，不共享暴击路径。
- **韧性**：伤害附带 `poise`，超过阈值进入 `stagger`，`vulnerableUntil` 提供增伤窗口。大型敌人（`super: true`）
  的招式无法格挡硬吃。
- **输入缓冲**：连击窗口内按下会写入 `buffered`，当前段结束立即续接，这是「按得快 = 打得顺」的来源。

---

## 4. 镜头

`engine/camera.js` 的优先级：锁定 > 遮挡推挤 > 跟随。

- 锁定（`lockBlend`）把 `yaw` 缓动到「目标→玩家」连线的反方向，只有角度差小于 0.22 rad 时才回写 `this.yaw`，
  避免目标绕到背后时镜头瞬跳。
- 遮挡用 `_clearDistance` 沿镜头方向步进 0.22 采样 `grid.solidAtWorld`，命中即把 `dist` 压到 `max(2.1, d-0.4)`。
  **2.1 是下限，不是「贴脸」**：低于该值镜头会进入角色头部体积，画面被后脑勺占满。
- 镜头高度用 `heightAtWorld + 0.45` 抬升，让镜头翻越墙体而不是穿墙；配合 2.4 的入口退让，才不会在门口变成俯视。
- FOV 随冲刺/慢放/打击冲击叠加，`fovPunch` 每帧衰减。

---

## 5. 肉鸽结构

- **一切从种子派生**：`hashSeed(seedStr)` → `RNG.fork()` 出每层、每房间的独立流；
  `plans[d]` 决定房间序列，`hashSeed(seed:depth:roomIdx)` 决定单房间布局与刷怪。
  因此「同一 seed 同一路线」可完全复现，测试也依赖这一点。
- **房间推进**：`roomCleared` → `portalOpen`；`boss` 房间额外受雾门（`gate`）控制。
- **死亡经济**：死亡时灰烬掉落在原地并写 `run.bloodstain`，回同一房间重生血印；取回前再死一次则旧血印作废。
  血印的吸附半径刻意只有 0.75（普通拾取更大），取回是一次**有意的动作**而不是路过。
- **印记结算**：`bossKills*4 + 通关 14 + roomsCleared/3 + depth*2`，用于 `meta/content.js` 的 10 项圣堂强化（等级递增计费）。
- **快照**：`localStorage` 两个键，`ashen_ring_save_v1`（永久进度）与 `ashen_ring_run_v1`（中途 run）。
  所有读写包 `try/catch`，隐私模式下静默降级为「本局有效」。

---

## 6. 无资产策略

| 资源 | 做法 |
| --- | --- |
| 模型 | `entities/parts.js` 用盒/圆柱/环拼装人形（头盔形状、甲片、武器类型），按原型配色；`world/build.js` 用车削（`LatheGeometry`）、挤出（`ExtrudeGeometry` 带倒角）、半环面与二十面体雕出柱/拱/火盆/墓碑/链节/废墟 |
| 贴图 | `world/texture.js` 运行时生成 PBR 三件套：先出高度场，再由同一高度场跑 wrap Sobel 得法线，配合粗糙度图。周期化值噪声保证 `RepeatWrapping` 下严格无缝；符文用矢量路径绘制 |
| 动画 | 逐帧程序化姿态（挥砍弧线、行走摆动、受击后仰），无骨骼、无 glTF |
| 音频 | `engine/audio.js`：振荡器 + 双二阶滤波 + 噪声缓冲，35 个 cue + 分层 BGM |
| 字体/图标 | 系统字体 + CSS，无图标文件 |

好处：仓库不含任何二进制素材，首屏无网络请求，离线可玩。
代价：所有「美术」都是代码，调外观要改逻辑。

---

## 7. 测试策略

`/tmp/ashen-cdp.mjs`（开发期工具，未纳入仓库）通过 Chrome DevTools Protocol 直连真实页面，
断言直接读取运行时对象而不是比对像素。

**关键教训：测试驱动必须与渲染帧率解耦。**
软件光栅下只有 ~10 fps，早期 harness 用 `setTimeout(80ms)` 模拟按键时长，
在 10 fps 下这 80ms 可能**一个帧都不包含**，于是 19 项断言里 12 项「失败」——全是假阳性。
现在的 `wait(ms)` 会把模拟时间确定性地推进（每 16ms 调用一次 `Game.loop`），并临时把 `view.render` 置空，
断言只依赖推进后的状态。任何新增场景都必须复用这个 `wait`，不要退回 `setTimeout`。

**第二条教训：不要用软件光栅跑验证。**
`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` 会让一个 GPU 辅助进程吃满约 10 个核，
而没有 CDP 客户端连着时它不会自行停止。驱动脚本必须：只启动真实 GPU 会话、小视口、
`trap cleanup EXIT` 按 PID 与端口双杀、外加一个看门狗 `sleep` 兜底。
主循环现在会在 `document.hidden` 时跳帧（没人看就不该烧 GPU），因此 harness 还要把
`document.hidden` / `visibilityState` 覆写成可见，否则整个会话一帧都不推进。

绝对帧率在 headless 下没有意义，因此性能只看结构指标：
`renderer.info` 的 calls / triangles / geometries / textures 与 JS heap。
两个坑：后处理链会让 `info` 只反映最后一个 pass，必须 `info.autoReset = false` + `reset()` 再按 N 帧取平均；
geometries 是否随换房单调增长才是判断泄漏的信号（实测 5 个房间 50 → 70 → 83 → 76 → 80，有界）。

---

## 8. 已知取舍与后续

- **共享材质缓存**：`world/build.js` 目前每房间新建材质。实测 217–400 draw calls 里，调用数由几何/材质**种类**决定，
  同类物件已经走 `InstancedMesh` 合并；材质是每房间少量、退出时随 `owned` 一并 dispose，堆内存 5 个房间后仍稳定在 27.8 MB。
  也就是说跨房间共享材质能省的是分配开销而不是 draw call，而分配开销已经不是瓶颈——记录在案，不做。
- **阴影投射体**：房间内 94/99 个 mesh 投影，阴影 pass 约占 ~249 次调用中的 83 次。真正该裁的是地面，
  但在 60 fps 的实机余量下这是视觉回归风险换 8 次调用的买卖——同样不做。
- **雾门后的过场**：入雾只有音效 + 粒子 + 横幅，没有镜头演出。
- **手柄**：映射已接好（`input.js` 的 `PAD` 表），但没有重映射 UI 与震动。
- **动画**：程序化姿态在长武器上偶有穿模；根治需要骨骼或 IK，属于换引擎的触发条件之一。
- **平衡**：三层的敌人倍率（1.00/1.22/1.50 血量）与圣物强度是手工拍的，缺少自动化通关率统计。
