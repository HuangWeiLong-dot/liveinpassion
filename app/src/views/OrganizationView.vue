<script setup>
// ORGANIZATION —— 一屏一页的演示型页面。
//
// 这一页和其它页面的根本区别：**它不滚动**。八块 .org-slide 全都绝对定位在同一块
// 视口里，任何时刻只有一块是可见的 —— 滚轮 / 点击 / 方向键 / 上下滑都是"翻一页"，
// 不是"滚一段"。所以不存在两屏同时出现在一个窗口里的情况。
//
// 几条不能破坏的约束：
//   · 只翻页、不滚动：.org-page 是 height: 100dvh + overflow: hidden，
//     文档不会被撑高，全局页脚这一页也不挂（App.vue 的 showGlobalFooter）。
//   · 切换是"旧的立刻消失 → 新的淡入"：旧面板用 gsap.set 在一帧内收掉，
//     新面板才淡入。绝不做交叉淡入，那会同时看到两页。
//   · 一次手势只翻一页：滚轮是连续事件流，靠 wheelLockUntil 压住。
//   · 内容必须装进一屏：字号用 vh 参与 clamp，短屏（<700px 高）会再收一档。
//
// 字体和全站同一套：Oswald（标题）/ Poppins（正文）/ JetBrains Mono（标签），
// 没有描边字、没有第三种字体。
import { nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import { gsap } from 'gsap';
import { useBrandOverlay } from '../composables/useBrandOverlay.js';

const { visible: brandVisible } = useBrandOverlay();

const REDUCED = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const SLIDES = 8;
const LAST = SLIDES - 1;
const SWITCH_MS = 0.34;
// 一次手势的冷却：触控板一划会发几十个 wheel 事件，不压住会连翻好几页
const LOCK_MS = 620;

const index = ref(0);

const stageRef = ref(null);
const heroRef = ref(null);

let panels = [];
let wheelLockUntil = 0;
let introStarted = false;
let introTween = null;
let slideTween = null;
let activeNow = false;
let mountedAt = 0;
let introTimer = 0;
let firstActivation = true;
let touchStartY = 0;
let touchStartX = 0;

const pad = (n) => String(n).padStart(2, '0');

// ── 翻页 ────────────────────────────────────────────────────────────────

function setupPanels() {
  if (!stageRef.value) return;
  panels = Array.from(stageRef.value.querySelectorAll('.org-slide'));
}

function clamp(n) {
  return Math.max(0, Math.min(LAST, n));
}

// ── 装得下（兜底）──────────────────────────────────────────────────────
// 版面本身按视口算字号，常见窗口都装得下。但极矮的窗口（手机横屏、分屏、
// 超宽扁窗口）没有哪种字号能塞进去 —— 这里按需把内容整体缩一点，
// 保证它永远落在 .org-slide 的 padding 盒里：既不会顶到固定头部的导航栏，
// 也不会被 overflow: hidden 裁掉。缩放用 transform，不占布局，不会引出滚动。
function fitSlides() {
  panels.forEach((el) => {
    const inner = el.querySelector('.org-chapter, .org-hero__inner, .org-outro__inner');
    if (!inner) return;
    const cs = getComputedStyle(el);
    const avail = el.clientHeight
      - parseFloat(cs.paddingTop || 0)
      - parseFloat(cs.paddingBottom || 0);
    const need = inner.offsetHeight;
    if (!(avail > 0) || !(need > 0)) return;
    const scale = Math.min(1, avail / need);
    // 回到 1 时清掉内联样式，别给正常窗口留下亚像素模糊
    inner.style.transform = scale > 0.995 ? '' : `scale(${scale})`;
  });
}

let fitTimer = 0;
function scheduleFit() {
  clearTimeout(fitTimer);
  fitTimer = setTimeout(fitSlides, 120);
}

/**
 * 切到第 next 块。
 * @param {number} next 目标下标
 * @param {number} dir 1 = 往下 / -1 = 往上（决定新页从哪边淡进来）
 * @param {{ animate?: boolean, silent?: boolean }} [opts]
 */
function show(next, dir = 1, { animate = true, silent = false } = {}) {
  if (!panels.length) setupPanels();
  const target = clamp(next);
  if (target === index.value) return;

  const prevEl = panels[index.value];
  const nextEl = panels[target];
  if (!nextEl) return;

  // 旧的一帧内收掉 —— 这是"两页不能同时出现"的保证
  if (prevEl) gsap.set(prevEl, { autoAlpha: 0, y: 0 });

  slideTween?.kill();
  if (!animate || REDUCED) {
    gsap.set(nextEl, { autoAlpha: 1, y: 0 });
  } else {
    slideTween = gsap.fromTo(
      nextEl,
      { autoAlpha: 0, y: dir > 0 ? 30 : -30 },
      { autoAlpha: 1, y: 0, duration: SWITCH_MS, ease: 'power2.out' }
    );
  }

  index.value = target;
  if (!silent) wheelLockUntil = performance.now() + LOCK_MS;
}

function go(dir) {
  if (performance.now() < wheelLockUntil) return;
  const target = clamp(index.value + dir);
  if (target === index.value) return;
  show(target, dir);
}

function jumpTo(i) {
  const target = clamp(i);
  if (target === index.value) return;
  show(target, target > index.value ? 1 : -1);
}

// ── 输入：滚轮 / 键盘 / 点击 / 触摸 ──────────────────────────────────────

function onWheel(e) {
  // 这一页没有可滚动的内容，把默认滚动整条拦掉
  if (e.cancelable) e.preventDefault();
  if (Math.abs(e.deltaY) < 6) return;
  go(e.deltaY > 0 ? 1 : -1);
}

function onKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

  const k = e.key;
  if (k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Spacebar') {
    e.preventDefault();
    go(1);
  } else if (k === 'ArrowUp' || k === 'PageUp') {
    e.preventDefault();
    go(-1);
  } else if (k === 'Home') {
    e.preventDefault();
    jumpTo(0);
  } else if (k === 'End') {
    e.preventDefault();
    jumpTo(LAST);
  }
}

