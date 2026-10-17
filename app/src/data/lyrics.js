// 本地歌词覆盖。
//
// 平时歌词在播放时从 LRCLIB 按「曲名 + 歌手」拉取，仓库里不存歌词正文。
// 如果某首歌在 LRCLIB 上没有、或者时间轴对不上，把 LRC 文本按 src 写在这里即可，
// 播放器会优先使用本地这份：
//
// export const localLyrics = {
//   'music/Almost%20Nothing%20-%20Silent%20PoetsOkay%20Kaya.mp3': `
// [00:12.30]第一行歌词
// [00:18.75]第二行歌词
// `,
// };
//
// 格式：每行 [mm:ss.xx]歌词；同一行可以带多个时间戳。

export const localLyrics = {};
