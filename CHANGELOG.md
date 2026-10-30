# Changelog

站点版本记录。提交信息沿用既有规则：

- `update: N` —— 一批功能更新
- `fix: N.M` —— 同一批里的修复

从 `update: 29` 起，每个版本都在这里写清具体改了什么；**此后每次 update/fix 提交都必须在文件顶部追加一条记录**。`update: 16–28` 按 git 历史补录；
`update: 1–15` 是旧站（单文件 `index.html`）时期，早期提交只写了版本号，这里按改动内容
补主要节点。每个条目的日期与 commit 一一对应。

---

## update: 50 — 2026-10-30

### GALLERY / 主灯箱：胶片条、骨架屏与日期滚动

- **底部胶片条**：GALLERY 与 MY GALLERY 多一条固定在底部的 92px 胶卷条，列出当前
  筛选（或月份）下墙上的照片；点一张直接飞进详情。滚轮竖向增量映射成横向滚动，
  到两头就把滚轮交还页面；缩略图复用 `thumbUrl` 的 200px 缓存，不额外解码大图。
  条子只在两个相册页驻留（离开即收起），1024 以下隐藏以免和 MobileDock 打架；
  主灯箱与 ME 单图灯箱的舞台都按 116px 给它让位。
- **主灯箱改成骨架屏 + 舞台定尺寸**：舞台宽高按照片比例算出来（打开时的飞行落点、
  骨架屏、大图共用同一个矩形），切图不再跳版；`img.decode()` 把解码移出主线程，
  加载期间盖一块 GPU `transform` 的 shimmer 骨架。
- **照片日期**：文件名里的 `YYYY.MM[.DD]` 解析成照片日期挂在照片下方；切图时旧日期
  向上、新日期从下滚入（reduced-motion 下直接落位）。ME 单图灯箱同步接上这一行。
- **修**：ME 相册快照里同一张图有原名与 hash 别名两条记录，墙面和胶片条会并排出现
  同一张照片 —— 按图片地址在数据层去重。

### BLOGS 的 WORLD 视图（参照 oumahi.art 的作品环）

- 封面沿一条 CSS 3D 圆柱排成一圈（`perspective` + `rotateY` / `translateZ`，无 WebGL），
  拖拽 / 滚轮转动、松手带惯性、空闲时极慢自转；点一件压暗世界并展开大图 + 右侧信息栏，
  ← → 换件，CLOSE / ESC 收起。
- 右上角 VIEW 按钮在 LOOKBACK / WORLD 之间切换，选择存 `localStorage`、URL 也带
  `?view=world`；原轨道只是被盖住，滚动位置与图片缓存都还在，切回来原地继续。
- 环心那枚 LIVEINPASSION 与首屏同一套字号 / 字距，钉在圆心并往屏幕深处推：
  前半圈封面在它前面、后半圈在后面，转动时有真正的遮挡层次。
- 说明栏（ENTRIES / DRAG·SCROLL·CLICK·A PIECE）排在 VIEW 按钮正下方、右对齐成一列。
- 900px 以下环收成纵向索引，不叠第二套 3D。

### 卡片语言统一（`composables/useCardFx.js`）

- 三处卡片（GALLERY 墙 / ME 墙 / WORLD 封面）统一：1px 直角发丝边、悬停才跑的
  8px 黑白行军蚁描边、静态去色压暗、悬停恢复彩色并把放大放在内部图片上
  （整卡不缩放，边框与描边不会跟着抖）。
- 指针跟随的轻微 3D 倾斜只写两个 CSS 变量，墙 / 环 / 灯箱各自在自己的 transform 里接；
  只在细指针 + 非 reduced-motion 下生效。
- 图片解码完成时来一次「Bayer-8 抖色 + 逐行抖动」的故障揭示：低分辨率画布叠在卡片上，
  前缘 9 行做像素错位与红蓝分离，约 1s 后淡出交还真实图片；GALLERY / ME / WORLD /
  两种灯箱 / 博客详情封面都接同一套。跨域图片读不到像素时静默跳过。
- 所有动效都遵循 `prefers-reduced-motion`。

### 性能：画面不变，主线程开销更低

- **故障揭示**：已揭示区与抖色区在创建时预计算成两张 32 位像素表，逐帧只做整行拷贝，
  只有前缘 9 行逐像素 —— 灯箱大图从每帧十几万次像素运算降到几十次整行拷贝。
- **倾斜**：卡片矩形在指针进入时量一次（滚动 / 缩放时失效），不再每帧
  `getBoundingClientRect` 强制回流。
- **WORLD 逐帧循环**：缓动按 dt 折算（120 / 144Hz 上不再比 60Hz 快一截）；
  拖拽 / 滚轮只在 rAF 里写一次 transform；展开层停稳后停循环（读字时不再每帧
  重算那层模糊背景）；空闲自转约 30fps 更新，转速本身不变。
- **相册墙**：`loadedSrcs` 与胶片条缩略图按帧合批，一帧里到的几十张只触发一次重渲染；
  指针提示的跟随也走 rAF。
- **CSS**：行军蚁动画只挂在悬停 / 正面那张上，骨架屏两条动画只在灯箱激活且骨架未隐藏
  时跑 —— 几十个元素挂无限动画、关掉灯箱后还在逐帧走的那笔开销没了。
