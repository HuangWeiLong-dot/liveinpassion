// ME 页的三处随机图片：头像轮播（5s）、GALLERY 磁贴封面（20s，7s 后启动）、
// MORE 磁贴背景（20s，14s 后启动）。对应旧版 initMeAvatarRotation / initMeGallery /
// initMoreRandomBackground 三个函数——它们由 mePageEventsInitialized 守卫，整场会话只启动一次，
// 这里用模块级 started 保持同样的语义（KeepAlive 下 ME 视图也只挂载一次）。
//
// 与旧版的差异：旧版这几处走 loadBgTwoStage（本地 photos/ → CDN 兜底），
// 本地优先那层已按决定移除，现在统一用 CDN 上的压缩小图（磁贴/头像本来就是小图）。
import { mePhotos } from '../data/mePhotos.js';
import { groupMorePhotos } from '../data/groupPhotos.js';
import { friends } from '../data/friends.js';
import { CDN_BASE } from '../data/cdn.js';

const meCompressed = (name) => `${CDN_BASE}/Me/compressed_me/${name}`;

// MORE 磁贴背景池 = 群组照片(26) + 所有好友照片(69)，都用压缩图
const morePool = [
  ...groupMorePhotos.map((p) => `${CDN_BASE}/${p.compressed}`),
  ...friends.flatMap((f) => f.photos.map((p) => p.src)),
];

let started = false;
let lastAvatarIndex = -1;
let currentMoreIndex = -1;

// 背景图没有骨架屏可用：先探一次，成功了再挂上去并加 .loaded，让 CSS 的淡入生效
function setTileBackground(el, url) {
  if (!el) return;
  const probe = new Image();
  probe.onload = () => {
    el.style.backgroundImage = `url('${url}')`;
    el.classList.add('loaded');
  };
  probe.onerror = () => {};
  probe.src = url;
}

export function startMeTiles({ avatar, cover, more }) {
  if (started) return;
  started = true;

  // ---- 头像轮播：随机换一张 ME 照片，避免连续抽到同一张 ----
  if (avatar && mePhotos.length) {
    const pickAvatar = () => {
      let index;
      do {
        index = Math.floor(Math.random() * mePhotos.length);
      } while (index === lastAvatarIndex && mePhotos.length > 1);
      lastAvatarIndex = index;
      avatar.src = meCompressed(mePhotos[index]);
    };
    pickAvatar();
    setInterval(pickAvatar, 5000);
  }

  // ---- GALLERY 磁贴封面：延迟 7s 启动，与头像(5s)/MORE(14s) 错开 ----
  if (cover && mePhotos.length) {
    const pickCover = () => {
      setTileBackground(cover, meCompressed(mePhotos[Math.floor(Math.random() * mePhotos.length)]));
    };
    pickCover();
    setTimeout(() => setInterval(pickCover, 20000), 7000);
  }

  // ---- MORE 磁贴背景：延迟 14s 启动，且不连续抽到同一张 ----
  if (more && morePool.length) {
    const pickMoreIndex = () => {
      if (morePool.length === 1) return 0;
      let next;
      do {
        next = Math.floor(Math.random() * morePool.length);
      } while (next === currentMoreIndex);
      return next;
    };
    const applyMore = () => {
      currentMoreIndex = pickMoreIndex();
      setTileBackground(more, morePool[currentMoreIndex]);
    };
    applyMore();
    setTimeout(() => setInterval(applyMore, 20000), 14000);
  }
}
