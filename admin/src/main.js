import { createApp } from 'vue';
import { config } from 'md-editor-v3';
import App from './App.vue';
import router from './router/index.js';
import 'md-editor-v3/lib/style.css';

// 编辑器预览内置 js-xss 过滤，默认会：
//   1) 剥离非白名单协议（blob: 不在其列）→ 编辑期暂存图片无法显示
//   2) 剥离 figure/figcaption/div/section/span 的 class → 排版样式失效
// 这里扩展白名单并放行 blob: 图片地址（保存时它们会被替换成 https CDN 地址）
config({
  markdownItPlugins(plugins) {
    const xssPlugin = plugins.find((p) => p.type === 'xss');
    if (xssPlugin) {
      xssPlugin.options = {
        // 函数式配置：接收 xss 库，返回 FilterXSS 选项
        xss: (xssLib) => {
          const whiteList = xssLib.getDefaultWhiteList();
          // 编辑器内置扩展（MdWhiteList）：图片 class、任务列表、嵌入视频
          whiteList.img = [...new Set([...(whiteList.img || []), 'class'])];
          whiteList.input = ['class', 'disabled', 'type', 'checked'];
          whiteList.iframe = [
            'class', 'width', 'height', 'src', 'title',
            'border', 'frameborder', 'framespacing', 'allow', 'allowfullscreen',
          ];
          // 照片排版容器允许 class，data-gid 用于拖拽回写时定位块
          whiteList.figure = ['class', 'data-gid'];
          whiteList.figcaption = ['class'];
          whiteList.div = ['class', 'data-gid'];
          whiteList.section = ['class'];
          whiteList.span = ['class'];
          return {
            whiteList,
            safeAttrValue(tag, name, value, cssFilter) {
              if (name === 'src' && /^\s*blob:/i.test(value)) return value.trim();
              return xssLib.safeAttrValue(tag, name, value, cssFilter);
            },
          };
        },
      };
    }
    return plugins;
  },
});

createApp(App).use(router).mount('#app');