- **其他**：照片飞行盒子加 `contain: layout paint`；灯箱的比例探针与舞台大图共用
  CORS 缓存，不再重复下载 / 解码。

### 其他修复

- 页脚抽屉拉开时，底部那批固定件（Dock、GALLERY 筛选条与胶片条、正在播放的歌词）
  先淡出，不再压在页脚那三句 Be 上。
- `BlogDetailView` 的页面滚动锁改到 `onDeactivated` 释放：这一页在 keep-alive 里，
  离开时 `onBeforeUnmount` 不会跑，原来会把整站的滚动一直锁死。

---

## update: 49 — 2026-10-29

### GITHUB ACTIVITY 改成年初至今（48 的补充）

- **格子图从 12 周扩到整年**：公开事件接口只能回溯 90 天，画不出「从 1 月 1 日开始」，
  所以贡献数据改走 `github-contributions-api.jogruber.de/v4`（CORS 放开、一次给满全年、
  自带 GitHub 的 0–4 级）。窗口从 1 月 1 日所在那一周开始到本周；1 月 1 日之前的半列
  和本周里今天之后的几天都不画框、不进统计。日历接口拿不到时退回原来的 12 周画法，
  脚注标 `CALENDAR UNAVAILABLE · LAST 12 WEEKS`，不会变成一整片空白。
- **蛇**：照 GitHub snake 的走法沿格子蛇形爬，头经过有活动的格子就吃掉（本轮变空），
  到终点停一下再来；指针停在格子上 / 面板滚出视口 / reduced-motion 时不推进。
- **格子图下方补齐**：BUSIEST DAY / BUSIEST WEEKDAY / AVG PER ACTIVE DAY / LONGEST RUN
  四个数字，再下面是 BY MONTH 的月度柱（带 PEAK 月份），把原来蛇图下面那块空洞填满。
- **右栏保持纯文字**：TOP REPOSITORIES 去掉进度条，只留序号 / 仓库名 / 事件数；
  最近动态也放回右栏，和仓库榜同一种列表形态 —— 左栏已经有格子图和月度柱，
  右栏再来一根根条子不协调。
- **修：LIFE 整页空白**：旧缓存缺少 `avgPerActiveDay` 时 `.toFixed` 抛错，把整个
  LifeView 的渲染带崩。缓存键升到 `v4` 并校验形状（`cells` / `totals` / `monthly`），
  组件里也改成 `Number.isFinite` 兜底显示 `—`。
- 验收：`tools/verify-github-activity.mjs` 换成全年 fixture（308 格 / 3 格 outside /
  3 格 future / 月份刻度 / 0–4 级分布 / 蛇推进与悬停暂停 / 普通视图不染成分类色 /
  刷新命中缓存 / 手机横向滚动、格子保底 9px / 日历失败退回 12 周 / 两个源都失败的空态 /
  reduced-motion 无蛇）。

---

## update: 48 — 2026-10-29

### 新板块 GITHUB ACTIVITY（长页 + 仪表盘都有）
LIFE 里多了一块 GitHub 的公开动态：贡献格子图 + 合计 + 仓库排行。

- **数据**：GitHub 公开事件接口 `api.github.com/users/HuangWeiLong-dot/events/public`，
  不需要 token，也不经过 Worker。未鉴权限 60 次/小时/IP，所以结果缓存在
  `localStorage`（10 分钟），模块级单例让长页 / 仪表盘共用一份；切视图、刷新都不会重复请求。
  403/429 时退避 15 分钟，有缓存就继续显示并标 `CACHED`，没缓存才显示 `RETRY`。
- **格子图**：12 列（周）× 7 行（星期）= 84 格，按当天事件量分 0–4 级深浅；
  未来几天不画框。悬停 / 聚焦任意一格，下面那行读出当天的 commits / PRs / issues。
  公开事件接口最多覆盖约 90 天，窗口按「本周一往前 11 周」对齐，header 写实际天数。
- **合计**：COMMITS / PULL REQS / ISSUES / EVENTS / ACTIVE DAYS / STREAK（长页 6 个，
  仪表盘收成 4 个）。PushEvent 的提交按 sha 去重（翻页会重叠），合并提交没有
  commits 时按 1 次算；连续天数沿用 GitHub 口径（今天没活动从昨天起算）。
- **仓库排行**：只列窗口内碰过的仓库，按事件数排序，名字直接链到 GitHub；
  底部 `OPEN PROFILE` 出去。
- 位置：长页里排在 WEEKDAY PROFILE 之后、THE ARCHIVE 之前（08 / 09）；
  仪表盘里是 13 号格子，ARCHIVE 顺延成 14。
- 验收：`tools/verify-github-activity.mjs`（84 格 / 未来格数 / 今天格 / 7 行星期 /
  月份刻度 / 0–4 级分布 / 合计数字 / 仓库数 / 悬停读数 / 切换视图不重新请求 /
  刷新命中缓存 / 手机不横向溢出 / 403 时的 RETRY 与退避、零控制台报错）。
  `tools/verify-life.mjs` 的面板数从 9 改成 10，其余断言不变。