function onStageClick(e) {
  // 链接 / 按钮 / 刚拉过选区：都不算"翻页"
  if (e.target.closest('a, button')) return;
  if (String(window.getSelection?.() || '').length) return;
  go(1);
}

function onTouchStart(e) {
  const t = e.touches[0];
  if (!t) return;
  touchStartY = t.clientY;
  touchStartX = t.clientX;
}

function onTouchEnd(e) {
  const t = e.changedTouches[0];
  if (!t) return;
  const dy = touchStartY - t.clientY;
  const dx = touchStartX - t.clientX;
  // 竖向滑动足够长、且比横向明显，才算翻页（否则是横向手势，忽略）
  if (Math.abs(dy) < 42 || Math.abs(dy) < Math.abs(dx)) return;
  go(dy > 0 ? 1 : -1);
}

function attach() {
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKey);
  if (stageRef.value) {
    stageRef.value.addEventListener('touchstart', onTouchStart, { passive: true });
    stageRef.value.addEventListener('touchend', onTouchEnd, { passive: true });
  }
}

function detach() {
  window.removeEventListener('wheel', onWheel);
  window.removeEventListener('keydown', onKey);
  if (stageRef.value) {
    stageRef.value.removeEventListener('touchstart', onTouchStart);
    stageRef.value.removeEventListener('touchend', onTouchEnd);
  }
}

// ── 首屏入场 ────────────────────────────────────────────────────────────

function heroItems() {
  return heroRef.value ? heroRef.value.querySelectorAll('[data-intro]') : [];
}

function primeIntro() {
  if (REDUCED || !heroRef.value) return;
  gsap.set(heroItems(), { autoAlpha: 0, y: 30 });
}

function playIntro() {
  if (introStarted || !activeNow || !heroRef.value) return;
  introStarted = true;
  const items = heroItems();
  if (REDUCED) {
    gsap.set(items, { clearProps: 'all' });
    return;
  }
  introTween = gsap.to(items, {
    y: 0,
    autoAlpha: 1,
    duration: 1.1,
    stagger: 0.1,
    ease: 'power3.out',
  });
}

function scheduleIntro() {
  if (introStarted || !activeNow || brandVisible.value) return;
  clearTimeout(introTimer);
  // 站内导航进来：转场板子在新页挂载后还要 ~380ms 才滑走，早演等于白演
  const wait = Math.max(0, 420 - (performance.now() - mountedAt));
  introTimer = setTimeout(() => {
    introTimer = 0;
    if (activeNow && !brandVisible.value) playIntro();
  }, wait);
}

// ── 生命周期 ────────────────────────────────────────────────────────────

onMounted(async () => {
  mountedAt = performance.now();
  activeNow = true;
  await nextTick();
  setupPanels();
  // 首屏直接落位，不演翻页（入场交给 primeIntro / playIntro）
  if (panels[0]) gsap.set(panels[0], { autoAlpha: 1, y: 0 });
  fitSlides();
  // 字体是后到的，量高度要等它落定
  document.fonts?.ready.then(fitSlides).catch(() => {});
  window.addEventListener('resize', scheduleFit);
  attach();
  primeIntro();
  scheduleIntro();
});

