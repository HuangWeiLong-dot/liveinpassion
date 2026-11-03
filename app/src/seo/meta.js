// 纯 SEO 元数据计算：不碰 DOM，运行时（useSeo.js）和构建脚本（copy-static.mjs）共用一份，
// 避免静态页面与 JS 写入的 title / description / JSON-LD 出现两套说法。
//
// 输入是路由名 + 参数 + CMS 快照，输出这一页要写进 <head> 的所有内容。

export const SITE = 'https://liveinpassion.me';
export const SITE_NAME = 'LIVEINPASSION';
export const AUTHOR = 'Huang Wei Long';
export const DEFAULT_DESCRIPTION =
  'Personal site of Huang Wei Long — photos, stories and friends. When that moment comes, I\'ll let it rest, breathe it in, and know it as a memory born.';
export const TWITTER = '@HuangWeiLong525';
export const X_URL = 'https://x.com/HuangWeiLong525';
export const GITHUB_URL = 'https://github.com/HuangWeiLong-dot';

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

export const STATIC_PAGES = {
  home: {
    title: `${SITE_NAME} — ${AUTHOR} · Photography, Stories & Friends`,
    description: DEFAULT_DESCRIPTION,
  },
  blogs: {
    title: `Blogs — ${SITE_NAME}`,
    description: 'Poems, notes and stories by Huang Wei Long — moments that were worth keeping.',
  },
  me: {
    title: `Me — ${SITE_NAME}`,
    description: 'Who is Huang Wei Long? A portrait in photos, music and fragments of everyday life.',
  },
  'me-gallery': {
    title: `Me · Gallery — ${SITE_NAME}`,
    description: 'A personal photo album of Huang Wei Long, month by month.',
  },
  gallery: {
    title: `Gallery — ${SITE_NAME}`,
    description: 'People, places and small moments — the photo galleries of LIVEINPASSION.',
  },
  photography: {
    title: `Photography — ${SITE_NAME}`,
    description: 'Photography work by Huang Wei Long, grouped by the person in the frame.',
  },
  life: {
    title: `Life — ${SITE_NAME}`,
    description: 'A running log of time, places and habits — what a year of living actually looks like.',
  },
  'life-archive': {
    title: `Life · Archive — ${SITE_NAME}`,
    description: 'The long-form archive behind the Life dashboard: journals, notes, tasks and reviews.',
  },
  'me-organization': {
    title: `Organization — ${SITE_NAME}`,
    description: 'The structure behind the life of Huang Wei Long — eight screens, one system.',
  },
  'not-found': {
    title: `Not Found — ${SITE_NAME}`,
    description: 'This page does not exist.',
    noindex: true,
  },
};

export const LIFE_ARCHIVE_KINDS = [
  'journal', 'notes', 'tasks', 'qa', 'events', 'blocks', 'weekly', 'vault',
];

export function albumPerson(album) {
  return album.person || String(album.r2Prefix || '').replace(/^photography\//, '');
}

export function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function clamp(text, max = 158) {
  const s = stripHtml(text);
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
}

// "November 3, 2026 · 8:36 PM" → "2026-11-03T20:36:00+08:00"（站点按北京时间展示）
export function toIso(text) {
  const m = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})(?:\s*·\s*(\d{1,2}):(\d{2})\s*(AM|PM))?/i.exec(text || '');
  if (!m) return undefined;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return undefined;
  const day = Number(m[2]);
  const year = Number(m[3]);
  let hour = Number(m[4] || 0);
  const minute = Number(m[5] || 0);
  if (m[6]?.toUpperCase() === 'PM' && hour < 12) hour += 12;
  if (m[6]?.toUpperCase() === 'AM' && hour === 12) hour = 0;
  const pad = (n) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+08:00`;
}

export function canonicalOf(path) {
  const clean = path === '/' ? '/' : String(path).replace(/\/+$/, '');
  return `${SITE}${clean}`;
}

function webPage(name, description, url, type = 'WebPage') {
  return {
    '@type': type,
    '@id': `${url}#webpage`,
    url,
    name,
    description,
    isPartOf: { '@id': `${SITE}/#website` },
    inLanguage: 'en',
  };
}

// 面包屑：[[名称, 路径], ...]，路径用站点内相对路径，内部再转绝对地址
function breadcrumb(items) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, path], i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name,
      item: canonicalOf(path),
    })),
  };
}

function baseGraph(webpage, crumbs = []) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${SITE}/#website`,
        url: SITE,
        name: SITE_NAME,
        description: DEFAULT_DESCRIPTION,
        inLanguage: 'en',
        author: { '@id': `${SITE}/#person` },
      },
      {
        '@type': 'Person',
        '@id': `${SITE}/#person`,
        name: AUTHOR,
        url: `${SITE}/me`,
        image: `${SITE}/avatar/1.jpg`,
        sameAs: [X_URL, GITHUB_URL],
      },
      webpage,
      ...(crumbs.length ? [breadcrumb(crumbs)] : []),
    ],
  };
}

const STATIC_CRUMBS = {
  blogs: [['Home', '/'], ['Blogs', '/blogs']],
  me: [['Home', '/'], ['Me', '/me']],
  'me-gallery': [['Home', '/'], ['Me', '/me'], ['Gallery', '/me/gallery']],
  gallery: [['Home', '/'], ['Gallery', '/gallery']],
  photography: [['Home', '/'], ['Photography', '/photography']],
  life: [['Home', '/'], ['Life', '/life']],
  'me-organization': [['Home', '/'], ['Me', '/me'], ['Organization', '/me/organization']],
};

