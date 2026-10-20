# Changelog

站点版本记录。提交信息沿用既有规则：

- `update: N` —— 一批功能更新
- `fix: N.M` —— 同一批里的修复

从 `update: 29` 起，每个版本都在这里写清具体改了什么；**此后每次 update/fix 提交都必须在文件顶部追加一条记录**。`update: 16–28` 按 git 历史补录；
`update: 1–15` 是旧站（单文件 `index.html`）时期，早期提交只写了版本号，这里按改动内容
补主要节点。每个条目的日期与 commit 一一对应。

---

## fix: 35.1 — 2026-10-20

### HOURS IN TRANSIT：实测 + 推断通勤
- LIFE 的 **HOURS MOVING → HOURS IN TRANSIT**：不再只算 Dawarich 识别到的
  步行/骑行/开车段；把两次停留之间 **4–180min、相距 ≥1km** 的空档补进来，
  并扣除空档里已识别的 transport 段（地铁/地下没有 GPS 点，原来完全漏掉）。
  8 天示例：实测 3.6h + 推断 14.4h = **约 18.0h**。
- PLACES 的 chips 改为 **TRANSIT / MEASURED / INFERRED / STAYING / MAX SPAN /
  GPS POINTS**；单日详情里的 MOVING 也改成 TRANSIT。
- Worker `location` 字段白名单增加 `inferredMinutes` / `transitMinutes`。
- 旧数据没有新字段时前端回退到 `movingMinutes`。

## update: 35 — 2026-10-20

### LIFE 页：轨迹地图 · 单日详情 · 彩色模式
- **03 PLACES 变成真正的轨迹地图**：从公开的 raw events 里取 location domain
  （track_path / visit / transport / tracked_points），投影成 SVG。停留点按
  ≈100m 聚合、半径按时长，跨天轨迹按日叠画，最近一天加重；带比例尺、指北、
  地名标签与区级/交通方式侧栏。只在面板进入视口前 700px 懒加载，最多 7 天、
  3 并发，模块内缓存 5 分钟；单天失败只少一条轨迹，不拖垮整张图。
  实现在 `app/src/data/lifeGeo.js`，投影与聚合是纯函数。
- **单日详情**：点任意一天的柱子（或聚焦后按 Enter）打开当天快照 ——
  分类时长、步数/心率/跑步、城市/区级停留、手机应用、AI 花费与项目明细。
  Esc / 背景 / CLOSE 关闭，打开时锁 body 滚动，关闭后恢复；详情面板内部
  可滚但不显示右侧滚动条。
- **彩色模式**：hero 里的 `COLOR OFF / ON` 按钮（localStorage 记忆）。
  打开后八个分类各拿一个色相，堆叠柱、图例色块、星期轮廓、单序列柱
  （步数/手机/AI）和地图轨迹同步换色，浅色/深色主题都保持可读。
- **新增 06 WEEKDAY PROFILE**：按星期聚合成“平均每天”的堆叠横条，附
  最忙/最闲/工作占比/样本天数；归档面板顺延为 07。
- 02 MOTION / 04 PHONE / 05 AI 补上悬浮提示、周期均值虚线与键盘焦点
  （之前只有 01 有 tooltip）。
- `tools/verify-life.mjs` 更新：raw 索引/events 打桩（含轨迹、停留、交通），
  断言地图轨迹/停留点/日期切换、彩色模式换色与持久化按钮、单日详情开关
  （点击 + Enter + Esc + body 锁）、星期轮廓、均值线；桌面 / 浅色 /
  reduced-motion / 手机 / 稀疏 / 空 / 失败全部跑通。

## fix: 34.2 — 2026-10-20