onActivated(() => {
  // 首挂载时 onMounted 与 onActivated 会各来一次，第一次交给 onMounted
  if (firstActivation) {
    firstActivation = false;
    return;
  }
  activeNow = true;
  mountedAt = performance.now();
  attach();
  nextTick(() => {
    setupPanels();
    // 回到这一页永远从第一屏开始（这一页没有滚动位置可恢复）
    gsap.set(panels, { autoAlpha: 0, y: 0 });
    index.value = 0;
    if (panels[0]) gsap.set(panels[0], { autoAlpha: 1, y: 0 });
    fitSlides();
    if (!introStarted) scheduleIntro();
  });
});

onDeactivated(() => {
  activeNow = false;
  detach();
  clearTimeout(introTimer);
});

onBeforeUnmount(() => {
  activeNow = false;
  detach();
  window.removeEventListener('resize', scheduleFit);
  clearTimeout(fitTimer);
  introTween?.kill();
  slideTween?.kill();
  introTween = null;
  slideTween = null;
  clearTimeout(introTimer);
});

// 品牌遮罩撤掉之后再演首屏
watch(brandVisible, (v) => {
  if (!v) scheduleIntro();
});
</script>

<template>
  <main class="page active org-page">
    <!-- 舞台：所有屏都叠在这里，任何时刻只有一块可见 -->
    <div ref="stageRef" class="org-stage" @click="onStageClick">
      <!-- 00 · 封面 -->
      <section ref="heroRef" class="org-slide org-slide--hero" :class="{ 'is-current': index === 0 }" :aria-hidden="index !== 0">
        <div class="org-hero__inner">
          <p class="org-eyebrow" data-intro>
            <span class="org-mark" />LIVEINPASSION <span class="org-slash">/</span> ORGANIZATION
          </p>
          <h1 class="org-hero__title">
            <span data-intro>WHAT IS</span>
            <span data-intro>LIVE IN PASSION?</span>
          </h1>
          <p class="org-hero__sub" data-intro>
            Not a company yet. A person, an archive, and an intention —
            to live in passion, and to make a life legible to the person living it.
          </p>
        </div>

        <div class="org-cue" :class="{ 'is-gone': index > 0 }" aria-hidden="true">
          <span>SCROLL · CLICK · SWIPE</span>
          <i />
        </div>
      </section>

      <!-- 01 · 名字 -->
      <section class="org-slide" :class="{ 'is-current': index === 1 }" :aria-hidden="index !== 1">
        <div class="org-chapter">
          <div class="org-chapter__meta">
            <span>01</span>
            <span>THE NAME</span>
          </div>
          <div class="org-chapter__head">
            <h2 class="org-title">WE ARE NAMED<br />AFTER A VERB.</h2>
          </div>
          <div class="org-chapter__copy">
            <p class="org-lead">
              LIVE IN PASSION is not a brand statement. It is an instruction,
              and a difficult one.
            </p>
            <p>
              Most people do not choose a life; they inherit one, and then defend it.
              Passion, here, does not mean enthusiasm. It means the state of being
              wholly occupied — the opposite of waiting.
            </p>
            <dl class="org-defs">
              <div>
                <dt>live</dt>
                <dd>verb · to be alive, and to know it.</dd>
              </div>
              <div>
                <dt>passion</dt>
                <dd>noun · to be wholly occupied by what you are doing.</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <!-- 02 · 主张 -->
      <section class="org-slide" :class="{ 'is-current': index === 2 }" :aria-hidden="index !== 2">
        <div class="org-chapter">
          <div class="org-chapter__meta">
            <span>02</span>
            <span>WHAT WE BELIEVE</span>
          </div>
          <div class="org-chapter__head">
            <h2 class="org-title">IT COMES DOWN<br />TO THREE THINGS.</h2>
          </div>
          <div class="org-chapter__copy">
            <ul class="org-rules">
              <li>
                <span class="org-rules__n">01</span>
                <div>
                  <h3>Passion is a practice, not a mood.</h3>
                  <p>A mood arrives. A practice is chosen again every morning, usually before you feel like it.</p>
                </div>
              </li>
              <li>
                <span class="org-rules__n">02</span>
                <div>
                  <h3>A life is only legible in full.</h3>
                  <p>Highlights compress. The interesting part is the boring Tuesday and the unlogged hours.</p>
                </div>
              </li>
              <li>
                <span class="org-rules__n">03</span>
                <div>
                  <h3>What you live, you own.</h3>
                  <p>The record of a life belongs to the person who lived it. It is not inventory, and it is not for sale.</p>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <!-- 03 · 第一个项目 -->
      <section class="org-slide" :class="{ 'is-current': index === 3 }" :aria-hidden="index !== 3">
        <div class="org-chapter">
          <div class="org-chapter__meta">
            <span>03</span>
            <span>OPEN SOURCE LIFE</span>
          </div>
          <div class="org-chapter__head">
            <h2 class="org-title">THE FIRST PROJECT<br />IS AN ARCHIVE.</h2>
          </div>
          <div class="org-chapter__copy">
            <p class="org-lead">
              Open Source Life is the working name of the stack behind
              <router-link to="/life" class="org-inline-link">/life</router-link> —
              a continuous record of one life, collected on hardware its subject owns.
            </p>
            <ul class="org-channels">
              <li><span>DESKTOP</span><em>windows, apps, sites, keyboard time</em></li>
              <li><span>PHONE</span><em>screen time, apps, unlocks</em></li>
              <li><span>WATCH</span><em>steps, heart rate, sleep, workouts</em></li>
              <li><span>PLACES</span><em>GPS traces, transport modes</em></li>
              <li><span>WRITING</span><em>journal, notes, tasks, weekly reviews</em></li>
            </ul>
            <div class="org-links">
              <router-link to="/life" class="org-link">OPEN THE ARCHIVE →</router-link>
              <a
                href="https://github.com/HuangWeiLong-dot"
                class="org-link"
                target="_blank"
                rel="noopener noreferrer"
              >SOURCE →</a>
            </div>
          </div>
        </div>
      </section>

      <!-- 04 · 记录 → 模型 -->
      <section class="org-slide" :class="{ 'is-current': index === 4 }" :aria-hidden="index !== 4">
        <div class="org-chapter">
          <div class="org-chapter__meta">
            <span>04</span>
            <span>FROM RECORD TO MODEL</span>
          </div>
          <div class="org-chapter__head">
            <h2 class="org-title">A RECORD<br />BECOMES A MODEL.</h2>
          </div>
          <div class="org-chapter__copy">
            <p class="org-lead">
              Once a life is recorded continuously, the interesting question stops
              being what happened and becomes what tends to happen next.
            </p>
            <ol class="org-steps">
              <li>
                <span>DESCRIBE</span>
                <p>Reduce a day to its structure: what it was made of, in what order, for how long.</p>
              </li>
              <li>
                <span>COMPARE</span>
                <p>Put days against each other until patterns survive — weekly rhythms, seasonal drift, the conditions under which a good day happens.</p>
              </li>
              <li>
                <span>ANTICIPATE</span>
                <p>Learn a model of one person's behaviour — not people in general — and test whether it can say what they will do next.</p>
              </li>
            </ol>
          </div>
        </div>
      </section>

      <!-- 05 · 公司 -->
      <section class="org-slide" :class="{ 'is-current': index === 5 }" :aria-hidden="index !== 5">
        <div class="org-chapter">
          <div class="org-chapter__meta">
            <span>05</span>
            <span>THE COMPANY</span>
          </div>
          <div class="org-chapter__head">
            <h2 class="org-title">EVENTUALLY,<br />A COMPANY.</h2>
            <p class="org-head-note">
              Today: one person and an archive.<br />
              Next: a company built around the personal model.
            </p>
          </div>
          <div class="org-chapter__copy">
            <p class="org-lead">
              Not to sell data, and not another dashboard. To make a model of a single
              life and give it back to the person living it — as foresight, not surveillance.
            </p>
            <ul class="org-rules org-rules--tight">
              <li>
                <span class="org-rules__n">01</span>
                <div>
                  <h3>The model belongs to its subject.</h3>
                  <p>You can inspect it, export it, or delete it.</p>
                </div>
              </li>
              <li>
                <span class="org-rules__n">02</span>
                <div>
                  <h3>Open by default.</h3>
                  <p>The format, the pipeline, and the analysis stay open.</p>
                </div>
              </li>
              <li>
                <span class="org-rules__n">03</span>
                <div>
                  <h3>One life first.</h3>
                  <p>No inference about anyone who did not opt in, and no population claims from a sample of one.</p>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <!-- 06 · 路线 -->
      <section class="org-slide" :class="{ 'is-current': index === 6 }" :aria-hidden="index !== 6">
        <div class="org-chapter">
          <div class="org-chapter__meta">
            <span>06</span>
            <span>ROADMAP</span>
          </div>
          <div class="org-chapter__head">
            <h2 class="org-title">WHAT COMES<br />NEXT.</h2>
          </div>
          <div class="org-chapter__copy">
            <ol class="org-road">
              <li>
                <span class="org-road__year">2025</span>
                <div>
                  <h3>The archive</h3>
                  <p>Continuous capture, a public dashboard, an open pipeline.</p>
                </div>
                <span class="org-road__state is-now">ONGOING</span>
              </li>
              <li>
                <span class="org-road__year">2026</span>
                <div>
                  <h3>The model</h3>
                  <p>A personal behavioural model with a real evaluation: does it predict the next hour better than a calendar?</p>
                </div>
                <span class="org-road__state">NEXT</span>
              </li>
              <li>
                <span class="org-road__year">2027</span>
                <div>
                  <h3>The company</h3>
                  <p>A small team, a first product, and a reason for the archive to exist beyond itself.</p>
                </div>
                <span class="org-road__state">PLANNED</span>
              </li>
              <li>
                <span class="org-road__year">SOMEDAY</span>
                <div>
                  <h3>The protocol</h3>
                  <p>An open way to carry a life record between systems, without asking permission.</p>
                </div>
                <span class="org-road__state">OPEN</span>
              </li>
            </ol>
          </div>
        </div>
      </section>

      <!-- 07 · 结尾 -->
      <section class="org-slide org-slide--outro" :class="{ 'is-current': index === 7 }" :aria-hidden="index !== 7">
        <div class="org-outro__inner">
          <p class="org-eyebrow">
            <span class="org-mark" />07 <span class="org-slash">/</span> CLOSING
          </p>
          <h2 class="org-outro__title">
            THE ARCHIVE IS PUBLIC.<br />
            THE COMPANY IS NOT YET.
          </h2>
          <p class="org-outro__sub">
            If you want to argue with this, build on it, or fund it — the door is open.
          </p>
          <div class="org-cta">
            <router-link to="/life" class="org-cta__item">OPEN THE ARCHIVE</router-link>
            <a
              href="https://github.com/HuangWeiLong-dot"
              class="org-cta__item"
              target="_blank"
              rel="noopener noreferrer"
            >GITHUB</a>
            <a href="mailto:3571676852@qq.com" class="org-cta__item">EMAIL</a>
          </div>
        </div>
      </section>
    </div>

    <!-- 右边缘：页码 / 可直接点跳 -->
    <aside class="org-rail" aria-label="Sections">
      <span class="org-rail__now">{{ pad(index) }}</span>
      <div class="org-rail__ticks">
        <button
          v-for="n in SLIDES"
          :key="n"
          type="button"
          class="org-rail__tick"
          :class="{ 'is-active': index === n - 1 }"
          :aria-label="`Slide ${n - 1}`"
          @click.stop="jumpTo(n - 1)"
        />
      </div>
      <span class="org-rail__end">{{ pad(SLIDES - 1) }}</span>
    </aside>
  </main>