---

## update: 47 — 2026-10-29

### LIFE 仪表盘视图：FEED / DASHBOARD 可切换
同一个 `/life` 现在有两种看法，切换点在 hero 那行元信息里（`FEED` / `DASHBOARD`
分段按钮），选择记在 `localStorage.lifeViewMode`，也认 `?view=dashboard` 直达。

- **长页原样保留**：`FEED` 就是原来的 6 张 KPI + 9 个面板 + 全部 GSAP 入场，
  一行没删。仪表盘是另一套 DOM（`components/LifeDashboard.vue`），
  不是把长页压扁。
- **12 列 bento**：01 NOW（位置 + 电脑/手机/手表 + 实时问答）、02 TODAY
  （今日桌面小时与前三应用）、6 张 KPI、04 七维雷达（`compact` 紧凑版）、
  05 DAILY RHYTHM、06/07/08 MOTION / PHONE / AI SPEND、09 PLACES、
  10 LATEST RUN、11 TOP APPLICATIONS、12 WEEKDAY PROFILE、13 THE ARCHIVE。
  点击行为和长页一致（单日详情 / 今日明细 / RUNNING 弹窗）。
- **样式不另起一套**：仪表盘复用 `.stats-panel-head` `.stat-card` `.life-row`
  `.life-bars` `.life-weekday-row` `.life-chip`，`is-color` 下的分类色照常生效。
- 仪表盘不挂 `data-reveal` / `data-chart`：这两套 GSAP 揭示是给长页滚动用的，
  板子一屏铺满，全部直接可见，`ScrollTrigger` 也只管长页。
- `LifeNow` 在两种视图里**都保持挂载**（切到仪表盘时只 `v-show` 收起）——
  仪表盘的「现在」读的是它 `@snapshot` 抛出来的那份 `/api/life/now` 快照。
- 切回 FEED 时重新 `ScrollTrigger.refresh()` 并重挂地图的 `IntersectionObserver`
  （DOM 刚被重新插进来，旧的观察器已经失效）。
- 验收：`tools/verify-life-dashboard.mjs`（12 块 / 6 个 KPI / 雷达 / 21 列 rhythm /
  3 个迷你图 / 7 行 weekday / 8 个归档入口、无横向溢出、点柱子开单日详情、
  切回 FEED 恢复 `.life-now` 与 6+9、URL 参数清掉、刷新记住选择、手机与浅色截图、
  零控制台报错）。

---

## update: 46 — 2026-10-27

### 新页面 `/organization`：这个组织是什么
实验型的**一屏一页**演示页（不滚动），回答的不是「这个网站是什么」，而是
「LIVEINPASSION 是什么组织」。八屏：封面（`WHAT IS LIVE IN PASSION?`）→ 名字 →
三条主张 → 第一个项目 `OPEN SOURCE LIFE` → 从记录到模型 → 想做成的那家公司 →
路线图 → 结尾。导航加了一项 `ORG`（转场板子上写全称 `ORGANIZATION`）。

- **一屏就是眼前这一屏**：八块 `.org-slide` 全部绝对定位叠在同一块舞台上。
  翻页时旧的一帧内用 `gsap.set` 收掉、新的才淡入 —— 不做交叉淡入，
  任何时刻只有一屏可见，不会两页同框。
- **翻页**：滚轮 / 点击空白 / ↑↓ / PageUp·PageDown / Home·End / 手机上下滑，
  右边缘的页码可点跳。一次手势只翻一页（触控板一划会连发几十个 wheel 事件，
  靠 620ms 冷却压住）；点链接、按钮或刚拉过选区都不算翻页。
- **不滚动**：`.org-page` 是 `100dvh` + `overflow: hidden`；全局页脚这一页不挂
  （`App.vue` 的 `showGlobalFooter`）—— 页脚那块占位会把文档撑高，让滚轮有东西可滚。
- 视觉沿用站内那套：Oswald 大写标题 / Poppins 正文 / JetBrains Mono 标签、
  1px 发丝线、纯 `--bg` 底色，没有点云、渐变和描边字。
- **一屏装得下**靠三层：字号用 `vh` 参与 clamp；手机上再收一档；`fitSlides()` 兜底
  （极矮窗口按需整体缩放，永远不压到导航栏、也不被 `overflow: hidden` 裁掉）。
  上内边距的下限（96px）高过固定头部，底部在手机上让开 MobileDock。
  另外：章节顶部那行页码 / 章名是 `div` 不是 `<header>` —— main.css 有一条全站的
  `header { position: fixed }`，用 header 会被钉到视口顶部、正好压在导航栏上。
- keep-alive：离开拆监听，回来重新从第一屏开始；reduced-motion 下翻页直接落位。
- 验收：`tools/verify-organization.mjs`（八屏、任何时刻只有一屏、一次手势只翻一页、
  点击 / 键盘 / 滑动 / 右轨跳转、内容装得下且不压导航栏、六种窗口尺寸、浅色主题、
  reduced-motion、零控制台报错）。

## fix: 45.3 — 2026-10-25

