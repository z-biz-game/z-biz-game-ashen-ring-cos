# 灰烬王冠 · Ashen Ring

> *环已碎，王冠仍在燃烧。向下走，把它一片片捡回来。*

浏览器原生的 **3D 魂系肉鸽（Souls-like Roguelike）**：无构建步骤、无打包器、**无任何美术与音频文件**——
地城、敌人、首领、圣物、音效、后期滤镜全部由代码在运行时生成。

- 引擎：Three.js `0.170`（`vendor/` 内置，import map 解析，离线可跑）
- 规模：20 个 ES Module / 约 6.7k 行 JS / 1 个 CSS / 1 个 HTML
- 玩法：营火轮回 · 无敌帧翻滚 · 完美弹反 · 雾门首领 · 圣物三选一 · 灰烬印记永久成长
- **在线试玩**：<https://z-biz-game.github.io/z-biz-game-ashen-ring-cos/>（`main` 分支推送即自动部署）

---

## 快速开始

本地跑：

```bash
npm install          # 只有 three 与 electron（devDependency）
npm start            # → http://127.0.0.1:5173
```

```bash
npm run dev          # 指定端口：node server.cjs 5173
npm run check        # 逐文件 node --check 语法门禁
npm run verify       # 无头浏览器跑 92 项运行时断言（需本机 Chrome）
npm run electron     # 桌面壳启动（electron/main.cjs）
```

需要 Chrome / Edge / Safari 的 WebGL2 + WebAudio；推荐键盘 + 鼠标，支持手柄（Gamepad API）。

---

## 核心循环 / The Loop

```
营火（加点·休息） → 程序化房间 ×N（清怪开启传送） → 雾门 → 首领战 → 下潜下一层
        ↑                                                    ↓
        └────────── 灰烬印记：永久圣堂强化 ←── 死亡：灰烬散落，留下血印 ──────────┘
```

- **一层 6→8 间**：第一层 6 间、第二层 7 间、第三层 8 间，一次完整通关 21 间。
- **死亡不是终点**：灰烬（rune）掉在原地并形成血印，回到那一间取回；取回前再次死亡则旧血印消失。
- **营火（grace）**：休息回满血与专注，但复活所有普通敌人；营火位置同时是本层的存档点。
- **肉鸽快照**：中途关页面会从 `localStorage` 的 run 快照恢复（层数、房间、圣物、灰烬）。

---

## 战斗 / Combat

| 键位 | 动作 | 说明 |
| --- | --- | --- |
| `W A S D` / 方向键 | 移动 | 相对镜头 |
| 鼠标 / 右摇杆 | 转视角 | `Esc` 释放指针，支持反转 Y |
| `J` / 左键 | 轻击 | 四段连击，输入缓冲 |
| `K` / RT | 重击 | 破韧、起手长、可打断敌人 |
| `L` / `Shift` | 格挡 | 消耗体力，耗尽触发**架势崩溃** |
| `U` / X | 弹反 | 0.19s 完美窗口（冷却 0.62s），成功使敌人硬直并可背刺 |
| `Space` | 翻滚 | 无敌帧 0.30s（圣物可延长，上限 0.62s），消耗体力 |
| `C` | 跳跃 | 越过矮墙与废墟 |
| `Q` / `Tab` | 锁定 | 过肩镜头，自动保持目标在画面中 |
| `F` / `E` | 交互 | 营火、雾门、匣子、圣坛、血印、传送 |
| `R` | 原素瓶 | 治疗，消耗充能 |
| `G` | 灰烬召唤 | 分身吸引仇恨（`game.taunt`） |
| `1` `2` `3` | 法术 | 焰牙（弹道）/ 魂斩（波）/ 刃环（新星），消耗专注 FP |
| `T` | 重掷 | 圣物三选一时更换候选（消耗一次） |
| `H` | 疾跑 | 消耗体力，镜头拉远并加 FOV |

**敌人可读性**：所有攻击都有 `windup` 预警动作与音效；`super: true` 的大体型招式无法被格挡硬吃，必须翻滚。
**韧性/硬直**：伤害附带 poise 值，累积超过阈值触发 stagger，是重武器与法术的战术价值来源。

