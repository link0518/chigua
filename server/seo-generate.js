import fs from 'fs';
import path from 'path';
import { db } from './db.js';

const SITE_URL = String(process.env.SITE_URL || 'https://933211.xyz').replace(/\/+$/, '');
const OUTPUT_DIR = path.resolve(process.cwd(), 'public');
const POSTS_DIR = path.join(OUTPUT_DIR, 'post');

const escapeHtml = (value) => {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const toSnippet = (content, maxLength = 120) => {
  const normalized = String(content || '')
    .replace(/\s+/g, ' ')
    .replace(/[“”"]/g, '')
    .trim();
  if (!normalized) return '';
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
};

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const formatDate = (timestamp) => {
  if (!timestamp) return '';
  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
};

const posts = db
  .prepare('SELECT id, content, created_at FROM posts WHERE deleted = 0 ORDER BY created_at DESC')
  .all();

ensureDir(POSTS_DIR);

posts.forEach((post) => {
  const encodedId = encodeURIComponent(post.id);
  const postDir = path.join(POSTS_DIR, encodedId);
  ensureDir(postDir);
  const snippet = toSnippet(post.content);
  const title = snippet ? `JX3瓜田｜剑网3吃瓜 - ${snippet}` : `JX3瓜田｜剑网3吃瓜 - ${post.id}`;
  const description = snippet
    ? `来自JX3瓜田的内容摘要：${snippet}`
    : 'JX3瓜田聚合剑网3吃瓜与818内容，关注最新爆料与热门话题。';
  const canonical = `${SITE_URL}/post/${encodedId}`;
  const publishedAt = formatDate(post.created_at);
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />
    <meta name="robots" content="index,follow" />
    <script type="application/ld+json">
${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: title,
  datePublished: publishedAt || undefined,
  dateModified: publishedAt || undefined,
  mainEntityOfPage: canonical,
  author: { '@type': 'Person', name: '匿名' },
  publisher: { '@type': 'Organization', name: 'JX3瓜田', url: SITE_URL },
}, null, 2)}
    </script>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(snippet || '')}</p>
      <p><a href="${canonical}">查看原帖</a></p>
    </main>
  </body>
</html>
`;
  fs.writeFileSync(path.join(postDir, 'index.html'), html, 'utf8');
});

const urls = [];
const latestPost = posts[0];
const homepageLastmod = formatDate(latestPost?.created_at);
urls.push({
  loc: `${SITE_URL}/`,
  lastmod: homepageLastmod || undefined,
  changefreq: 'daily',
  priority: '1.0',
});

posts.forEach((post) => {
  const encodedId = encodeURIComponent(post.id);
  const lastmod = formatDate(post.created_at);
  urls.push({
    loc: `${SITE_URL}/post/${encodedId}`,
    lastmod: lastmod || undefined,
    changefreq: 'daily',
    priority: '0.7',
  });
});

const sitemapItems = urls.map((item) => {
  const lastmod = item.lastmod ? `<lastmod>${item.lastmod}</lastmod>` : '';
  return `  <url>
    <loc>${item.loc}</loc>
    ${lastmod}
    <changefreq>${item.changefreq}</changefreq>
    <priority>${item.priority}</priority>
  </url>`;
});

const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapItems.join('\n')}
</urlset>
`;

fs.writeFileSync(path.join(OUTPUT_DIR, 'sitemap.xml'), sitemapXml, 'utf8');
console.log(`SEO 生成完成：${posts.length} 篇帖子，sitemap 已更新。`);