### 今日统计的桌面应用时长显示到分钟
`topApps` 的时长单位是**小时**，`LifeToday` 用 `hoursLabel` 只显示一位小数（`3.4h`），
分钟被抹掉了；站点、手机用的是 `minutesLabel`，同一张卡里两种写法。
现在桌面应用换算成分钟再走 `minutesLabel`，显示 `3h 24m`，不足 1 小时显示 `40m`。
`LifeDetailModal` 的 DESKTOP 分类详情同样处理；卡片头部的 `TRACKED` 也统一成
`12h 42m` 的写法（原先 `12.7h`）。

## fix: 45.2 — 2026-10-24

### 雷达维度名不再被截断
`button.life-radar-row` 上的 `font: inherit` 把行的 0.58rem 等宽字体冲回 16px，
`TRANSPORT` 于是被省略号吃掉。去掉这条 reset，其余字距 / 颜色继承保持不变。

## fix: 45.1 — 2026-10-24

### 雷达底部的并集不再叫 TRACKED
`UNIQUE TRACKED` 和 KPI 的 `TRACKED HOURS`（只算桌面）撞名，两个数还不一样。
改名 `UNIQUE TIME`，提示里写清：桌面 `Other` 在并集里、不在七维里，
所以 `OVERLAP` 是「七维之和 − 并集」的**下限**。

## update: 45 — 2026-10-24

### 七维雷达：把「重复计时」摊开
- 新增 `LifeRadar.vue`：Work / Study / Life / Transport / Leisure / Health / Social 七个维度，
  支持 DAY / ALL / 7D / 30D / YEAR 切换、日期步进与下拉，并与 NEURAL CORE 双向联动。
  点任一维度打开详情：桌面 blocks（应用 / 标题 / 站点）、GPS、手表、手机分列。
- 七维是**按来源相加**的（电脑和手机同时在用会算两次）。新增 `collapsedHours`
  = 桌面区块 + 交通 + 锻炼 + 手机区间的**并集**，雷达底部显示 `UNIQUE TRACKED / OVERLAP`。
- 手机上的对话式 AI（DeepSeek / ChatGPT / Claude / Gemini / Copilot / Perplexity）并入 Study；
  Study 详情里单列 PHONE AI，让维度总数和桌面明细对得上。

### 数据窗口与展示口径
- Worker 的 `/api/life?days=N` 上限从 90 提到 400：雷达的 YEAR 以前其实只有 90 天数据，
  标签和实际窗口对不上。
- DAILY RHYTHM 的副标题改成实际天数（原来写死 7D，画的是 30 天），
  悬浮提示的 `7D TOTAL` 改成 `DAY TOTAL`；WEEKDAY PROFILE 改成动态天数 + `AVERAGE PER WEEKDAY`。

### LIFE 页面
- 新增「今日统计」（`LifeToday.vue`）：桌面 / 站点 / 手机 / AI 四类当天累计，
  卡片可点开查看该类完整明细（`LifeDetailModal.vue`）。
- KPI 改为 4 × 2 bento 共 6 张，`SCREEN-ON HOURS` 可点开逐日桌面 / 手机表。
- 跑步弹窗补分段配速、爬升 / 坡度、心率区间（`data/runStats.js`，纯函数）；
  路线缩略图改用独立包围盒，操场小圈不再缩成一个点。
- NEURAL CORE 内部改成「规则神经元」：8 条主树突 + 每日节点挂在末梢上，
  可切换 RADIAL / PYRAMID 形态；布局仍是确定性 seed，截图可比对。
  **显示名不变**，页面上仍然叫 `NEURAL CORE`（副标题 `8 REGIONS · N DAYS · LIVE GRAPH`），
  「规则神经元」只是代码里对布局形态的叫法。
- 神经图面板编号从 **00** 挪到 **01**（七维雷达占了 00）；LIFE 页其余面板依次顺延。

### 分类规则（LifeLogging）
- 浏览器里没命中强信号 → Study（看资料）；PUBG / TslGame → Leisure；
  Antigravity / Cursor 等编辑器助手 → Work。
- 短切片不再跨应用改写区块分类或标题 —— 之前 PUBG 会被隔壁的 Code/msedge 切片带成 Work。

### 其它
- `docs/` 增加站点架构与 LIFE 数据链路图（drawio + png）。

## update: 44 — 2026-10-24

### 跑步弹窗接上了 GPX / FIT 的逐秒数据
- 两个解析器以前只取经纬度和时间戳，**FIT 里的心率、速度、海拔全被丢掉**，
  数据库里只剩整次平均。现在保留成 `meta.samples`（240 点压缩，`t` 秒 /
  `hr` / `v` m/s / `alt`）。
- RUNS 弹窗每条跑步多了路线缩略图（自成包围盒，不是 30 天大图上的几个像素）、
  心率曲线、配速与海拔剖面。心率只有 FIT 有，GPX 有速度和海拔。
- 同一次活动的 FIT + GPX：路径取点数多的那份，**采样取有心率的那份** ——
  否则 GPX 恰好点数多时，心率曲线会凭空消失。
- 笔记本关机、只有手表文件的那几天，跑步也会出现在列表里，标 `WATCH FILE ONLY`：
  距离、时长、路线是真的，名字 / 卡路里 / 恢复时间没有（那来自数据库聚合）。