### 体力经济 / Stamina

消耗在动作起手时一次性扣除，回复按状态分档：静止 `44/s`，动作锁定期间 `×0.46 = 20.2/s`，
格挡 `×0.28`，疾跑期间为 0 并持续掉 `dodgeCost`。**动作锁定包含翻滚**——否则 0.5s 的翻滚会把自己
那 20 点回满，闪避变成免费。

以灰烬骑士（上限 105）为例，`净耗 = 消耗 − 动作时长 × 20.2`：

| 动作 | 时长 | 面板消耗 | 净耗 | 满气可做 |
| --- | --- | --- | --- | --- |
| 轻击 L1 | 0.52s | 16 | 5.5 | 19 次 |
| 完整四连 | 2.59s | 64 | 11.7 | 9 轮 |
| 重击 | 1.09s | 30 | 7.9 | 13 次 |
| 翻滚 | 0.50s | 20 | 9.9 | 10 次 |

空档回满：静止 2.4s，动作中 5.2s。所以真正的惩罚不是「打完一套没气」，而是**在锁定回复里贪最后一刀**。

---

## 内容清单 / Content

| 类别 | 数量 | 明细 |
| --- | --- | --- |
| 职业 | 5 | 灰烬骑士 · 燔火主教 · 帷影剑客 · 空刃 · 烬中先知 |
| 敌人原型 | 6 | 空壳游魂 · 誓灰骑士（持盾）· 破誓弓手 · 灰烬怨灵（浮空）· 残树守卫（大型）· 燃血狂信者（治疗） |
| 首领 | 3 | 灰烬守门人 · 双面忏悔者 · 灰烬王「环中无名者」（血量 620 / 840 / 1250，均含二阶段） |
| 首领招式 | 6 | 横祭 · 裂地 · 贯誓 · 灰雨 · 环焰 · 唤灵 |
| 圣物 | 34 | 4 稀有度（common / rare / legendary / cursed），5 件传说圣物，8 个标签体系 |
| 诅咒 | 5 | 高风险高回报的负向圣物 |
| 圣堂强化 | 10 | 用灰烬印记永久提升，等级递增计费 |
| 深度 | 3 | 每层独立色调、雾密度、敌人属性倍率与房间数 |

房间类型：`chapel`（营火厅）· `combat` · `court`（庭院）· `cache`（宝库）· `shrine`（圣坛）· `cross`（十字回廊）· `boss`（雾门竞技场）。

---

## 架构 / Architecture

```
index.html            import map + HUD/DOM 骨架
server.cjs            零依赖静态服务器（127.0.0.1:5173）
electron/main.cjs     桌面壳：起临时端口服务器再加载同一份 index.html
css/hud.css           全部 UI：血条、圣物卡、圣堂、结算、伤害数字
js/
├── main.js           Game 状态机：run / enterRoom / step / interact / 结算
├── engine/
│   ├── view.js       渲染器、光照、粒子池、灯光池、后期链、画质预设
│   ├── camera.js     过肩锁定镜头、遮挡推挤、FOV 冲击
│   ├── input.js      键位绑定表 + 手柄映射/重映射/震动 + 指针锁定
│   ├── audio.js      程序化合成：4 种振荡器、3 种滤波器、35 个音效、动态层叠 BGM
│   └── rng.js        可复现随机（hashSeed / fork）、damp、值噪声
├── world/
│   ├── layout.js     楼层规划 planDepth + 网格地城生成 buildRoomGrid
│   ├── grid.js       单元格碰撞、台阶、支撑、视线投射
│   ├── texture.js    程序化 PBR 贴图工厂（albedo/normal/roughness，无缝、零素材）
│   └── build.js      把网格实例化成 THREE.Group（墙/柱/废墟/雾门/营火/匣子）
├── entities/
│   ├── player.js     动作状态机、体力/FP、连击、弹反、法术
│   ├── enemy.js      6 原型 AI + 灰烬召唤物
│   ├── boss.js       招式表、阶段切换、雾门后生成
│   └── parts.js      人形拼装（盔/甲/武器），无模型文件
├── combat/hit.js     判定、伤害公式、范围伤害、掉落与拾取
├── ui/
│   ├── hud.js        Canvas 小地图、伤害数字、横幅、提示
│   └── hub.js        圣堂、职业选择、圣物草稿、设置
└── meta/
    ├── content.js    圣物 / 诅咒 / 职业 / 圣堂强化 / 深度修正 数据表
    ├── stats.js      属性聚合（基础 + 职业 + 圣物 + 强化）
    └── save.js       localStorage 存档与 run 快照
vendor/
├── three.module.js   Three.js 0.170
└── jsm/…             postprocessing + shaders（EffectComposer / UnrealBloom / OutputPass）
tools/
├── playtest.mjs      CDP 驱动：92 项运行时断言（@combat / @spell / @run）
└── verify.sh         一次性验证：真实 GPU + trap/看门狗收尾
```