### 归档页：去掉重复/缓慢的转场，首屏即时出内容
- `life ↔ life-archive` 在 `router.beforeEach` 里直接跳过整屏转场板子。
  之前从 LIFE 点归档卡、或在归档内切 tab 都会再演一遍 ARCHIVE 板子，
  守卫里 700–900ms 的等待 + 板子 1.5s，看起来既重复又慢。
  **不要**改成组件里的 `@click` + `skipNextPageTransition` —— router-link
  内部 click 与组件 @click 的先后不稳定，可能来不及置位。
- 新增 `data/lifeArchiveCache.js`：会话内缓存 raw index 与文档。LIFE 总览
  已经拉过的索引归档页直接复用；归档 tab/日期悬停时预取默认文档，点下去
  不再等 R2 list + R2 get 两段网络。
- 归档加载态加了明确文案（`Loading archive…` / `Loading JOURNAL…`），
  不再是退场后一块无说明的空白骨架。
- `verify-life-archive.mjs` 增加断言：从 LIFE 点归档卡后 160ms 内
  不得出现 `.transition-panel`，且归档 section 已挂载。

## fix: 34.1 — 2026-10-20

### VAULT：主任务 / 周回顾 / AI 会话
- 归档新增第八个视图 **VAULT**：`vault/04-Tasks/Tasks.md`（主任务清单）、
  `vault/07-Reviews/*.md`（周回顾、成本台账）、`vault/06-AI-Sessions/*.md`
  （每次 AI 会话日志）。Markdown 渲染，任务复选框只读。
- `publish_life_raw.py` 同时发布这些 vault 文档；原始接口新增 `vault` kind
  （id 为安全 slug，`.md` 渲染与日记同一条路径）。
- 归档入口卡片变为 8 张；VAULT 默认选中 MASTER TASKS，按
  主任务 → 周回顾 → 成本台账 → AI 会话排序。

## update: 34 — 2026-10-20

### LIFE 全量归档（/life/archive）
- 新增七个归档视图：JOURNAL（完整日记 Markdown）、NOTES（随手记）、TASKS、
  Q&A、EVENTS（原始事件长表）、BLOCKS（窗口标题/URL/分类时间块）、REVIEWS
  （周总结，有则显示）。日期切换、事件 domain 筛选、META 展开、LOAD MORE。
- LIFE 总览底部新增 **06 THE ARCHIVE** 入口卡片，显示各分区条目数。
- 隐私边界改为「全量」：坐标、轨迹、窗口标题、URL、包名、日记/随手记/问答
  正文全部公开；只有 URL 里像 token/state/code/part 的 query 值、
  `sk-`/`ghp_`/`AKIA` 这类 key、Bearer 头与 `password=...` 被替换成 REDACTED。
  页面顶部与底部都写明了这条边界。

### Worker / 存储
- 新增 `POST /api/life/raw/ingest`（Bearer token）、`GET /api/life/raw/index`、
  `GET /api/life/raw/:kind/:id`。原始数据存 R2 `life/raw/<kind>/<id>.{md,json}`，
  不走 D1（单日事件约 30–50 KB，R2 没有 D1 行大小/SQL 长度限制）。
- 日记由 Worker 用 `marked` + `sanitize-html` 渲染；允许只读任务复选框。
- 鉴权抽成 `lifeAuth()`，聚合与原始写入共用。

### 工具
- 新增 `tools/verify-life-archive.mjs`：七个 tab、日期切换、日记 HTML、
  随手记、任务、问答、事件筛选/分页、BLOCKS、空周总结、手机无溢出、零报错。

## update: 33 — 2026-10-20

### LIFE 页（/life）
- 新增公开 LIFE 页：电脑使用分类、步数/心率/跑步、城市级位置、手机使用、
  AI 花费。数据来自 LifeLogging 每晚发布的脱敏日汇总，前台 60 秒轮询。
- `LifeView.vue` + 路由 / `pageLabels` / 导航项；CSS 复用 STATS 的
  hero / card / panel 骨架，新增分类堆叠柱、7 日滚动均线、区级横条、
  AI 模型/项目双分组。