- 打开弹窗时按需只拉「有 workout 的那几天」的轨迹，不为了一个弹窗拉 30 天。

## fix: 43.1 — 2026-10-24

### 笔记本关机那几天的手表路线能真的画出来了
`update: 43` 把发布搬到了服务器，但地图有两道门把它挡在外面：

- 地图的日期列表只从 `index.kinds.events` 取，而 `watch` 被排除在索引之外 ——
  **只有 watch、没有 events 的那天根本不会被请求**。现在索引多一个 `watchDays`
  字段（仍不进 `kinds`，归档页还是 8 个 tab），`mapEventDays` 把两边并起来。
- 窗口右端原来取 `/api/life` 最后一篇聚合。笔记本不开就没有新的一天，手表路线
  再新也落在窗口外。现在右端按「今天」封顶。

顺带确认了一件事，写在这里免得以后误会：**GPX / FIT 不进 MOTION**。两个导入脚本
只写 `metric=watch_track` 的轨迹事件，MOTION 的步数 / 心率 / RUNNING / BEST PACE /
LONGEST / VO2MAX 全部来自笔记本从 Gadgetbridge 数据库算出的聚合，与这两个文件无关。
FIT 里的心率采样、步频、海拔、卡路里目前都没有被保存。

## update: 43 — 2026-10-24

### 手表路线改由服务器发布
- 地图现在合并两路数据：笔记本发布的 `events` 和服务器每 15 分钟发布的 `watch`
  （中继上 GPX/FIT 的解析结果）。两份按**开始时间**去重，同一次锻炼只画一条。
- 笔记本关机时手表虚线仍然更新：中继 24 小时收文件，服务器直接解析并写入
  `life/raw/watch/<day>.json`，不再依赖 23:00 的 `run_daily.ps1`。
- Worker 的原始文档白名单新增 `watch` kind；它**不进归档索引**，归档页仍是 8 个 tab。
- `fetchLifeTrack` 以前只拉 `events`，404 就整天丢弃；现在两路各自成败互不影响，
  任一路有数据就画。

## fix: 42.3 — 2026-10-24

### 手表路线：同一次活动的 FIT + GPX 不再重复计数
- Gadgetbridge 对同一次锻炼会导出同名的一对 `.fit` 和 `.gpx`，两个导入脚本
  各写一条 `watch_track`（`source` 不同，events.db 不会去重）。以前两条都算，
  地图上画两条虚线、当天的手表时长翻倍。
- `parseLocationEvents` 现在按**开始时间**认定「同一次活动」：只保留点数多的那条
  路径，`watchMinutes` / `watchKm` 在去重后统一求和。两份事件**仍然都留在**
  events.db 里。
  不能按文件名去重 —— 中继按内容 sha1 存，笔记本拉到的是 `state/gpx/<sha1>.gpx`，
  两份文件的 `value_text` 是两个不同的哈希。实测同一活动的 FIT / GPX 开始时间
  逐秒相同，用它当键最可靠。

## fix: 42.2 — 2026-10-22

### 七维图例 / NOW Steps icon
- `rhythmLegend` 的 zero 判定以前只看桌面 `categories`，所以 Transport/
  Health/Social 在柱子里已经有值、右上角图例却还是灰的。现在和柱子一样
  优先看 `dimensions`，有数据就不再变暗。
- WHAT I'M DOING NOW 的 WATCH 卡给 steps 加了脚印 icon，和 BPM 的心形 icon
  对称。

## fix: 42.1 — 2026-10-22

### DAILY RHYTHM / WEEKDAY PROFILE 补齐剩余三维
- 两张图从桌面 `categories` 改为优先读 **`dimensions`**：Work/Study/Life/Leisure
  来自桌面，Transport 来自 GPS，Health 来自手表，Social 来自手机——剩下的
  Transport / Health / Social 不再只出现在图例里。
- 柱子的总量、纵轴与悬停 `7D TOTAL` 都按七维之和；WORK SHARE 也按七维总量计算。
- 面板标题加 `7D · DESKTOP + GPS + WATCH + PHONE` 说明。

## update: 42 — 2026-10-22

### 全历史 Best Pace / Longest + GPX 路线
- 聚合新增 `allTime`：直接读 Gadgetbridge `BASE_ACTIVITY_SUMMARY` 的**全部**
  锻炼历史（不是 30 天窗口），给出全历史最快配速、最长单次距离、总次数/总公里。
  `BEST PACE` 卡改为全历史，并显示来自哪天、多久之前、那次跑了多少公里；
  新增 `LONGEST` 与 `ALL TIME` 两张卡。
- 新增 `scripts/import_gpx.py`：把 Gadgetbridge 导出的 GPX 写成
  `domain=fitness / metric=watch_track`，地图用虚线画出**手表路线**，
  与手机 Dawarich 的实线轨迹区分；文件按 path+mtime 去重。
- 聚合 workouts 增加 `cadence`；Worker 校验 `allTime` / `cadence`；
  旧 Worker 继续走“去掉新字段再重试”的兼容路径。
- 心率带、RUNNING 详情弹层、BPM 区间条（update 41 的延续）保持。

## update: 41 — 2026-10-22

