<script setup>
// 好友跑马灯（旧 index.html 的 createFloatingFriends + initFriendsScroll +
// scrollFriends + showFriendsScrollArrows，L6607-L6744）。
//
// 三处细节照搬：
//   1. 每个好友随机取一张照片当头像，**整场会话只随机一次**（KeepAlive 保证视图常驻，
//      与旧版"所有页面 DOM 常驻"一致；卡片不会因为你离开再回来就换头像）
//   2. 没有照片的好友（hanyong）显示 "?" 占位
//   3. 两端箭头按滚动位置显隐，阈值 10px；初始化时延迟 100ms 评估一次
//
// 与旧版的差异：头像用**压缩图**作为唯一来源（这是个几十像素的小圆头像，
// 拉原图纯浪费）。单级加载决定针对的是画廊里的照片，不含这种小图。
import { onActivated, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { friends } from '../data/friends.js';
import { CDN_BASE } from '../data/cdn.js';
import { loadImage } from '../composables/useImageLoader.js';

const router = useRouter();

// 每个好友随机取一张照片当头像。**必须只算一次**，所以用普通常量而不是 computed：
// computed 一旦被重新求值就会重新随机，头像会跳；旧版也是加载时定死的。
const cards = friends.map((friend) => {
  const photos = friend.photos || [];
  const pick = photos.length ? photos[Math.floor(Math.random() * photos.length)] : null;
  return {
    id: friend.id,
    name: friend.name,
    bio: friend.bio,
    photoCount: photos.length,
    // pick.src 本身就是 CDN 压缩图地址
    thumb: pick ? pick.src : null,
  };
});

const imgRefs = ref([]);
const scrollRef = ref(null);
const leftArrow = ref(null);
const rightArrow = ref(null);

function updateArrows() {
  requestAnimationFrame(() => {
    const el = scrollRef.value;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    const maxScroll = scrollWidth - clientWidth;
    leftArrow.value?.classList.toggle('hidden', scrollLeft <= 0);
    if (maxScroll <= 10) rightArrow.value?.classList.add('hidden');
    else rightArrow.value?.classList.toggle('hidden', scrollLeft >= maxScroll - 10);
  });
}

function scrollBy(distance) {
  scrollRef.value?.scrollBy({ left: distance, behavior: 'smooth' });
}

function openFriend(id) {
  router.push(`/friends/${id}`);
}

function loadThumbs() {
  imgRefs.value.forEach((img) => img && loadImage(img));
}

onMounted(() => {
  loadThumbs();
  scrollRef.value?.addEventListener('scroll', updateArrows);
  setTimeout(updateArrows, 100);
});

// 旧版每次导航到 GALLERY 页都会 showFriendsScrollArrows(true)：先把两个箭头恢复显示，
// 再按当前滚动位置重新评估。这里在每次激活时重做一次。
onActivated(() => {
  loadThumbs();
  leftArrow.value?.classList.remove('hidden');
  rightArrow.value?.classList.remove('hidden');
  updateArrows();
});

defineExpose({ scrollBy });
</script>

<template>
  <div class="gallery-friends-section">
    <h2 class="gallery-section-title">PERSONAL GALLERIES</h2>
    <div class="gallery-friends-container">
      <button class="scroll-arrow left" id="friendsScrollLeft" ref="leftArrow" @click="scrollBy(-300)">‹</button>
      <div class="gallery-friends-scroll" id="friendsScrollContainer" ref="scrollRef">
        <div class="gallery-friends-grid" id="friendsGridContainer">
          <div v-for="(card, index) in cards" :key="card.id" class="friend-card" @click="openFriend(card.id)">
            <div class="friend-avatar">
              <template v-if="card.thumb">
                <div class="skeleton-loader"></div>
                <img
                  :ref="(el) => { if (el) imgRefs[index] = el; }"
                  :data-src="card.thumb"
                  :alt="card.name"
                  class="blur-placeholder"
                >
              </template>
              <template v-else>
                <div class="skeleton-loader hidden"></div>
                <div class="friend-placeholder">?</div>
              </template>
            </div>
            <div class="friend-info">
              <h3 class="friend-name">{{ card.name }}</h3>
              <p v-if="card.bio" class="friend-bio">{{ card.bio }}</p>
              <div class="friend-photo-count">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <circle cx="8.5" cy="8.5" r="1.5"></circle>
                  <polyline points="21 15 16 10 5 21"></polyline>
                </svg>
                {{ card.photoCount }} photos
              </div>
            </div>
          </div>
        </div>
      </div>
      <button class="scroll-arrow right" id="friendsScrollRight" ref="rightArrow" @click="scrollBy(300)">›</button>
    </div>
  </div>
</template>