- 窗口按实际数据跨度显示；中间缺日保留虚线基线，不补空白柱。
- 新增 `tools/verify-life.mjs`：30 列 / 缺日 / 悬浮提示 / 滚动揭示 /
  keep-alive / reduced-motion / 手机 / 稀疏 / 空数据 / 请求失败。

### Worker
- D1 `life_days(day, payload, updated_at)`（`migrations/0003_life.sql`）。
- `GET /api/life?days=30`：公开只读，按天升序返回，30 秒缓存。
- `POST /api/life/ingest`：Bearer token（`LIFE_INGEST_TOKEN`），字段白名单
  校验；未知字段、负步数、Android 包名一律 400。
- 隐私边界：不接受/不返回坐标、轨迹、窗口标题、URL、包名、余额。

## fix: 32.2 — 2026-10-19

### 窗户墙入场焦点居中
- 修复从已滚动页面进入 GALLERY / MY GALLERY 时，首屏焦点窗不在屏幕正中的问题。
  根因是 `prime()` 在 `onActivated` 的 `nextTick` 里早于路由 `scrollBehavior`
  测量墙面，拿到的还是上一页的滚动位置；Windows 上 `innerWidth` 还包含滚动条宽度。
- 居中目标改用 `document.documentElement.clientWidth / clientHeight`；
  测量改到 `requestAnimationFrame`，并在真正开演前再 `reset → prime → play` 一次。
- `GalleryView.vue`、`MeGalleryView.vue`、`useWallEntry.js`；构建时顺带刷新
  `app/src/data/content/blogPosts.json` CMS 快照。

## fix: 32.1 — 2026-10-19

- 桌面端人物整体放大：ME 人物 `min(72vh, 720px, 50vw)`，GALLERY 人物
  `min(66vh, 660px, 48vw)`；FRIENDS 群像保持与卡片同比例，不调整。
- `MeView.vue` 新增 `@media (min-width: 901px)`，手机布局不变。

## update: 32 — 2026-10-19

### ME 页滚动体验
- 开场改为 EXPLORE 门禁：首次进入显示 EXPLORE（自动缓慢巡游）与 SKIP TO CARDS；
  进入后滚动解锁。反复进入 ME 不再弹门禁。
- 「无限纵深」照片隧道：30 张照片各用一张不同图，3D 深度一次性推进 14000px，
  全部飞出镜头后不再循环重置；照片卡片有稳定的 3:4 占位框，加载中/失败不会只剩顶边。
- ME / GALLERY / FRIENDS 三张卡片为三个独立窗口，依次滚入；卡片先飞入、人物随后
  从相反方向进入，滚动 scrub（`top 75% → top 0%`）+ 慢缓动；人物完整显示、不裁剪、
  无边框，蓝/红外套定时交叉切换。
- FRIENDS 群像与卡片同比例 1193×731，右半屏展示，边缘羽化 + 底部渐隐蒙版。
- 左侧悬浮导航：ME / GALLERY / FRIENDS，滚动自动高亮，点击跳转。
- ME 页去掉全局页脚；GitHub Activity 图完整 `contain`、深色模式反相；卡片阴影改为
  带偏移的硬边阴影。
- 新增 `tools/verify-me-scroll.mjs`（门禁、隧道、导航、红蓝切换、无页脚等 20 项断言）。

### 全站
- 首屏 ENTER 下新增 **ENTER WITHOUT MUSIC**：进入时取消首次交互自动起播；
  播放器手动播放仍然可用。

### 素材与工具
- `me/` 重组为 `cutouts/`（蓝/红抠图 + `_selective` 图层）、`personas/`、
  `posters/`、`individuation.jpg`；删除 `hero_compressed/`，引用同步更新。
- 新增 `tools/build-cutouts.mjs`：去白边、压暗轮廓、生成蓝/红 selective 图层；
  `tools/build-personas.mjs` 输出改为语义文件名。