### MOTION · RUNNING 明细 / 心率带
- RUNNING 卡现在可点击（也支持 Enter/Space），打开逐次跑步弹层：日期/时间、
  距离、时长、配速，以及 AVG/MAX HR、热量、爬升、VO2max、训练效果、恢复时间。
- 聚合新增 `workouts` 数组（来自 `domain=fitness` 的每次锻炼），Worker 校验该字段；
  每次跑步的明细不再被日汇总吞掉。
- 心率带改为可读的小图：左侧日期轴、右侧 BPM 纵轴、MIN–MAX 区间 + AVG 点、
  悬停显示当天详情；标题明确 `LAST 30 DAYS · N WITH DATA`。
- 大爱心下的 BPM 增加 40–200 刻度区间条（MIN/AVG/MAX），单位 `BPM` 放大；
  NOW 的 WATCH 卡也加了心形图标 + 大号 BPM。

## fix: 40.1 — 2026-10-22

### MOTION 跑步配速
- RUNNING 卡补上**最近一次跑步的配速**；`BEST PACE` 仍然保留全窗口最佳，
  但已经明确显示它来自哪一天、多久之前（例如 `9D AGO · OCT 13`），不再让
  人误以为那是今天的配速。

## update: 40 — 2026-10-22

### 七维向量（神经系统输入）
- `/api/life` 每天新增 `dimensions`：`Work / Study / Life / Leisure` 来自桌面
  ActivityWatch 分类；`Transport` 来自 GPS 通勤分钟；`Health` 来自手表跑步分钟；
  `Social` 来自手机社交应用分钟。`Other` 不进入七维。
- Worker 校验 `dimensions`（7 个 0–24 的数字）；`publish_life_site.py` 对旧 Worker
  做“去掉 dimensions 再试”的兼容重试，23:00 不会整批失败。
- `LifeBrain` 优先读 `dimensions`，旧 payload 回退 `categories`；
  Health / Transport / Social 现在能真的长出日期簇，而不是永远为 0。
- RHYTHM / WEEKDAY 图例同时列出全部 8 类（含 0，变暗）。

## update: 39 — 2026-10-22

### LIFE MOTION / WATCH / PLACES / 归档
- MOTION 里加入手表面板：大心跳爱心（爱心压在波纹上、心跳线无限循环不跳）、
  HR AVG/MIN/MAX、最近一次跑步（日期/多久之前/当天次数/距离/时长）、
  BEST PACE 的日期与年龄、VO2MAX、每天心率 MIN–MAX 条带。
- MOTION 底部新增实时状态：PHONE SCREEN ON/OFF、DESKTOP RUNNING/AFK/IDLE、
  LOCATION MOVING/STAYING、LIVE SNAPSHOT 年龄；NOW 卡同步显示这些旗标。
- `push_desktop.py` 并入 2 分钟实时循环，桌面 AFK/当前窗口不再最多旧 10 分钟。
- PLACES 取消 7 天上限：首屏 7 天，`LOAD MORE` 按需追加；地图支持滚轮/按钮缩放、
  拖拽平移、双击放大、RESET。
- Transport 改为按 **分钟** 显示（Dawarich `mode_timeline` 的 `value_num` 是分钟，
  旧代码误当 km）；标签映射 walking / E-BIKE / SUBWAY / RUNNING。
- 归档页修复长 URL / 宽表格 / 原始 Markdown 的横向溢出；`verify-life-archive`
  加长 URL 回归。
- RHYTHM / WEEKDAY 图例列出全部 Work/Study/Life/Transport/Leisure/Health/Social/Other，
  当天为 0 的维度变暗而不是消失。
- Worker 接受 `health.hrMax`；`publish_life_site.py` 可从 `heart_rate_avg` 的 meta
  补出历史 hrMax，并对旧 Worker 做去掉 hrMax 的兼容重试。

### 验收
- `verify-life`、`verify-life-now`、`verify-life-archive` 全过（MOTION 状态行、
  地图 LOAD MORE / 缩放、手机无溢出、NOW 旗标）。

## update: 38 — 2026-10-21

### 24h 服务器侧实时快照（笔记本关机也继续更新）
- 新增 `server/live-now/live_now_server.py` + systemd service/timer：每 2 分钟在
  24h 服务器上组装 `/api/life/now`，来源是 Dawarich（位置/坐标）、中继 `/events`
  （手机）、中继 `/qa`（实时问答）、中继上的 `gadgetbridge.db`（手表 steps/HR）。
- 发布前先 GET 当前快照；**电脑和手表只保留两边里更新的一份**，所以笔记本开着时
  不会被服务器上的旧中继快照覆盖；笔记本关掉后服务器才接管。电脑窗口只能停在
  最后一份 `/desktop`（ActivityWatch 在本机），这一点无法搬走。
- 手表 `pushedAt` 现在始终展示：卡片显示 `UPDATED HH:MM · Xm AGO`，来源可以是
  本机 ingest、中继 `/watch`，或服务器直接解析的 `gadgetbridge.db`。
- 站点英文不变：服务器这条同样用 `translate.Translator` 翻问答/窗口标题/地名。
- 部署见 `server/live-now/README.md`（需要服务器上设置 `LIFE_INGEST_TOKEN`；
  `DEEPSEEK_API_KEY` 复用 close-day.env）。

