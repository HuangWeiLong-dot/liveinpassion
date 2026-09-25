// 由 tools/extract-legacy-data.mjs 从仓库根 index.html 逐字提取（L6534-L6617 + L5720-L5730）。
// 提取时未重新排版，改动请改此文件本身或重跑提取工具。

// 已合并原先重复的两份数据：friendsData[i].photos 与 friendGalleryMap[id].data
//   photos  —— 由 generateGalleryData 生成，带 CDN 绝对地址，页面时间线使用（与旧 friendGalleryMap 完全一致）
//   name    —— Title Case，好友跑马灯使用
//   titleName —— 全大写，好友详情页标题使用
export const friends = [
    {
        "id": "lijiazu",
        "name": "Li Jiazu",
        "titleName": "LI JIAZU",
        "bio": "To Be Determined",
        "photos": [
            {
                "id": 1,
                "filename": "202605_1.jpg",
                "src": "https://img.liveinpassion.me/LiJiaZu/LiJiaZu_compressed/202605_1.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiJiaZu/202605_1.jpg"
            },
            {
                "id": 2,
                "filename": "202605_0.jpg",
                "src": "https://img.liveinpassion.me/LiJiaZu/LiJiaZu_compressed/202605_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiJiaZu/202605_0.jpg"
            },
            {
                "id": 3,
                "filename": "202604_0.jpg",
                "src": "https://img.liveinpassion.me/LiJiaZu/LiJiaZu_compressed/202604_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiJiaZu/202604_0.jpg"
            },
            {
                "id": 4,
                "filename": "202505_2.jpg",
                "src": "https://img.liveinpassion.me/LiJiaZu/LiJiaZu_compressed/202505_2.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiJiaZu/202505_2.jpg"
            },
            {
                "id": 5,
                "filename": "202505_1.jpg",
                "src": "https://img.liveinpassion.me/LiJiaZu/LiJiaZu_compressed/202505_1.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiJiaZu/202505_1.jpg"
            },
            {
                "id": 6,
                "filename": "202505_0.jpg",
                "src": "https://img.liveinpassion.me/LiJiaZu/LiJiaZu_compressed/202505_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiJiaZu/202505_0.jpg"
            },
            {
                "id": 7,
                "filename": "202501_0.jpg",
                "src": "https://img.liveinpassion.me/LiJiaZu/LiJiaZu_compressed/202501_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiJiaZu/202501_0.jpg"
            },
            {
                "id": 8,
                "filename": "202409_0.jpg",
                "src": "https://img.liveinpassion.me/LiJiaZu/LiJiaZu_compressed/202409_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiJiaZu/202409_0.jpg"
            },
            {
                "id": 9,
                "filename": "202308_0.jpg",
                "src": "https://img.liveinpassion.me/LiJiaZu/LiJiaZu_compressed/202308_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiJiaZu/202308_0.jpg"
            },
            {
                "id": 10,
                "filename": "202211_0.jpg",
                "src": "https://img.liveinpassion.me/LiJiaZu/LiJiaZu_compressed/202211_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiJiaZu/202211_0.jpg"
            },
            {
                "id": 11,
                "filename": "202203_0.jpg",
                "src": "https://img.liveinpassion.me/LiJiaZu/LiJiaZu_compressed/202203_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiJiaZu/202203_0.jpg"
            },
            {
                "id": 12,
                "filename": "202202_0.jpg",
                "src": "https://img.liveinpassion.me/LiJiaZu/LiJiaZu_compressed/202202_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiJiaZu/202202_0.jpg"
            }
        ]
    },
    {
        "id": "jianghaipeng",
        "name": "Jiang HaiPeng",
        "titleName": "JIANG HAIPENG",
        "bio": "To Be Determined",
        "photos": [
            {
                "id": 1,
                "filename": "202605_0.jpg",
                "src": "https://img.liveinpassion.me/JiangHaiPeng/JiangHaiPeng_compressed/202605_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/JiangHaiPeng/202605_0.jpg"
            },
            {
                "id": 2,
                "filename": "202604_0.jpg",
                "src": "https://img.liveinpassion.me/JiangHaiPeng/JiangHaiPeng_compressed/202604_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/JiangHaiPeng/202604_0.jpg"
            },
            {
                "id": 3,
                "filename": "202511_0.jpg",
                "src": "https://img.liveinpassion.me/JiangHaiPeng/JiangHaiPeng_compressed/202511_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/JiangHaiPeng/202511_0.jpg"
            },
            {
                "id": 4,
                "filename": "202409_0.jpg",
                "src": "https://img.liveinpassion.me/JiangHaiPeng/JiangHaiPeng_compressed/202409_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/JiangHaiPeng/202409_0.jpg"
            },
            {
                "id": 5,
                "filename": "202308_0.jpg",
                "src": "https://img.liveinpassion.me/JiangHaiPeng/JiangHaiPeng_compressed/202308_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/JiangHaiPeng/202308_0.jpg"
            },
            {
                "id": 6,
                "filename": "202302_4.jpg",
                "src": "https://img.liveinpassion.me/JiangHaiPeng/JiangHaiPeng_compressed/202302_4.jpg",
                "fullSrc": "https://img.liveinpassion.me/JiangHaiPeng/202302_4.jpg"
            },
            {
                "id": 7,
                "filename": "202302_3.jpg",
                "src": "https://img.liveinpassion.me/JiangHaiPeng/JiangHaiPeng_compressed/202302_3.jpg",
                "fullSrc": "https://img.liveinpassion.me/JiangHaiPeng/202302_3.jpg"
            },
            {
                "id": 8,
                "filename": "202302_2.jpg",
                "src": "https://img.liveinpassion.me/JiangHaiPeng/JiangHaiPeng_compressed/202302_2.jpg",
                "fullSrc": "https://img.liveinpassion.me/JiangHaiPeng/202302_2.jpg"
            },
            {
                "id": 9,
                "filename": "202302_1.jpg",
                "src": "https://img.liveinpassion.me/JiangHaiPeng/JiangHaiPeng_compressed/202302_1.jpg",
                "fullSrc": "https://img.liveinpassion.me/JiangHaiPeng/202302_1.jpg"
            },
            {
                "id": 10,
                "filename": "202302_0.jpg",
                "src": "https://img.liveinpassion.me/JiangHaiPeng/JiangHaiPeng_compressed/202302_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/JiangHaiPeng/202302_0.jpg"
            },
            {
                "id": 11,
                "filename": "202109_0.jpg",
                "src": "https://img.liveinpassion.me/JiangHaiPeng/JiangHaiPeng_compressed/202109_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/JiangHaiPeng/202109_0.jpg"
            }
        ]
    },
    {
        "id": "lixinyu",
        "name": "Li XinYu",
        "titleName": "LI XINYU",
        "bio": "To Be Determined",
        "photos": [
            {
                "id": 1,
                "filename": "202605_1.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202605_1.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202605_1.jpg"
            },
            {
                "id": 2,
                "filename": "202605_0.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202605_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202605_0.jpg"
            },
            {
                "id": 3,
                "filename": "202604_0.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202604_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202604_0.jpg"
            },
            {
                "id": 4,
                "filename": "202511_0.png",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202511_0.png",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202511_0.png"
            },
            {
                "id": 5,
                "filename": "202309_0.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202309_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202309_0.jpg"
            },
            {
                "id": 6,
                "filename": "202308_3.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202308_3.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202308_3.jpg"
            },
            {
                "id": 7,
                "filename": "202308_2.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202308_2.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202308_2.jpg"
            },
            {
                "id": 8,
                "filename": "202308_1.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202308_1.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202308_1.jpg"
            },
            {
                "id": 9,
                "filename": "202308_0.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202308_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202308_0.jpg"
            },
            {
                "id": 10,
                "filename": "202307_0.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202307_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202307_0.jpg"
            },
            {
                "id": 11,
                "filename": "202302_2.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202302_2.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202302_2.jpg"
            },
            {
                "id": 12,
                "filename": "202302_1.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202302_1.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202302_1.jpg"
            },
            {
                "id": 13,
                "filename": "202302_0.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202302_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202302_0.jpg"
            },
            {
                "id": 14,
                "filename": "202212_0.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202212_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202212_0.jpg"
            },
            {
                "id": 15,
                "filename": "202211_0.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202211_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202211_0.jpg"
            },
            {
                "id": 16,
                "filename": "202204_0.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202204_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202204_0.jpg"
            },
            {
                "id": 17,
                "filename": "202111_5.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202111_5.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202111_5.jpg"
            },
            {
                "id": 18,
                "filename": "202111_4.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202111_4.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202111_4.jpg"
            },
            {
                "id": 19,
                "filename": "202111_3.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202111_3.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202111_3.jpg"
            },
            {
                "id": 20,
                "filename": "202111_2.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202111_2.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202111_2.jpg"
            },
            {
                "id": 21,
                "filename": "202111_1.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202111_1.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202111_1.jpg"
            },
            {
                "id": 22,
                "filename": "202111_0.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202111_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202111_0.jpg"
            },
            {
                "id": 23,
                "filename": "202110_10.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202110_10.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202110_10.jpg"
            },
            {
                "id": 24,
                "filename": "202110_9.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202110_9.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202110_9.jpg"
            },
            {
                "id": 25,
                "filename": "202110_8.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202110_8.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202110_8.jpg"
            },
            {
                "id": 26,
                "filename": "202110_7.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202110_7.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202110_7.jpg"
            },
            {
                "id": 27,
                "filename": "202110_6.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202110_6.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202110_6.jpg"
            },
            {
                "id": 28,
                "filename": "202110_5.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202110_5.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202110_5.jpg"
            },
            {
                "id": 29,
                "filename": "202110_4.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202110_4.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202110_4.jpg"
            },
            {
                "id": 30,
                "filename": "202110_3.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202110_3.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202110_3.jpg"
            },
            {
                "id": 31,
                "filename": "202110_2.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202110_2.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202110_2.jpg"
            },
            {
                "id": 32,
                "filename": "202110_1.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202110_1.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202110_1.jpg"
            },
            {
                "id": 33,
                "filename": "202110_0.jpg",
                "src": "https://img.liveinpassion.me/LiXinYu/LiXinYu_compressed/202110_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/LiXinYu/202110_0.jpg"
            }
        ]
    },
    {
        "id": "wangshuai",
        "name": "Wang Shuai",
        "titleName": "WANG SHUAI",
        "bio": "To Be Determined",
        "photos": [
            {
                "id": 1,
                "filename": "202308_2.jpg",
                "src": "https://img.liveinpassion.me/WangShuai/WangShuai_compressed/202308_2.jpg",
                "fullSrc": "https://img.liveinpassion.me/WangShuai/202308_2.jpg"
            },
            {
                "id": 2,
                "filename": "202308_1.jpg",
                "src": "https://img.liveinpassion.me/WangShuai/WangShuai_compressed/202308_1.jpg",
                "fullSrc": "https://img.liveinpassion.me/WangShuai/202308_1.jpg"
            },
            {
                "id": 3,
                "filename": "202605.jpg",
                "src": "https://img.liveinpassion.me/WangShuai/WangShuai_compressed/202605.jpg",
                "fullSrc": "https://img.liveinpassion.me/WangShuai/202605.jpg"
            }
        ]
    },
    {
        "id": "xuhaonan",
        "name": "Xu HaoNan",
        "titleName": "XU HAONAN",
        "bio": "To Be Determined",
        "photos": [
            {
                "id": 1,
                "filename": "202308_0.jpg",
                "src": "https://img.liveinpassion.me/XuHaoNan/XuHaoNan_compressed/202308_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/XuHaoNan/202308_0.jpg"
            },
            {
                "id": 2,
                "filename": "202209_0.jpg",
                "src": "https://img.liveinpassion.me/XuHaoNan/XuHaoNan_compressed/202209_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/XuHaoNan/202209_0.jpg"
            },
            {
                "id": 3,
                "filename": "202201_6.jpg",
                "src": "https://img.liveinpassion.me/XuHaoNan/XuHaoNan_compressed/202201_6.jpg",
                "fullSrc": "https://img.liveinpassion.me/XuHaoNan/202201_6.jpg"
            },
            {
                "id": 4,
                "filename": "202201_5.jpg",
                "src": "https://img.liveinpassion.me/XuHaoNan/XuHaoNan_compressed/202201_5.jpg",
                "fullSrc": "https://img.liveinpassion.me/XuHaoNan/202201_5.jpg"
            },
            {
                "id": 5,
                "filename": "202201_4.jpg",
                "src": "https://img.liveinpassion.me/XuHaoNan/XuHaoNan_compressed/202201_4.jpg",
                "fullSrc": "https://img.liveinpassion.me/XuHaoNan/202201_4.jpg"
            },
            {
                "id": 6,
                "filename": "202201_3.jpg",
                "src": "https://img.liveinpassion.me/XuHaoNan/XuHaoNan_compressed/202201_3.jpg",
                "fullSrc": "https://img.liveinpassion.me/XuHaoNan/202201_3.jpg"
            },
            {
                "id": 7,
                "filename": "202201_2.jpg",
                "src": "https://img.liveinpassion.me/XuHaoNan/XuHaoNan_compressed/202201_2.jpg",
                "fullSrc": "https://img.liveinpassion.me/XuHaoNan/202201_2.jpg"
            },
            {
                "id": 8,
                "filename": "202201_1.jpg",
                "src": "https://img.liveinpassion.me/XuHaoNan/XuHaoNan_compressed/202201_1.jpg",
                "fullSrc": "https://img.liveinpassion.me/XuHaoNan/202201_1.jpg"
            },
            {
                "id": 9,
                "filename": "202201_0.jpg",
                "src": "https://img.liveinpassion.me/XuHaoNan/XuHaoNan_compressed/202201_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/XuHaoNan/202201_0.jpg"
            }
        ]
    },
    {
        "id": "sunjiajun",
        "name": "Sun JiaJun",
        "titleName": "SUN JIAJUN",
        "bio": "To Be Determined",
        "photos": [
            {
                "id": 1,
                "filename": "202309_0.jpg",
                "src": "https://img.liveinpassion.me/SunJiaJun/SunJiaJun_compressed/202309_0.jpg",
                "fullSrc": "https://img.liveinpassion.me/SunJiaJun/202309_0.jpg"
            }
        ]
    },
    {
        "id": "hanyong",
        "name": "Han Yong",
        "titleName": "HAN YONG",
        "bio": "To Be Determined",
        "photos": []
    }
];

export const friendById = Object.fromEntries(friends.map((f) => [f.id, f]));
