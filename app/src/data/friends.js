// 好友数据：照片从 CMS 快照的对应相册提取，其余元数据（name/titleName/bio）保留硬编码。
// 映射：friend.id → album.r2Prefix

import content from './content/albums.json';

const albums = (content && Array.isArray(content.albums)) ? content.albums : [];

function photosByPrefix(prefix) {
  const album = albums.find((a) => a.r2Prefix === prefix);
  return album ? album.photos : [];
}

export const friends = [
    { id: "lijiazu", name: "Li Jiazu", titleName: "LI JIAZU", bio: "To Be Determined", photos: photosByPrefix('LiJiaZu') },
    { id: "jianghaipeng", name: "Jiang HaiPeng", titleName: "JIANG HAIPENG", bio: "To Be Determined", photos: photosByPrefix('JiangHaiPeng') },
    { id: "lixinyu", name: "Li XinYu", titleName: "LI XINYU", bio: "To Be Determined", photos: photosByPrefix('LiXinYu') },
    { id: "wangshuai", name: "Wang Shuai", titleName: "WANG SHUAI", bio: "To Be Determined", photos: photosByPrefix('WangShuai') },
    { id: "xuhaonan", name: "Xu HaoNan", titleName: "XU HAONAN", bio: "To Be Determined", photos: photosByPrefix('XuHaoNan') },
    { id: "sunjiajun", name: "Sun JiaJun", titleName: "SUN JIAJUN", bio: "To Be Determined", photos: photosByPrefix('SunJiaJun') },
    { id: "hanyong", name: "Han Yong", titleName: "HAN YONG", bio: "To Be Determined", photos: [] },
];

export const friendById = Object.fromEntries(friends.map((f) => [f.id, f]));