- 红色人物抠图接入，selective 图层按红外套键控。

## update: 31 — 2026-10-18

### 窗户墙
- GALLERY / MY GALLERY 重做为窗户墙：新增 `window-wall.css`、`useWallPuzzle`、
  `useWallMotion`、窗格入场；网格布局、华容道换位、筛选与月份切换。
- 新增 `useThumbnails`：fetch → `createImageBitmap` 缩放 → canvas → blob URL，
  密集网格按可见性加载小图。
- 群组 / 好友照片页并入同一套墙面；移除 `FriendMarquee`、`PhotoTimeline`、
  `FriendDetailView`、`GroupPhotosView` 及对应路由。

### STATS
- `StatsView` 大改：GSAP 入场、逐字标题、数字滚轮、30 天柱线、滚动揭示、
  keep-alive 重播与 reduced-motion；新增 `OdometerNumber` 与 `tools/verify-stats.mjs`。

### 首页 / ME
- `HeroConcept` 与 `main.css` 大量调整；ME 页改为浏览器窗口式叙事，
  引入 `me/hero_compressed/HuangWeiLong_*.webp`。
- 博客 CMS 快照更新。

---

## update: 30 — 2026-10-17

### 音乐资源迁到 Cloudflare R2 / CDN
- 21 首曲目全部上传到 R2 桶 `liveinpassion`，key 为 `music/<原文件名>`，
  对外地址 `https://img.liveinpassion.me/music/…`。已验证 206 Range 分段、
  正确的 `audio/mpeg` / `audio/flac` 与 CORS 响应头。
- 新增 13 首曲目补齐上传；其中两首文件名带 `'`（`I'll Come Along`、
  `Everything's Perfect`），第一次 CLI 上传因路径解析失败，已用 Windows 风格路径重传。
- R2 桶的 CORS 规则增加本地开发来源（`localhost` / `127.0.0.1` 的 5173–5175、
  4174、8123），生产来源 `liveinpassion.me` / `www.liveinpassion.me` 保持不变。
- `<audio>` 增加 `crossorigin="anonymous"`：跨域音频接入 Web Audio 后不会被静音，
  频谱分析器能正常拿到数据。
- 播放列表（`app/src/data/playlist.js` 与旧站 `index.html`）全部改为 CDN 绝对地址；
  `useMusicPlayer` 保留相对路径兜底。

### 仓库与构建
- `music/` 加入 `.gitignore` 并从版本库移除（本地文件保留）。
- `copy-static.mjs` 与 Vite dev 中间件不再处理 `music/`，构建产物不再携带约 432MB 音频。

### 注意
- update: 29 曾把音频文件提交进 git，历史里仍有这 432MB；要彻底缩小仓库需要重写
  历史（本次未做）。

---

## update: 29 — 2026-10-17

### 音乐播放
- 修复深链接下音乐播不了：播放列表仍是旧站的相对地址（`music/…`），在 `/blogs`、
  `/me` 等路由直达或刷新时被解析成 `/blogs/music/…`（404 + `Format error`）。
  现在统一按 `import.meta.env.BASE_URL` 拼成站点根开头的绝对地址。
- 修复进度条拖动后重置：
  - 进度条改为 Pointer Events 拖拽 + `setPointerCapture`，拖出轨道再松手也能 seek；
  - 拖动期间进度完全跟手、音频同步 seek，`isScrubbing` 期间屏蔽 `timeupdate` 回写；
  - 暂停状态下点击/拖动进度条也能正确跳转并保持暂停。
- 本地 dev 中间件补上 `Range` 支持（206 / `Content-Range` / `Accept-Ranges` / 416），
  `<audio>` 在本地也能 seek（之前只回 200 整份文件，拖动会回到 0）。