</template>

<style scoped>
/* 版面语言完全沿用站内：Oswald 大写标题、Poppins 正文、JetBrains Mono 标签、
   1px 发丝线、纯 --bg 底色（没有点云、没有渐变）。 */

.org-page {
  --org-pad-x: clamp(20px, 7vw, 120px);
  /* 上边距的下限必须高过固定头部（24px 内边距 + 一行 logo ≈ 89px）：
     每章顶部那行页码 / 章名就贴着这条线，低了会钻到导航栏底下。 */
  --org-pad-y: clamp(96px, 11vh, 116px);
  --org-pad-b: clamp(40px, 7vh, 80px);
  --org-mono: 'JetBrains Mono', ui-monospace, monospace;
  position: relative;
  height: 100vh;
  height: 100dvh;
  min-height: 0;
  /* 这一页不滚动：没有内容会把文档撑高，翻页全靠手势 */
  overflow: hidden;
  background: var(--bg);
}

/* ── 舞台 ──────────────────────────────────────────────────────────────── */
.org-stage {
  position: absolute;
  inset: 0;
  z-index: 1;
}

/* 每屏都铺满舞台、叠在一起；默认不可见，只有翻到的那一屏由 GSAP 点亮。
   visibility 也一起门控：挡住屏幕外那几屏里的链接被 Tab 聚焦。 */