## fix: 37.1 — 2026-10-21

### WATCH 卡停在昨天（明明手表数据已经到了）
- 根因：`publish_live_now.py` 总是优先取中继 `/watch`，而 `push_health.py` 只在
  `run_daily.ps1` 里跑；中继那份停在 10/20。其实本机 `events.db` 已经有 10/21 的
  steps / HR，只是没被用上。
- 修复：`watch_now` 同时读本地和中继，取 `day` 更新的一份（同一天优先本地，
  `ingested_at` 更新）；`run_live.ps1` 的重采集里补上 `push_health.py`，中继
  `/watch` 也会跟着走。
- 验证：`/api/life/now` 返回 `2026-10-21`、7,822 steps、HR 83.2、`synced: true`；
  页面 WATCH 卡显示 `21.10.2026 · SYNCED`，`NOT TODAY` 消失；KPI STEPS 也包含今天。

## update: 37 — 2026-10-21

### LIFE：WHAT I'M DOING NOW（实时状态）
- 新增 `app/src/components/LifeNow.vue`，放在 LIFE 顶部 KPI 上方：位置 + 坐标（OSM 链接）、
  实时问答的问题与回答、电脑当前窗口、手机最后应用/解锁数、手表步数/心率。组件自己每 30 秒
  轮询 `/api/life/now`，与 `/api/life` 的 60 秒轮询无关。
- Worker 新路由 `POST/GET /api/life/now`（R2 `life/now.json`，公开读、no-store、64 KiB 上限、
  顶层字段白名单）；已部署。LifeLogging 新增 `scripts/publish_live_now.py`，在 `run_live.ps1`
  每轮采集之后发布一份快照：位置来自 events.db，电脑/手表来自 phone_relay 的 `/desktop`/`/watch`，
  问答来自 `/qa`；**发布前用 Translator 翻成英文**（问答原文、窗口标题、地名），
  `max_calls=6` + 本地缓存控制成本。
- `run_live.ps1` 补上 `normalize.py --date today`：之前只采集不归一化，blocks 不动，站点聚合
  的分类时长会停在上一次；现在每轮回写 blocks，再发聚合与 now。
- 验收：新增 `tools/verify-life-now.mjs`（桌面/手机/404 无快照），并已用真实 CMS 数据
  确认五张卡片、坐标、问答、电脑/手机/手表与更新时间。

### 数字入场
- LIFE 与 STATS 的 KPI 卡片不再作为一个整块 `autoAlpha: 0` 隐藏后统一滑入；卡片保持可见，
  由 `OdometerNumber` 从 0 逐位滚到目标值。首次加载、keep-alive 重进都保留滚动入场。
- `tools/verify-stats.mjs` 的卡片可见性断言继续通过。

## fix: 36.1 — 2026-10-21

### ENTER WITHOUT MUSIC
- 之前只有鼠标单独点击有效：键盘 Enter 会先触发 document 的 keydown 自动起播；先点过页面背景
  再点它也不会停掉已经开始的音乐。
- 现在 `data-no-music` + `tryAutoPlay` 目标检查 + `@click.stop` / `@keydown.enter.stop`：
  从该按钮发出的 click/touch/keydown 都不起播；`cancelAutoPlay()` 会同时暂停已播放的音频、
  清 `isPlaying`、抑制本次会话后续的自动起播（手动播放键不受影响）。
- 新增 `tools/verify-enter-no-music.mjs`：鼠标、键盘、已起播后点击三条路径全部断言。

## update: 36 — 2026-10-21

### LIFE：可交互 3D 神经图（NEURAL CORE）
- 新增 `app/src/components/LifeBrain.vue`（three 场景、镜头与交互）和
  `app/src/data/lifeBrain.js`（确定性图布局 + 日聚合映射）。挂在 LIFE 的 00 号面板，
  数据仍然只来自 `/api/life` 的夜间聚合，不读 raw 坐标或日记。
- 视觉改成 Obsidian 图 / 量子纠缠那种点对点网络：8 个分类枢纽 + 每天一颗节点，
  发光细线 + 相似日之间的长弧“纠缠”；脉冲成对出现（一颗 A→B、一颗 B→A）。
  脑壳只留一层很暗的尘埃做剪影，陀螺环 / 日期环 / 中央核心继续当机械外框。
- 日期节点按「相对该分类自身平均占比有多突出」聚类到 8 个枢纽，而不是简单按
  当天时长最多 —— 否则 Work 占 55% 时 30 天会全挤在一个点上；跑步日会落进
  Health 簇、社交日进 Social 簇。悬停/选中会点亮该节点及其邻居并压暗其余节点。
- 镜头改成绕 target 的球面轨道：点节点 → 1.5s 缓动推近并平移；再点另一个 →
  从当前位置直接飞到新节点（点对点切换）；点空白 / RESET 回全局；选中节点有
  矢量选中环（`RingGeometry`，逐帧朝向相机，放大不糊）。方向键旋转、`DAY ›` /
  单日 HUD 的 ‹ › 逐日切换、Enter 打开当天、双击日期节点也直接开单日详情。