- 播放列表新增 13 首 Magnet 曲目（`Chasing Dreams`、`Everything's Perfect`、
  `I'll Come Along`、`Last Day of Summer`、`Lay Lady Lay`、`Little Miss More or Less`、
  `My Darling Curse`、`Nothing Hurts Now`、`On Your Side`、`Overjoyed`、
  `Smile to the World`、`Where Happiness Lives`、`Wish Me Well`），共 21 首。
- 修复 `Rolling Over` 的路径少了 `-%20`，此前一直 404。

### 频谱
- `<audio>` 接入 Web Audio（`MediaElementSource → AnalyserNode → destination`），
  首次播放时在用户手势里惰性建图。
- 新增 canvas 柱状频谱：对数分箱、跟随主题换色、暂停时只保留静止基线。

### 歌词
- 新增同步歌词展示：播放/打开播放器时按「曲名 + 主歌手」从 LRCLIB 拉 LRC，
  逐帧对齐当前行。
- 音乐软件式逐行滚动：当前行居中，上下行淡出（mask），行切换带缓动；
  当前行从左到右做卡拉 OK 填充。
- 仓库不存歌词正文；需要自己校时或 LRCLIB 没有的歌，可在
  `app/src/data/lyrics.js` 里按 `src` 写本地 LRC 覆盖。
- 服务不可用 / 没有同步歌词时自动只显示频谱，不报错。

### 底部「正在播放」舞台 / 首屏编排
- 歌词 + 频谱合并到屏幕底部正中的悬浮区：无底板、不拦截点击；
  手机端自动抬到底部 dock 上方。
- 接入首屏动画：在 `uiReady`（主人格/主体落定、其余 UI 开始浮出）之后，
  整块以 opacity 0→1、translateY 44px→0 从下方浮现（0.8s）。
- 播放器控制栏新增「频谱 / 歌词显隐」按钮（眼睛图标，关闭时划斜杠），
  状态写入 `localStorage`，刷新后保持；关闭期间不再请求歌词、也不跑动画。

### 验证
- dev 与构建后的 preview 均验证：进度条点击/拖拽/拖出松手/暂停拖动、21 首曲目点播、
  频谱像素随播放变化、歌词行推进与卡拉 OK 进度、开关与持久化、首屏浮现时间线；
  全程零控制台报错。

---

## update: 28 — 2026-10-12

- 博客详情窄屏（≤1024px）重做：取消左侧封面抽屉，封面改为固定不滚的整屏背景，
  上面压固定暗幕、正文改用浅色字；左边缘按钮只负责背景开/关。
- 桌面端「左正文 / 右封面 + 封面从列表飞入」的交接保持不变。
- `BlogDetailView.vue` 大幅重排（+266/−213），`main.css` 配套微调。

## fix: 27.2 — 2026-10-11

- 新增 `useCoverHandoff`：列表卡片与详情封面之间的矩形交接统一到一处。
- 封面飞行期间固定外壳（头部、主题/作者/音乐按钮）一并隐去；
  相关样式从 BlogDetailView 移到 `App.vue`，修掉权重不足一直没生效的问题。
- 修复 BLOGS 轨道无限循环回卷时的闪图 / 整排闪一下。
- 新增 `tools/verify-blogs-loop.mjs` 验收回卷。

## fix: 27.1 — 2026-10-11

- 修复 `useFilmPose` 的姿态计算问题，`BlogsView` 配套调整（卡片姿态更稳）。

## update: 27 — 2026-10-11

- 移除旧的 WebGL 胶片 / 扭曲层（删除 `useFilmStrip.js`，约 427 行），
  博客轨道改为纯 DOM + `useFilmPose` 的轻量实现。
- `BlogsView` 精简（−628/+109），`BlogDetailView` 配套调整；博客数据更新。

## update: 26 — 2026-10-11

- 方块光标全站化：新增 `BlockCursor.vue` / `useBlockCursor.js`，
  Teleport 到 body、压过品牌遮罩与转场板子；系统光标由 `html.is-block-cursor` 压掉。