.org-slide {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  padding: var(--org-pad-y) var(--org-pad-x) var(--org-pad-b);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  overflow: hidden;
}

.org-slide.is-current {
  pointer-events: auto;
}

/* ── 封面 ──────────────────────────────────────────────────────────────── */
.org-slide--hero {
  justify-content: center;
  text-align: center;
}

.org-hero__inner {
  max-width: 1180px;
}

.org-eyebrow {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.7em;
  font-family: var(--org-mono);
  font-size: 0.6rem;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

/* 方块，不是圆点 —— 站里的记号都是方的（光标、分隔、磁贴） */
.org-mark {
  width: 5px;
  height: 5px;
  background: var(--text-primary);
}

.org-slash {
  opacity: 0.45;
}

.org-hero__title {
  margin: clamp(18px, 3.2vh, 34px) 0 0;
  display: grid;
  gap: 0.02em;
  font-family: 'Oswald', sans-serif;
  font-weight: 600;
  font-size: clamp(2.4rem, min(9vw, 11.5vh), 8rem);
  line-height: 0.9;
  letter-spacing: -0.012em;
  text-transform: uppercase;
  color: var(--text-primary);
}

.org-hero__sub {
  max-width: 46ch;
  margin: clamp(20px, 3.4vh, 38px) auto 0;
  font-size: clamp(0.86rem, min(1.05vw, 1.9vh), 1.02rem);
  line-height: 1.7;
  color: var(--text-secondary);
}

/* 翻页提示 */
.org-cue {
  position: absolute;
  left: 50%;
  bottom: clamp(24px, 4.5vh, 44px);
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  font-family: var(--org-mono);
  font-size: 0.52rem;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--text-secondary);
  transition: opacity 0.4s ease;
}