/**
 * @param {string} name 路由名
 * @param {Record<string, any>} params 路由参数
 * @param {{slug:string,title:string,body:string,date?:string,cardDate?:string,image?:{src:string,fullSrc?:string}}[]} posts
 * @param {{kind:string,person?:string,r2Prefix?:string,name?:string,photos?:{src:string}[]}[]} albums
 */
export function resolveSeo(name, params, posts = [], albums = []) {
  const slug = String(params?.slug || '');
  const person = String(params?.person || '');
  const kind = String(params?.kind || 'journal');
  const path = name === 'home' ? '/' : pathOf(name, params);
  const url = canonicalOf(path);
  const defaultImage = posts[0]?.image?.src || `${SITE}/favicon.png`;
  const notFound = STATIC_PAGES['not-found'];

  if (name === 'blog-detail') {
    const post = posts.find((p) => p.slug === slug);
    if (!post) {
      return {
        path,
        url,
        title: notFound.title,
        description: notFound.description,
        image: defaultImage,
        noindex: true,
        jsonLd: baseGraph(webPage(notFound.title, notFound.description, url)),
      };
    }
    const description = clamp(post.body);
    const image = post.image?.fullSrc || post.image?.src || defaultImage;
    const published = toIso(post.date || post.cardDate);
    return {
      path,
      url,
      title: `${post.title} — ${SITE_NAME}`,
      description,
      image,
      preloadImage: post.image?.src,
      type: 'article',
      published,
      jsonLd: {
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'BlogPosting',
            headline: post.title,
            description,
            image: [image],
            url,
            mainEntityOfPage: { '@type': 'WebPage', '@id': url },
            datePublished: published,
            dateModified: published,
            author: { '@type': 'Person', name: AUTHOR, url: `${SITE}/me` },
            publisher: {
              '@type': 'Organization',
              name: SITE_NAME,
              logo: { '@type': 'ImageObject', url: `${SITE}/favicon.png` },
            },
            inLanguage: 'en',
          },
          breadcrumb([['Home', '/'], ['Blogs', '/blogs'], [post.title, path]]),
        ],
      },
    };
  }

  if (name === 'photography-person') {
    const album = albums
      .filter((a) => a.kind === 'photography' && a.photos?.length)
      .find((a) => albumPerson(a) === person);
    if (!album) {
      return {
        path,
        url,
        title: `Photography · ${person} — ${SITE_NAME}`,
        description: `Photography album for ${person}.`,
        image: defaultImage,
        noindex: true,
        jsonLd: baseGraph(webPage('Photography', 'Photography album', url)),
      };
    }
    const title = `${album.name || person} — Photography · ${SITE_NAME}`;
    const description = `${album.photos.length} photographs of ${album.name || person}, shot by ${AUTHOR}.`;
    const image = album.photos[0]?.src || defaultImage;
    return {
      path,
      url,
      title,
      description,
      image,
      preloadImage: album.photos[0]?.src,
      jsonLd: baseGraph({
        ...webPage(title, description, url, 'CollectionPage'),
        about: { '@type': 'Person', name: album.name || person },
        image: { '@type': 'ImageObject', url: image },
        mainEntity: {
          '@type': 'ImageGallery',
          name: `${album.name || person} — Photography`,
          numberOfItems: album.photos.length,
          image: album.photos.slice(0, 8).map((p) => p.src),
        },
      }, [['Home', '/'], ['Photography', '/photography'], [album.name || person, path]]),
    };
  }

  if (name === 'life-archive') {
    const label = kind.charAt(0).toUpperCase() + kind.slice(1);
    const title = `Life · ${label} — ${SITE_NAME}`;
    return {
      path,
      url,
      title,
      description: `${label} archive from the life log of ${AUTHOR}.`,
      image: defaultImage,
      jsonLd: baseGraph(webPage(title, `${label} archive`, url), [
        ['Home', '/'], ['Life', '/life'], [label, path],
      ]),
    };
  }

  const meta = STATIC_PAGES[name] || STATIC_PAGES.home;
  return {
    path,
    url,
    title: meta.title,
    description: meta.description,
    image: defaultImage,
    preloadImage: name === 'home' ? '/me/individuation.jpg' : undefined,
    noindex: Boolean(meta.noindex),
    jsonLd: baseGraph(
      webPage(meta.title, meta.description, url),
      STATIC_CRUMBS[name] || []
    ),
  };
}

function pathOf(name, params) {
  const slug = String(params?.slug || '');
  const person = String(params?.person || '');
  const kind = String(params?.kind || 'journal');
  switch (name) {
    case 'blogs': return '/blogs';
    case 'blog-detail': return `/blogs/${encodeURIComponent(slug)}`;
    case 'me': return '/me';
    case 'me-gallery': return '/me/gallery';
    case 'gallery': return '/gallery';
    case 'photography': return '/photography';
    case 'photography-person': return `/photography/${encodeURIComponent(person)}`;
    case 'life': return '/life';
    case 'life-archive': return `/life/archive/${kind}`;
    case 'me-organization': return '/me/organization';
    default: return '/';
  }
}

export { pathOf };
