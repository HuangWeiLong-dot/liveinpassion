# Image Showcase Website Specification

## 1. Concept & Vision

一个极简主义的图片展示网站，灵感来自日式美学中的"留白"概念。通过大量空白、精致的排版和微妙的交互，让图片本身成为焦点。整体感觉是安静、优雅、专注的。

## 2. Design Language

**Aesthetic Direction**: 日式极简主义 + 现代瑞士排版风格，强调空间感和视觉呼吸

**Color Palette**:
- Background: `#FAFAFA` (温暖的中性白)
- Text Primary: `#1A1A1A` (近黑)
- Text Secondary: `#888888` (柔和灰)
- Accent: `#2C2C2C` (深灰，用于hover状态)
- Border: `#E5E5E5` (极淡的分割线)

**Typography**:
- 标题: `Cormorant Garamond`, serif — 优雅、高对比度的衬线体
- 正文: `Inter`, sans-serif — 清晰、现代的无衬线体
- 字重: 300 (light) 用于正文, 500 用于标题

**Spatial System**:
- 基础间距单位: 8px
- 图片间距: 24px
- 页面边距: 64px (桌面端), 24px (移动端)
- 最大内容宽度: 1400px

**Motion Philosophy**:
- 所有动画都是微妙的、缓慢的，传达宁静感
- 图片hover: scale 1.02, 600ms cubic-bezier(0.23, 1, 0.32, 1)
- 页面加载: 图片依次淡入，间隔150ms，duration 800ms
- 滚动: 平滑滚动，图片在视口中时淡入

**Visual Assets**:
- 使用 Unsplash 的高质量免费图片
- 无装饰性图标，仅使用文字导航
- 图片保持原始比例，使用 CSS object-fit: cover

## 3. Layout & Structure

**Page Structure**:
1. **Header** — 左上角网站标题，极简导航
2. **Hero Section** — 一张大图展示，配合简短标语
3. **Gallery Grid** — 瀑布流/网格布局展示图片集
4. **Footer** — 简洁的版权信息

**Responsive Strategy**:
- Desktop (>1024px): 3列网格
- Tablet (768-1024px): 2列网格
- Mobile (<768px): 单列网格

**Visual Pacing**:
- Hero区域占用视口的80vh，给图片充分展示空间
- Gallery区域紧凑但有呼吸感

## 4. Features & Interactions

**Core Features**:
1. **图片网格展示** — 响应式瀑布流/网格布局
2. **图片hover效果** — 轻微放大 + 阴影
3. **灯箱查看** — 点击图片全屏查看
4. **平滑滚动** — 页面内滚动平滑
5. **懒加载** — 图片进入视口时才加载

**Interaction Details**:
- Hover: 图片轻微放大(scale 1.02)，添加柔和阴影
- Click: 打开灯箱模式，背景模糊，点击外部或按ESC关闭
- 灯箱内: 左右箭头导航，键盘方向键支持

**Edge Cases**:
- 图片加载失败: 显示优雅的占位符
- 空状态: 不适用（静态展示网站）

## 5. Component Inventory

**Header**:
- Default: 透明背景，黑色文字
- Scroll: 轻微背景模糊效果

**ImageCard**:
- Default: 图片保持比例，带极淡边框
- Hover: scale 1.02, box-shadow 增强
- Loading: 背景显示 #F0F0F0

**Lightbox**:
- Background: rgba(0,0,0,0.95) 背景模糊
- Image: 居中显示，最大90vh/90vw
- Controls: 左右箭头，关闭按钮，所有元素hover变白

**Footer**:
- 简洁版权信息，文字居中，与顶部呼应

## 6. Technical Approach

**Stack**: 纯 HTML + CSS + Vanilla JavaScript (无框架依赖)

**Key Implementation**:
- CSS Grid/Flexbox 实现响应式布局
- CSS Custom Properties 管理设计系统
- Intersection Observer API 实现懒加载和滚动动画
- 使用 sample images 从 picsum.photos

**File Structure**:
```
/image-showcase
  index.html    (单文件，包含所有HTML/CSS/JS)
```