.org-cue.is-gone {
  opacity: 0;
}

.org-cue i {
  display: block;
  width: 1px;
  height: clamp(28px, 5vh, 44px);
  background: linear-gradient(var(--text-secondary), transparent);
  transform-origin: top;
  animation: org-cue 2.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

@keyframes org-cue {
  0% { transform: scaleY(0); opacity: 0; }
  25% { opacity: 1; }
  60% { transform: scaleY(1); opacity: 1; }
  100% { transform: scaleY(1); opacity: 0; }
}

/* ── 章节 ──────────────────────────────────────────────────────────────── */
.org-chapter {
  width: 100%;
  max-width: 1480px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
  column-gap: clamp(24px, 5.5vw, 104px);
  align-items: start;
}

/* ⚠ 这块必须是 div，不能是 <header> —— main.css 里有一条全站的
   `header { position: fixed; top: 0; z-index: 100; padding: 24px 64px }`，
   用 header 的话每一章的页码（左上）和章名（右上）都会被钉到视口顶部、压在导航栏上。 */
.org-chapter__meta {
  grid-column: 1 / -1;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  border-top: 1px solid var(--border);
  padding-top: 13px;
  margin-bottom: clamp(22px, 5vh, 54px);
  font-family: var(--org-mono);
  font-size: 0.56rem;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.org-title {
  margin: 0;
  font-family: 'Oswald', sans-serif;
  font-weight: 600;
  font-size: clamp(1.7rem, min(4.2vw, 5.4vh), 3.9rem);
  line-height: 0.98;
  letter-spacing: -0.01em;
  text-transform: uppercase;
  color: var(--text-primary);
}

.org-head-note {
  margin-top: clamp(16px, 3vh, 30px);
  font-family: var(--org-mono);
  font-size: 0.58rem;
  line-height: 1.95;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

/* ── 正文 ──────────────────────────────────────────────────────────────── */
.org-chapter__copy {
  max-width: 62ch;
}

.org-chapter__copy p {
  margin: 0 0 0.9em;
  font-size: clamp(0.83rem, min(0.95vw, 1.7vh), 1rem);
  line-height: 1.72;
  color: var(--text-secondary);
}

.org-chapter__copy p:last-child {
  margin-bottom: 0;
}

.org-lead {
  font-size: clamp(0.92rem, min(1.12vw, 2vh), 1.16rem) !important;
  line-height: 1.6 !important;
  color: var(--text-primary) !important;
}

.org-inline-link {
  color: var(--text-primary);
  text-decoration: none;
  border-bottom: 1px solid var(--border);
  transition: border-color 0.25s ease;
}

.org-inline-link:hover {
  border-color: var(--text-primary);
}

/* 词条 */
.org-defs {
  margin: clamp(18px, 3vh, 32px) 0 0;
  display: grid;
  gap: 12px;
}

.org-defs > div {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 16px;
  align-items: baseline;
  border-top: 1px solid var(--border);
  padding-top: 10px;
}

.org-defs dt {
  font-family: 'Oswald', sans-serif;
  font-size: 0.98rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-primary);
}

.org-defs dd {
  margin: 0;
  font-family: var(--org-mono);
  font-size: 0.62rem;
  line-height: 1.75;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
}

/* 三原则 / 三承诺 */
.org-rules {
  list-style: none;
  margin: 0;
  padding: 0;
}

.org-rules li {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: 12px;
  border-top: 1px solid var(--border);
  padding: clamp(12px, 1.8vh, 18px) 0;
}

.org-rules li:first-child {
  border-top: 0;
  padding-top: 0;
}

.org-rules__n {
  font-family: var(--org-mono);
  font-size: 0.56rem;
  letter-spacing: 0.16em;
  color: var(--text-secondary);
  padding-top: 0.35em;
}

.org-rules h3 {
  margin: 0 0 0.35em;
  font-family: 'Oswald', sans-serif;
  font-weight: 500;
  font-size: clamp(0.92rem, min(1.2vw, 1.95vh), 1.18rem);
  letter-spacing: 0.01em;
  text-transform: uppercase;
  color: var(--text-primary);
}

.org-rules p {
  margin: 0 !important;
  font-size: clamp(0.8rem, min(0.9vw, 1.6vh), 0.94rem) !important;
  line-height: 1.68 !important;
}

.org-rules--tight li {
  padding: clamp(10px, 1.5vh, 15px) 0;
}

/* 采集通道 */
.org-channels {
  list-style: none;
  margin: clamp(16px, 2.8vh, 28px) 0 0;
  padding: 0;
}

.org-channels li {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  gap: 16px;
  align-items: baseline;
  border-top: 1px solid var(--border);
  padding: clamp(7px, 1.1vh, 10px) 0;
}

.org-channels span {
  font-family: var(--org-mono);
  font-size: 0.56rem;
  letter-spacing: 0.2em;
  color: var(--text-primary);
}

.org-channels em {
  font-style: normal;
  font-size: clamp(0.76rem, min(0.85vw, 1.5vh), 0.86rem);
  color: var(--text-secondary);
}

.org-links {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 28px;
  margin-top: clamp(16px, 2.8vh, 30px);
}

.org-link {
  font-family: var(--org-mono);
  font-size: 0.58rem;
  letter-spacing: 0.2em;
  text-decoration: none;
  color: var(--text-primary);
  border-bottom: 1px solid var(--text-primary);
  padding-bottom: 4px;
  transition: opacity 0.25s ease;
}

.org-link:hover {
  opacity: 0.55;
}

/* 三步 */
.org-steps {
  list-style: none;
  margin: clamp(16px, 2.8vh, 28px) 0 0;
  padding: 0;
}

.org-steps li {
  border-top: 1px solid var(--border);
  padding: clamp(10px, 1.6vh, 15px) 0;
}

.org-steps span {
  display: block;
  margin-bottom: 0.35em;
  font-family: var(--org-mono);
  font-size: 0.56rem;
  letter-spacing: 0.24em;
  color: var(--text-primary);
}

.org-steps p {
  margin: 0 !important;
  font-size: clamp(0.8rem, min(0.9vw, 1.6vh), 0.94rem) !important;
  line-height: 1.68 !important;
}

/* 路线图 */
.org-road {
  list-style: none;
  margin: 0;
  padding: 0;
}

.org-road li {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) 74px;
  gap: 18px;
  align-items: start;
  border-top: 1px solid var(--border);
  padding: clamp(10px, 1.7vh, 17px) 0;
}

.org-road li:first-child {
  border-top: 0;
  padding-top: 0;
}

.org-road__year {
  font-family: 'Oswald', sans-serif;
  font-size: 0.98rem;
  letter-spacing: 0.04em;
  color: var(--text-primary);
}

.org-road h3 {
  margin: 0 0 0.3em;
  font-family: 'Oswald', sans-serif;
  font-weight: 500;
  font-size: 0.94rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-primary);
}