- `useBlockCursor` 的手动举旗记录元素而不是布尔值，元素被摘出文档时能自动收回。
- 新增 `tools/verify-block-cursor.mjs` 全站验收。
- BLOGS 列表 / 详情大幅改版（bento 布局、卡片姿态、封面交互）。
- 修复 MobileDock 收起时容器仍吃掉点击的问题（`pointer-events`）。
- 博客数据更新。

## update: 25 — 2026-10-11

- 首屏重做：新增 `BrandOverlay`（ENTER 进场、字上移再落回）、
  `HeroConcept`（粒子主体 + 四人格）、`PageTransitionOverlay`、`usePageTransition`、
  `useRippleEffect`、`usePersonaScene`、`useWallPref`。
- 壳层：新增 `MobileDock`（手机端把作者区 / 主题 / 音乐 / 背景开关收进底部 dock）、
  `useEdgeReveal`（桌面端悬浮件收到屏幕外，靠边滑出）。
- BLOGS 列表与详情再次大改（`BlogsView` +2071、`BlogDetailView` +1486），
  引入 `useFilmStrip` / `useFilmPose` 的胶片姿态与 WebGL 扭曲层。
- 音乐播放器行为调整：起始固定第一首、起播即出声、`isPlaying` 在 `play()` 兑现后置位。
- 新增首页人像素材 `me/personas/*`、`me/hero_compressed/*` 与 `tools/build-personas.mjs`。
- 新增/更新验收工具：`verify-hero`、`verify-edge-reveal`、`verify-page-transition`、
  `verify-shell` 等。

### fix: 25.1 — 2026-10-11
- 抽出 `useFilmPose` 统一姿态数学，`useFilmStrip` 精简，`BlogsView` 配套。

### fix: 25.2 — 2026-10-11
- 博客图片迁移到 R2（新增 `worker/scripts/migrate-legacy-images.mjs`、`r2.js` 改动）。
- 博客数据快照更新。

### fix: 25.3 — 2026-10-11
- `useFilmStrip` 修复贴图 / 渲染细节（+70/−22）。

## update: 24 — 2026-10-05

- 后台博客编辑器：Card Title 自动生成 Title / Slug（手动改过的不再覆盖）。

### update: 24.1 / fix: 24.1 — 2026-10-05
- 编辑器与 Markdown 渲染小修。

### fix: 24.2 — 2026-10-07
- 后台相册 / 博客列表支持长按拖拽排序（新增 `pressDrag.js`）。
- 新增 `tools/verify-admin-mobile.mjs`：iPhone/iPad 尺寸 + 触摸仿真下验证
  点按目标、常显控件、拖拽排序，并跑桌面回归。

### fix: 24.3 — 2026-10-09
- 后台登录页 / Worker 鉴权整理；管理端构建与忽略配置清理。

## update: 23 — 2026-10-05

- 后台 Markdown 编辑器接入 `md-editor-v3` 配置：扩展 XSS 白名单
  （`blob:` 图片、figure/div/section/span 的 class、iframe 等），编辑期图片可正常预览。
- `BlogEdit` 继续扩展（+476 行），Worker Markdown 渲染同步调整。

## update: 22 — 2026-10-05

- 后台博客编辑器支持照片排版块（figure / figcaption / data-gid），
  前台样式配套（`main.css` +76）。
- 修复：`fix: 22.1`（管理端构建缓存 / 编辑细节）。

## update: 21 — 2026-10-05

- 后台博客编辑器图片上传改为回调式（`onUploadImg(files, callBack)`），
  上传完成插入光标处；上传中禁止保存。

## update: 20 — 2026-09-28

- 新增 STATS 页（`StatsView.vue`，访问统计可视化）与样式。
- Worker 新增访问统计：`migrations/0002_visits.sql`、`routes/stats.js`。
- 修复：`fix: 20.1`（2026-10-01）、`update: 20.2`（2026-10-04，Worker 侧迭代）。