- 标签不再“乱飘”：固定偏移、不做径向推挤或每帧碰撞位移；拖拽 / 推镜 / 滚轮缩放
  期间标签整体淡出，停下再淡入；指针在画布内时自动环绕暂停。投影重叠时只保留
  时长更大的标签，且不移动位置。
- 鼠标与选中状态显式可见：画布内改用 difference 混合的四向准星（压在白色节点上会
  变黑）和光标旁的节点名 + 时长提示；进入画布时临时隐藏全站方块光标。左上角读数
  固定显示 **SELECTED** 项，悬停别的节点只做图上高亮和光标提示，不会再把你选中的
  那一项顶掉；选中的分类标签与日期标签反色。
- 全屏交互：FULL 进全屏（原生 Fullscreen，失败时退化为 CSS 覆盖层），全屏内
  `+ / −` 和滚轮缩放；普通面板里滚轮不缩放、不抢页面滚动。全屏时临时抬高
  `.page` 的 stacking context，避免头部盖在 3D 层上；退出全屏恢复面板高度。
- 性能与降级：three 动态 import，只在面板接近视口时下载；离屏 / keep-alive
  失活 / 标签页隐藏都停 RAF；`prefers-reduced-motion` 下不自动旋转、不跑脉冲，
  推镜直接落位。窄屏（竖屏）按图本身而不是外框取景，手机全屏不会把图缩成一小团。
- 日期节点不再借用聚类分类的颜色，改用独立的“时间色”：暗色主题 `#E8C15A` 暖金、
  亮色主题 `#A47C1E` 深铜金；8 个分类枢纽继续用各自的分类色。日→分类的连线用分类色，
  分类↔分类用两色混合，日↔日纠缠线用时间色（`DAY_COLOR`，同时写成 CSS 变量
  `--life-day-color` 给标签/图例用）。日期节点的核心改成小菱形（黑白模式下也能和
  圆形分类枢纽区分），底部图例增加 `DAYS n` 的菱形色键。
- 新增 `tools/verify-life-brain.mjs`：节点/连线数量、悬停、枢纽点击推镜、点对点切换、
  逐日切换、OPEN DAY、图例联动、彩色、全屏 + 滚轮缩放、浅色、reduced-motion、手机
  与空数据、拖拽时标签让路，零控制台报错。`tools/verify-life.mjs` 的面板断言从 7 改为 8。

### LIFE：实时聚合（每 2 分钟）
- LifeLogging 新增 `scripts/run_live.ps1` 和 `scripts/setup_live_task.ps1`：注册
  `LifeLogging-Live` 任务，每 2 分钟采集电脑活动 / 手机使用事件，并只把**今天**这一天的
  脱敏聚合 upsert 到 `/api/life`；Dawarich 位置、Gadgetbridge 手表、AI 平台账单每 15 分钟重采。
  不推进水位线、不调 AI 写日记，23:00 的 `LifeLogging-Daily` 仍是正式闭环。
- raw 归档默认不实时发：`publish_life_raw.py` 会调 LLM 翻译，而且实时发布会公开当前坐标。
  需要时给 live 任务加 `-RawMinutes 30`。
- 前端：最新一天是今天时显示 `TODAY · LIVE`，柱状 tooltip 追加 `· SO FAR`，单日详情标
  `TODAY · IN PROGRESS`；ticker 改成「Live aggregate every 2 minutes / Today is partial until
  the 23:00 close」。页面仍每 60 秒轮询。
- 实时数据会频繁改图：`LifeBrain` 重建加 90 秒节流，重建时保留当前选中的节点和镜头距离，
  拖拽 / 推镜期间不重建。
- `tools/verify-life.mjs` 的数据日期改成「上海今天」，并断言 `TODAY · LIVE` 与今天的
  tooltip 含 `SO FAR`。
- 已在本机验证：`LifeLogging-Live` 每 2 分钟运行，API 的 `updatedAt` 随之更新；
  用真实 CMS 数据截图确认页面显示 `TODAY · LIVE`、最后一天 `OCT 21: 3.8h`、tooltip
  `OCT 21 · SO FAR`，控制台零报错。

## fix: 35.2 — 2026-10-20

### 归档页：内容不满一屏时底部漏出 footer 反色条
- 根因是 `.page` 只按内容高度撑开：归档的 TASKS / 短日记 / 空状态比视口矮时，
  固定在底部的全局 footer 会从页面下方露出几十像素，首屏底部一直挂着一条
  白（暗色主题）/黑（浅色主题）的边，看起来像页脚错位。
- `.page` 增加 `min-height: 100vh`（并用 `100dvh` 覆盖移动端动态视口），
  抽屉在首屏完整盖住 footer，仍然只有滚到文档末尾的占位时才拉开。
- `tools/verify-life-archive.mjs` 增加断言：首屏 `.page` 底边不得短于视口；
  滚到页尾 footer 必须完整露出，且归档声明不被 footer 压住；手机同样检查。
- 顺手把 MOTION / PHONE 的均值线补上单位（`MEAN 74` → `MEAN 74 UNLOCKS`），
  避免把它误读成别的指标；AI 保持 `MEAN ¥x.xx`。

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
