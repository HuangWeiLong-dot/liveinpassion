# Changelog

站点版本记录。提交信息沿用既有规则：

- `update: N` —— 一批功能更新
- `fix: N.M` —— 同一批里的修复

从 `update: 29` 起，每个版本都在这里写清具体改了什么。`update: 16–28` 按 git 历史补录；
`update: 1–15` 是旧站（单文件 `index.html`）时期，早期提交只写了版本号，这里按改动内容
补主要节点。每个条目的日期与 commit 一一对应。

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
