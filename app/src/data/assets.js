// 运行期从站点根目录加载的静态资源。
//
// 为什么不直接把这些路径写在模板里：Vite 会把模板/HTML 里的绝对路径当成模块去解析并在
// 构建期找文件，而这些文件**故意**不在 app/ 里（仓库根只保留一份，构建后由
// scripts/copy-static.mjs 复制进 dist）。写成变量后打包器不再静态解析，路径原样保留。
//
// 副作用（与旧站一致）：这些资源没有内容哈希，URL 长期稳定。
export const ICONS = {
  notes: '/icons/TiNotes.svg',
  rewind: '/icons/TiMediaRewind.svg',
  play: '/icons/TiMediaPlay.svg',
  pause: '/icons/TiMediaPause.svg',
  forward: '/icons/TiMediaFastForward.svg',
  playlist: '/icons/TiThMenu.svg',
};

export const LOCAL_ASSETS = {
  authorAvatar: '/avatar/1.jpg',
  meAvatar: '/avatar/2.jpg',
  moviePoster: '/me/1.jpg',
  albumArt: '/me/2.jpg',
  favicon: '/favicon.png',
};