## update: 19 — 2026-09-27

- ME 相册 / RandomGallery 布局与瓦片逻辑调整，`mePhotos` 数据补充，样式精简。
- 修复：`19.1`、`19.2`、`19.4`、`19.5`（2026-09-27 至 09-28，ME 页细节）。

## update: 18 — 2026-09-27

- 管理后台相册管理（`AlbumManage.vue`）接入，CMS 相册数据写入
  `app/src/data/content/albums.json` 并在前台消费。
- 图片加载器、ME 相册与样式配套调整；博客数据更新。

## update: 17 — 2026-09-27

- 新增 Cloudflare Worker CMS（`worker/`）：文章 / 相册 / 上传 / 公开接口、
  R2 存储、GitHub 同步、鉴权与 Markdown 渲染。
- 新增管理后台 `admin/`（Vue + Vite）：博客列表 / 编辑、相册管理、图片压缩上传。
- `app/scripts/fetch-content.mjs` 构建前从 CMS 拉内容快照；
  数据层（friends / galleries / groupPhotos / mePhotos）改为由 CMS 数据驱动。
- 修复：`17.1`–`17.4`（Worker 鉴权、上传、路由等）。

## update: 16 — 2026-09-25

- 新增 `app/`：Vue 3 + Vite 重写站点（脚手架、路由、组件、composables、
  逐字搬运的样式表），保留仓库根 `index.html` 作为线上版本。
- 新增 `tools/extract-legacy-data.mjs`：从旧 `index.html` 逐字提取数据到 `app/src/data`。
- 新增新旧站对比与验收工具：`tools/parity.mjs`、`verify-data`、`verify-gallery`、
  `verify-home`、`verify-me`、`verify-me-gallery`、`verify-shell`。
- 新增 `.github/workflows/deploy.yml`（构建 `app/dist` 发布 Pages，当时尚未切换）。
- 修复 ME 页重复注册监听器与定时器；新增博客《In the Middle of the World》。

### fix: 16.1 — 2026-09-25
- `app/src` 细节修复。

## update: 1–15 — 旧站时期（`index.html` 单文件）

> 这些版本当时只提交了版本号，没有说明；以下按改动内容补录主要节点。

| 版本 | 日期 | 主要改动 |
|---|---|---|
| 1 | 2026-05-23 | 首批照片 / 好友数据接入，新增 4 首 Low Roar 曲目，图片目录重整 |
| 2 | 2026-05-26 | 照片分组与压缩图体系整理（`home / hero / blog / group / graduated` 等） |
| 3 | 2026-05-26 | Tabler 图标集接入，导航 / 播放器图标替换 |
| 4 | 2026-05-26 | Hero 照片与压缩图补充 |
| 5 | 2026-05-26 | `index.html` 交互修复 |
| 6 | 2026-05-31 | `index.html` 小改 |
| 7 | 2026-06-01 | Hero / 博客 / 群组照片补充 |
| 8 | 2026-06-01 | 新增 Express 后端（Steam 数据 + Alist 代理），前端目录重构 |
| 9 | 2026-06-02 | GitHub Pages 发布工作流，静态资源移回仓库根；`9.1–9.5` 修部署与路径 |
| 10 | 2026-06-02 | 首页大改（电影海报 / 布局），新增 `movie-posters` |
| 11 | 2026-07-01 | ME 页图片与内容 |
| 12 | 2026-07-17 | 后端环境变量 / 忽略规则、favicon、logo；`12.1–12.3` 修复 |
| 13 | 2026-07-19 | `index.html` 大幅重构（+706/−360） |
| 14 | 2026-08-21 | 页面结构扩展（+1021/−110）；`14.1–14.2` 修照片子模块 |
| 15 | 2026-08-25 | 收尾小修；`15.1` 修复 |