**状态机**：`title → hub → playing ⇄ (draft | grace | pause) → dying → win|lose`。
`step(dt)` 只在 `playing` 下推进；`hitStop` / `slowMo` 通过缩放 `dt` 实现顿帧与慢动作，不复制逻辑。

---

## 渲染 / Rendering

```
RenderPass → UnrealBloomPass → GradeShader → OutputPass(ACES)
```

- HDR 半浮点中间目标，线性空间合成，最后由 `OutputPass` 做 ACES 色调映射（曝光 1.12）。
- 自定义 `GradeShader`：边缘色散、按亮度分离的钢蓝阴影→余烬高光双色调、去饱和、暗角、随时间抖动的高光颗粒。
- **粒子**：两个 `Points` 缓冲池（火花 / 烟尘），紧凑 swap-remove + `setDrawRange`，只上传存活区间。
- **灯光**：点光源池常驻且始终可见——切换 `light.visible` 会触发全部材质重编译，实测程序数从 18 涨到 32；改为 `intensity = 0` 后消除。
- **手持余烬（torch）**：跟随玩家的点光源。房间是自遮挡的封闭体，没有它远处墙角直接糊成纯黑。
- **太阳**：正交阴影视锥跟随镜头而非房间中心，避免角色走到边缘时脱离阴影范围。

| 预设 | 像素比 | 阴影 | Bloom | 粒子上限 | 灯光预算 | 余烬 |
| --- | --- | --- | --- | --- | --- | --- |
| low | 1.0 | 关 | 关 | 45% | 4 | 9 |
| medium | 1.35 | 1024 | 0.42 | 75% | 7 | 12 |
| high | 1.75 | 2048 | 0.68 | 100% | 7 | 13 |

设置面板即时切换，包括阴影贴图分辨率（切换时 `map.dispose()` 重建）。

---

## 程序化音频 / Audio

`js/engine/audio.js`，256 行，**零音频文件**。所有音效由振荡器 + 滤波器 + 噪声缓冲合成：
打击、挥砍、弹反金属声、雾门低鸣、营火、首领践踏等 35 个 cue；BGM 按状态分层（探索 / 战斗 / 首领 / 死亡 / 胜利），
用 `nextBeat` 网格推进，切歌不产生爆音（统一 master gain + ramp）。

---

## 性能实测 / Measured

用 CDP 探针在 **真实 GPU**（headless Chrome 走 Metal/ANGLE，不加 `--use-angle=swiftshader`）下、
760×460 视口、`medium` 预设实测。后处理链会让 `renderer.info` 只报最后一个 pass，
所以取数时必须 `info.autoReset = false` + `info.reset()`，跑 N 帧再除以 N（这里 N = 6）。

| 指标 | 实测（连续过 5 个房间） |
| --- | --- |
| draw calls / 帧 | 217–400 |
| 三角形 / 帧 | 29.6k–55.4k |
| geometries | 50 → 70 → 83 → 76 → 80（有界，不单调增长，无泄漏） |
| textures | 29（恒定：程序化贴图按 kind 缓存，跨房间复用） |
| material programs | 30–33（不随房间增长） |
| JS heap | 27.8 MB（过 5 个房间后） |

