<script setup>
// 全局外壳。这里的每个组件对应旧版"所有页面之外"的那部分 DOM：
// 头部、加载遮罩、灯箱、音乐播放器、主题按钮、作者区。
//
// 两个关键点：
//  1. <keep-alive> —— 旧版所有页面的 DOM 常驻、只切 .active，所以首页随机布局、
//     好友随机头像、ME 相册的月份缓存、"只创建一次"的三个 iframe 才能保持稳定。
//     不用 keep-alive 这些行为都会变。
//  2. 视图不按 fullPath 做 key —— 旧版 /friends/a → /friends/b 是复用同一个容器重填，
//     视图内部用 watch(route.params) 复现。
import AppHeader from './components/AppHeader.vue';
import AppLoader from './components/AppLoader.vue';
import AuthorSection from './components/AuthorSection.vue';
import ThemeToggle from './components/ThemeToggle.vue';
import MusicPlayer from './components/MusicPlayer.vue';
import Lightbox from './components/Lightbox.vue';
</script>

<template>
  <AppHeader />
  <AppLoader />

  <router-view v-slot="{ Component }">
    <keep-alive>
      <component :is="Component" />
    </keep-alive>
  </router-view>

  <Lightbox />
  <ThemeToggle />
  <AuthorSection />
  <MusicPlayer />
</template>