.org-road p {
  margin: 0 !important;
  font-size: clamp(0.78rem, min(0.88vw, 1.55vh), 0.9rem) !important;
  line-height: 1.62 !important;
}

.org-road__state {
  justify-self: end;
  font-family: var(--org-mono);
  font-size: 0.5rem;
  letter-spacing: 0.16em;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  padding: 3px 6px;
  white-space: nowrap;
}

.org-road__state.is-now {
  color: var(--bg);
  background: var(--text-primary);
  border-color: var(--text-primary);
}

/* ── 结尾 ──────────────────────────────────────────────────────────────── */
.org-slide--outro {
  justify-content: center;
  text-align: center;
}

.org-outro__inner {
  max-width: 1180px;
}

.org-outro__title {
  margin: clamp(18px, 3.4vh, 34px) 0 0;
  font-family: 'Oswald', sans-serif;
  font-weight: 600;
  font-size: clamp(1.6rem, min(5.4vw, 6.6vh), 4.9rem);
  line-height: 0.98;
  letter-spacing: -0.008em;
  text-transform: uppercase;
  color: var(--text-primary);
}

.org-outro__sub {
  max-width: 42ch;
  margin: clamp(18px, 3.2vh, 30px) auto 0;
  font-size: clamp(0.86rem, min(1vw, 1.8vh), 1rem);
  line-height: 1.7;
  color: var(--text-secondary);
}

.org-cta {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: clamp(22px, 4vh, 40px);
}

.org-cta__item {
  font-family: var(--org-mono);
  font-size: 0.58rem;
  letter-spacing: 0.22em;
  text-decoration: none;
  color: var(--text-primary);
  border: 1px solid var(--border);
  padding: 12px 19px;
  transition: background-color 0.25s ease, color 0.25s ease, border-color 0.25s ease;
}