地面/墙体/废墟都是 `InstancedMesh`，调用数由**材质与几何种类**决定而不是实例数；
阴影 pass 约占总调用数的三分之一（房间里绝大多数物件都投影）。

---

## 程序化美术 / Procedural art

**仓库里没有任何二进制素材**——贴图与模型都是代码生成的。

`js/world/texture.js` 用 Canvas 合成 PBR 三件套（albedo / normal / roughness）：

- 高度场优先：先算 `h`，再由**同一个**高度场跑 wrap-around Sobel 出法线图，保证凹凸与颜色永远对得上。
- 周期化值噪声：格点整数坐标按 `period` 取模后再 hash，因此 `RepeatWrapping` 下**严格无缝**，不需要镜像贴图作弊。
- 四种石材各有自己的砌法：地面 3×3 板石 + 裂纹 + 磨损；墙面 2×3 错缝（running bond，奇数行偏移半块）+ 雨水挂污；
  柱身 14 道凹槽（`cos(u·2π·14)`）分 5 节；黑曜石为断口面 + 金脉。
- 砖缝、灰尘、苔痕都是从高度场派生的遮罩（`recess` / `dust` / `bio`），而不是画上去的独立图层。
- 符文印记用矢量路径绘制（`runeTexture`），任意尺寸都保持锐利。

`js/world/build.js` 把方块基元换成真正的雕饰：`LatheGeometry` 车出带柱础柱头的凹槽柱、
半圆 `TorusGeometry` 做拱、8 点轮廓车出火盆、链节用交替 90° 旋转的 torus 实例串起来、
墓碑用 `Shape` + `ExtrudeGeometry` 带倒角挤出、废墟改用二十面体而不是方块。

一个反复踩到的坑：PBR 的取值链是 `material.color × instanceColor × albedoMap`，
三者相乘，所以任何一环偏暗都会把整面墙压黑。现在 albedo 图独自承担明度（`lit = 0.72 + 0.5·h`），
材质色与实例色都留在近白区间，色调只作为 0.16 权重的色相提示叠加。

---

## 测试 / Testing

无第三方测试框架。用 Node 原生 `WebSocket` 直连 Chrome DevTools Protocol 驱动真实页面，
驱动脚本在仓库里（`tools/playtest.mjs`）：

```bash
npm start &          # 另一终端：静态服务器
npm run verify       # tools/verify.sh：@combat(22) + @spell(8) + @run(62) = 92 项断言
```

手工分步：

```bash
# 注意：不要加 --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader。
# 软件光栅会吃满约 10 个核，且没有 CDP 客户端时它也不会自己停。
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --headless=new --remote-debugging-port=9334 --window-size=820,620 about:blank &
CDP_PORT=9334 node tools/playtest.mjs open http://127.0.0.1:5173/
CDP_PORT=9334 node tools/playtest.mjs eval "@combat"   # 22 项战斗断言
CDP_PORT=9334 node tools/playtest.mjs eval "@spell"    # 8 项法术 / 召唤 / 弹道
CDP_PORT=9334 node tools/playtest.mjs eval "@run"      # 62 项三层通关流程

# 打线上而不是本地：BASE_URL 决定 attach 哪个标签页
BASE_URL=https://z-biz-game.github.io/z-biz-game-ashen-ring-cos/ npm run verify
```

断言直接读取运行时对象（`player.state`、`enemies[].hp`、`run.runes`），而不是比对截图。
驱动脚本必须用 `trap cleanup EXIT` + 看门狗进程收尾，并且要先把 `document.hidden` 覆写成 `false`——
主循环在隐藏页会直接跳帧（这是有意的：没人看的时候不该烧 GPU），但无头环境会误报隐藏。
看门狗子进程要重定向掉自己的 fd：它继承了脚本的 stdout，如果脚本跑在管道里，
它会在超时前一直占住写端，测试早就结束了下游却读不到 EOF（`tools/verify.sh` 里踩过）。


---

## 许可 / License

MIT © z-biz-game
