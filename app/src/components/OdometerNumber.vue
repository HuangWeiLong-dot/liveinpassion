<script setup>
// 数字滚轮（odometer）。
//
// 每个位是一列 0–9，用 GSAP 把整列纵向滚到目标数字。相比 count-up 的
// "数字快速跳动"，滚轮的机械感更贴站点那套 Oswald + 方块的语言，
// 而且末位滚动幅度小、首位滚动幅度大，读起来像仪表而不是随机数。
//
// 两个 key 上的讲究：
//  - v-for 的 key 按"从右往左的位数"生成，而不是字符串下标。数字从 999
//    涨到 1,000 时，右边三位还是同一批 DOM，只有新增的千位是新元素 ——
//    否则整串会重新挂载，滚轮会从头再来一遍。
//  - 滚动状态挂在 DOM 的 data-digit / data-rank 上，而不是给每个位建
//    子组件：位数会变，动态 ref 数组对不上，查询属性反而稳。
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { gsap } from 'gsap';

const props = defineProps({
  value: { type: Number, default: 0 },
  /** 每次 +1 就重播一遍入场滚动（0 = 还没开始） */
  run: { type: Number, default: 0 },
  /** 整个数字的起始延迟（秒） */
  delay: { type: Number, default: 0 },
  reduced: { type: Boolean, default: false },
});

const rootRef = ref(null);

const formatted = computed(() => Number(props.value || 0).toLocaleString('en-US'));

// 位数从右往左编号：个位 rank 0，十位 rank 1 ……
// 分隔符（逗号）单独渲染，不参与滚动。
const tokens = computed(() => {
  const chars = [...formatted.value];
  let rank = chars.filter((c) => /\d/.test(c)).length;
  let sep = 0;
  return chars.map((ch) => {
    if (/\d/.test(ch)) {
      rank -= 1;
      return { type: 'digit', char: ch, digit: Number(ch), rank, key: `d${rank}` };
    }
    return { type: 'sep', char: ch, key: `s${sep++}` };
  });
});

function strips() {
  return rootRef.value ? Array.from(rootRef.value.querySelectorAll('.sn-strip')) : [];
}

function instant() {
  strips().forEach((el) => {
    gsap.killTweensOf(el);
    gsap.set(el, { yPercent: -Number(el.dataset.digit) * 10 });
  });
}

/**
 * 滚到目标位。
 * @param {boolean} restart true = 先回到 0 再滚（入场 / 重新进入页面）
 */
function roll(restart) {
  const els = strips();
  if (!els.length) return;
  if (props.reduced) {
    instant();
    return;
  }
  els.forEach((el) => {
    const digit = Number(el.dataset.digit);
    const rank = Number(el.dataset.rank);
    gsap.killTweensOf(el);
    if (restart) gsap.set(el, { yPercent: 0 });
    gsap.to(el, {
      yPercent: -digit * 10,
      duration: restart ? 1.25 : 0.75,
      ease: restart ? 'power4.out' : 'power3.out',
      // 个位先落、高位后落：读数从右往左稳定下来
      delay: restart ? props.delay + rank * 0.045 : 0,
    });
  });
}

onMounted(() => {
  if (props.reduced) instant();
  else if (props.run > 0) nextTick(() => roll(true));
});

watch(
  () => props.value,
  async () => {
    await nextTick();
    if (props.run > 0) roll(false);
  }
);

watch(
  () => props.run,
  async (run) => {
    if (run > 0) {
      await nextTick();
      roll(true);
    }
  }
);
</script>

<template>
  <span ref="rootRef" class="sn">
    <span class="sn-visual" aria-hidden="true">
      <template v-for="t in tokens" :key="t.key">
        <span v-if="t.type === 'sep'" class="sn-sep">{{ t.char }}</span>
        <span v-else class="sn-digit">
          <span class="sn-strip" :data-digit="t.digit" :data-rank="t.rank">
            <span v-for="n in 10" :key="n">{{ n - 1 }}</span>
          </span>
        </span>
      </template>
    </span>
    <span class="sn-sr">{{ formatted }}</span>
  </span>
</template>

<style scoped>
.sn {
  display: inline-flex;
  align-items: flex-end;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.sn-visual {
  display: inline-flex;
  align-items: flex-end;
}

/* 1ch = 该字体下 "0" 的宽度，正好是一位数字的宽度 */
.sn-digit {
  display: inline-block;
  width: 1.06ch;
  height: 1.08em;
  overflow: hidden;
  position: relative;
}

.sn-strip {
  display: block;
  will-change: transform;
}

.sn-strip > span {
  display: block;
  height: 1.08em;
  line-height: 1.08em;
  text-align: center;
}

.sn-sep {
  display: inline-block;
  width: 0.3em;
  height: 1.08em;
  line-height: 1.08em;
  text-align: center;
}

.sn-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