.org-cta__item:hover {
  background: var(--text-primary);
  color: var(--bg);
  border-color: var(--text-primary);
}

/* ── 右边缘页码 ────────────────────────────────────────────────────────── */
.org-rail {
  position: fixed;
  right: clamp(14px, 2vw, 30px);
  top: 50%;
  transform: translateY(-50%);
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  font-family: var(--org-mono);
  font-size: 0.52rem;
  letter-spacing: 0.16em;
  color: var(--text-secondary);
}

.org-rail__ticks {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.org-rail__tick {
  width: 14px;
  height: 2px;
  padding: 0;
  border: 0;
  background: var(--border);
  cursor: pointer;
  transition: background-color 0.25s ease, width 0.25s ease;
}

.org-rail__tick:hover {
  background: var(--text-secondary);
}

.org-rail__tick.is-active {
  width: 22px;
  background: var(--text-primary);
}

.org-rail__now {
  color: var(--text-primary);
}

/* ── 响应式 ────────────────────────────────────────────────────────────── */

@media (max-width: 980px) {
  .org-chapter {
    grid-template-columns: minmax(0, 1fr);
    row-gap: clamp(16px, 3vh, 30px);
  }

  .org-chapter__meta {
    margin-bottom: clamp(16px, 3vh, 28px);
  }

  .org-rail {
    display: none;
  }
}

/* 手机上底部有一条固定的 MobileDock（距底 16px + 52px 高），
   正文必须停在它上面，不能钻到那条汉堡底下。 */
@media (max-width: 1024px) {
  .org-page {
    --org-pad-b: clamp(84px, 11vh, 104px);
  }
}

@media (max-width: 640px) {
  .org-page {
    --org-pad-y: clamp(96px, 11vh, 104px);
  }

  .org-hero__title {
    font-size: clamp(2.1rem, min(12vw, 9.4vh), 3.4rem);
  }

  /* 手机是单列，内容最长的那几屏（04 三步、06 路线图）离顶破一屏很近。
     这里统一收一档字号和行距，让它们自己就装得下，而不是靠缩放兜底。 */
  .org-chapter {
    row-gap: clamp(10px, 2vh, 18px);
  }

  .org-chapter__meta {
    padding-top: 10px;
    margin-bottom: clamp(12px, 2.4vh, 22px);
  }

  .org-title {
    font-size: clamp(1.35rem, min(10.5vw, 5.4vh), 2.2rem);
  }

  .org-chapter__copy p {
    font-size: clamp(0.75rem, min(3.3vw, 1.6vh), 0.9rem);
    line-height: 1.62;
  }

  .org-lead {
    font-size: clamp(0.82rem, min(3.7vw, 1.85vh), 1rem) !important;
    line-height: 1.5 !important;
  }

  .org-road li {
    padding: clamp(7px, 1.2vh, 11px) 0;
    gap: 10px;
  }

  .org-road h3 {
    font-size: 0.86rem;
  }

  .org-road__year {
    font-size: 0.86rem;
  }

  .org-road p {
    font-size: clamp(0.72rem, min(3.2vw, 1.45vh), 0.84rem) !important;
    line-height: 1.5 !important;
  }

  .org-road__state {
    font-size: 0.46rem;
    padding: 2px 5px;
  }

  .org-steps li {
    padding: clamp(8px, 1.3vh, 12px) 0;
  }

  .org-defs > div {
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
  }

  .org-rules li {
    grid-template-columns: 30px minmax(0, 1fr);
  }

  .org-road li {
    grid-template-columns: 60px minmax(0, 1fr);
    gap: 12px;
  }

  .org-road__state {
    grid-column: 1 / -1;
    justify-self: start;
  }

  .org-channels li {
    grid-template-columns: minmax(0, 1fr);
    gap: 3px;
  }

  .org-cta {
    flex-direction: column;
    align-items: stretch;
  }

  .org-cta__item {
    text-align: center;
  }
}

/* 短屏（笔记本 13寸 / iPhone SE 横竖）：一屏装不下时再收一档，
   并把第 03 章的采集清单让位给正文 —— 这一页不能靠滚动补救。 */
/* 矮屏：网底那条 MobileDock 让位不下 24px 的收边，只有宽屏（没有 dock）才收到底 */
@media (max-height: 700px) and (min-width: 1025px) {
  .org-page {
    --org-pad-b: 24px;
  }
}

@media (max-height: 700px) {
  .org-channels {
    display: none;
  }

  .org-defs {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .org-cue i {
    animation: none;
    transform: scaleY(1);
  }
}
</style>
