import { readFile, writeFile, mkdir, rename, rm, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";

export const SITE = {
  origin: "https://yangondaddy77.github.io",
  name: "내맘대로 글 모음",
  description:
    "네이버 블로그 내맘대로 스포츠와 내맘대로 음악에 이미 공개된 글의 제목과 링크를 모은 목록입니다.",
};

export const BLOGS = [
  {
    id: "sports",
    name: "내맘대로 스포츠",
    naverId: "yangon_daddy",
    home: "https://blog.naver.com/yangon_daddy",
    rss: "https://rss.blog.naver.com/yangon_daddy.xml",
    description:
      "내맘대로 스포츠에 공개된 글 목록입니다. 제목을 누르면 네이버 원문으로 이동합니다.",
  },
  {
    id: "music",
    name: "내맘대로 음악",
    naverId: "jpopsakurazaka",
    home: "https://blog.naver.com/jpopsakurazaka",
    rss: "https://rss.blog.naver.com/jpopsakurazaka.xml",
    description:
      "내맘대로 음악에 공개된 글 목록입니다. 제목을 누르면 네이버 원문으로 이동합니다.",
  },
];

const CSS = readFileSync(new URL("./site.css", import.meta.url), "utf8");
const MAX_FEED_CHARS = 5_000_000;
const ISO_KST = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/;

export function blogById(id) {
  const blog = BLOGS.find((item) => item.id === id);
  if (!blog) throw new Error(`알 수 없는 블로그입니다: ${id}`);
  return blog;
}

export function canonicalFromUrl(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "blog.naver.com") return null;
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length !== 2) return null;
  const [naverId, logNo] = parts;
  if (!/^[A-Za-z0-9_]{3,30}$/.test(naverId)) return null;
  if (!/^[0-9]{6,20}$/.test(logNo)) return null;
  return {
    naverId,
    logNo,
    url: `https://blog.naver.com/${naverId}/${logNo}`,
  };
}

export function toKstIso(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, 19)}+09:00`;
}

export function categorySlug(name) {
  const slug = String(name)
    .normalize("NFC")
    .trim()
    .replace(/[·・ㆍ]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^0-9A-Za-z가-힣-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) throw new Error("카테고리 주소로 바꿀 수 없습니다.");
  return slug;
}

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function readTag(block, name) {
  const match = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  if (!match) return "";
  let value = match[1].trim();
  const cdata = value.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  if (cdata) value = cdata[1];
  return decodeEntities(value).replace(/\s+/g, " ").trim();
}

function splitItems(xml) {
  const items = [];
  const opener = /<item\b[^>]*>/gi;
  let match;
  while ((match = opener.exec(xml))) {
    const start = match.index + match[0].length;
    const end = xml.indexOf("</item>", start);
    if (end === -1) break;
    items.push(xml.slice(start, end));
    opener.lastIndex = end + "</item>".length;
  }
  return items;
}

function parseItem(block, blog) {
  const title = readTag(block, "title");
  const canon = canonicalFromUrl(readTag(block, "guid")) || canonicalFromUrl(readTag(block, "link"));
  const publishedAt = toKstIso(new Date(readTag(block, "pubDate")));
  if (!canon || canon.naverId !== blog.naverId) return null;
  if (!title || title.length > 300) return null;
  if (!publishedAt) return null;
  const category = readTag(block, "category");
  return {
    blog: blog.id,
    logNo: canon.logNo,
    title,
    url: canon.url,
    publishedAt,
    category: category ? category.slice(0, 80) : null,
  };
}

function dedupeFirst(posts) {
  const map = new Map();
  for (const post of posts) {
    if (!map.has(post.url)) map.set(post.url, post);
  }
  return [...map.values()];
}

export function parseFeed(xml, blog) {
  if (typeof xml !== "string" || xml.length < 40 || xml.length > MAX_FEED_CHARS) {
    throw new Error("피드 크기가 예상과 다릅니다.");
  }
  if (!xml.includes("<rss") || !xml.includes("<channel") || !xml.includes("</channel>")) {
    throw new Error("피드 형식이 예상과 다릅니다.");
  }
  const items = splitItems(xml);
  if (items.length === 0) throw new Error("피드에 글이 없습니다.");
  const posts = dedupeFirst(items.map((item) => parseItem(item, blog)).filter(Boolean));
  if (posts.length === 0 || posts.length * 2 < items.length) {
    throw new Error("피드에서 제목과 주소를 충분히 읽지 못했습니다.");
  }
  return posts;
}

export function comparePosts(a, b) {
  if (a.publishedAt !== b.publishedAt) return a.publishedAt < b.publishedAt ? 1 : -1;
  if (a.logNo !== b.logNo) return a.logNo < b.logNo ? 1 : -1;
  if (a.url !== b.url) return a.url < b.url ? -1 : 1;
  return 0;
}

export function mergePosts(existing, incoming) {
  const map = new Map();
  for (const post of existing) map.set(post.url, { ...post, category: post.category ?? null });
  for (const post of incoming) {
    const prev = map.get(post.url);
    if (!prev) {
      map.set(post.url, { ...post, category: post.category ?? null });
      continue;
    }
    map.set(post.url, {
      ...prev,
      blog: post.blog || prev.blog,
      logNo: post.logNo || prev.logNo,
      title: post.title || prev.title,
      publishedAt: post.publishedAt || prev.publishedAt,
      category: post.category ?? prev.category ?? null,
      url: prev.url,
    });
  }
  return [...map.values()].sort(comparePosts);
}

export function assertNotShrinking(existing, merged) {
  const have = new Set(merged.map((post) => post.url));
  for (const post of existing) {
    if (!have.has(post.url)) {
      throw new Error("병합 결과가 기존 글을 빼려 해서 중단합니다. 파일은 변경하지 않습니다.");
    }
  }
}

function postSignature(posts) {
  return JSON.stringify(
    [...posts]
      .map((post) => ({
        blog: post.blog,
        logNo: post.logNo,
        title: post.title,
        url: post.url,
        publishedAt: post.publishedAt,
        category: post.category ?? null,
      }))
      .sort(comparePosts),
  );
}

export function samePosts(a, b) {
  return postSignature(a) === postSignature(b);
}

function normalizeStoredPost(post) {
  if (!post || typeof post !== "object") throw new Error("글 형식이 아닙니다.");
  const canon = canonicalFromUrl(post.url);
  const blog = BLOGS.find((item) => item.id === post.blog && item.naverId === canon?.naverId);
  if (!canon || !blog) throw new Error("저장된 글 주소가 올바르지 않습니다.");
  if (typeof post.title !== "string" || !post.title.trim() || post.title.length > 300) {
    throw new Error("저장된 글 제목이 올바르지 않습니다.");
  }
  if (typeof post.publishedAt !== "string" || !ISO_KST.test(post.publishedAt)) {
    throw new Error("저장된 글 날짜가 올바르지 않습니다.");
  }
  if (String(post.logNo) !== canon.logNo) throw new Error("저장된 글 번호가 주소와 다릅니다.");
  const category =
    post.category == null || post.category === ""
      ? null
      : String(post.category).trim().slice(0, 80);
  return {
    blog: blog.id,
    logNo: canon.logNo,
    title: post.title.trim(),
    url: canon.url,
    publishedAt: post.publishedAt,
    category: category || null,
  };
}

export function parseDataset(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.posts)) throw new Error("posts 배열이 없습니다.");
  return {
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
    posts: data.posts.map(normalizeStoredPost),
  };
}

export async function readDataset(file) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return { updatedAt: null, posts: [] };
    throw new Error("기존 데이터를 읽지 못했습니다. 파일은 변경하지 않습니다.");
  }
  try {
    return parseDataset(text);
  } catch {
    throw new Error("기존 데이터 형식이 예상과 다릅니다. 파일은 변경하지 않습니다.");
  }
}

async function defaultFetchText(url) {
  let response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": "yangondaddy77-hub/1.0 (+https://yangondaddy77.github.io/)",
        accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1",
      },
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    throw new Error(`피드를 가져오지 못했습니다: ${url}`);
  }
  if (!response.ok) throw new Error(`피드 응답이 정상이 아닙니다 (${response.status}): ${url}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_FEED_CHARS) throw new Error(`피드가 너무 큽니다: ${url}`);
  const xml = new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
  if (!xml.includes("<rss") || !xml.includes("<channel")) {
    throw new Error(`피드 형식이 예상과 다릅니다: ${url}`);
  }
  return xml;
}

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDay(iso) {
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${year}.${month}.${day}`;
}

function formatStamp(iso) {
  return `${formatDay(iso)} ${iso.slice(11, 16)} KST`;
}

function absoluteUrl(pathname) {
  return new URL(pathname, `${SITE.origin}/`).href;
}

function categoryPath(blogId, category) {
  return `/${blogId}/category/${categorySlug(category)}/`;
}

function postItem(post, { showBlog, showCategory }) {
  const bits = [
    `<time datetime="${esc(post.publishedAt)}">${esc(formatDay(post.publishedAt))}</time>`,
  ];
  if (showBlog) {
    const blog = blogById(post.blog);
    bits.push(`<a class="blog blog-${blog.id}" href="/${blog.id}/">${esc(blog.name)}</a>`);
  }
  if (showCategory && post.category) {
    bits.push(`<a class="cat" href="${esc(categoryPath(post.blog, post.category))}">${esc(post.category)}</a>`);
  }
  return `<li class="post">
            <p class="meta">${bits.join("")}</p>
            <h2><a href="${esc(post.url)}">${esc(post.title)}</a></h2>
          </li>`;
}

function postList(posts, options) {
  if (posts.length === 0) return `<p class="empty">아직 모은 글이 없습니다.</p>`;
  return `<ul class="posts">\n${posts.map((post) => postItem(post, options)).join("\n")}\n        </ul>`;
}

function categoryLinks(blogId, posts, current) {
  const counts = new Map();
  for (const post of posts) {
    if (!post.category) continue;
    counts.set(post.category, (counts.get(post.category) || 0) + 1);
  }
  const names = [...counts.keys()].sort((a, b) => a.localeCompare(b, "ko"));
  if (names.length === 0) return "";
  const links = names
    .map((name) => {
      const currentAttr = name === current ? ` aria-current="page"` : "";
      return `<a href="${esc(categoryPath(blogId, name))}"${currentAttr}>${esc(name)} <span>${counts.get(name)}</span></a>`;
    })
    .join("");
  return `<nav class="categories" aria-label="카테고리">${links}</nav>`;
}

function layout({ title, description, canonicalPath, current, main }) {
  const nav = [
    ["home", "/", "전체"],
    ...BLOGS.map((blog) => [blog.id, `/${blog.id}/`, blog.name]),
  ]
    .map(([id, href, label]) => {
      const currentAttr = id === current ? ` aria-current="page"` : "";
      return `<a href="${href}"${currentAttr}>${esc(label)}</a>`;
    })
    .join("");
  return `<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}">
    <link rel="canonical" href="${esc(absoluteUrl(canonicalPath))}">
    <meta name="robots" content="index,follow">
    <link rel="stylesheet" href="/assets/site.css">
  </head>
  <body>
    <div class="wrap">
      <header>
        <p class="kicker">공개된 글 목록</p>
        <h1>${esc(title.includes(" · ") ? title.split(" · ")[0] : current === "home" ? SITE.name : title.replace(` · ${SITE.name}`, ""))}</h1>
        <nav class="site" aria-label="블로그">${nav}</nav>
      </header>
      <main>
        ${main}
      </main>
    </div>
  </body>
</html>
`;
}

function countsLine(posts) {
  const bits = BLOGS.map((blog) => {
    const count = posts.filter((post) => post.blog === blog.id).length;
    return `${esc(blog.name)} ${count}편`;
  });
  return `<p class="counts">${bits.map((bit) => `<span>${bit}</span>`).join("")}</p>`;
}

function footer(data) {
  const stamp = data.updatedAt ? `<p>목록 기준 ${esc(formatStamp(data.updatedAt))}</p>` : "";
  return `<footer>
          ${stamp}
          <p>이미 공개된 글의 제목, 날짜, 카테고리, 링크만 보여 줍니다. 본문은 네이버 블로그에 있습니다.</p>
        </footer>`;
}

function pagePosts(posts) {
  return [...posts].sort(comparePosts);
}

export function renderSite(data) {
  const posts = pagePosts(data.posts);
  const files = {
    "assets/site.css": CSS.endsWith("\n") ? CSS : `${CSS}\n`,
    ".nojekyll": "",
    "robots.txt": `User-agent: *\nAllow: /\nDisallow: /data/\n\nSitemap: ${SITE.origin}/sitemap.xml\n`,
    "404.html": `<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>페이지를 찾을 수 없습니다 · ${esc(SITE.name)}</title>
    <meta name="description" content="요청한 페이지가 없습니다.">
    <meta name="robots" content="noindex">
    <link rel="stylesheet" href="/assets/site.css">
  </head>
  <body>
    <div class="wrap">
      <header>
        <p class="kicker">공개된 글 목록</p>
        <h1>페이지를 찾을 수 없습니다</h1>
        <nav class="site" aria-label="블로그"><a href="/">전체 목록으로</a></nav>
      </header>
      <main>
        <p class="lede">주소가 바뀌었거나 없는 페이지입니다.</p>
      </main>
    </div>
  </body>
</html>
`,
  };

  const pages = [{ path: "/", lastmod: latestDay(posts, data.updatedAt) }];

  files["index.html"] = layout({
    title: SITE.name,
    description: SITE.description,
    canonicalPath: "/",
    current: "home",
    main: `<p class="lede"><a href="${esc(BLOGS[0].home)}">${esc(BLOGS[0].name)}</a>와 <a href="${esc(BLOGS[1].home)}">${esc(BLOGS[1].name)}</a>에 이미 올라온 글을 최신순으로 모았습니다.</p>
        ${countsLine(posts)}
        ${postList(posts, { showBlog: true, showCategory: true })}
        ${footer(data)}`,
  });

  for (const blog of BLOGS) {
    const blogPosts = posts.filter((post) => post.blog === blog.id);
    const blogPath = `/${blog.id}/`;
    pages.push({ path: blogPath, lastmod: latestDay(blogPosts, data.updatedAt) });
    files[`${blog.id}/index.html`] = layout({
      title: `${blog.name} · ${SITE.name}`,
      description: blog.description,
      canonicalPath: blogPath,
      current: blog.id,
      main: `<p class="lede">${esc(blog.description)}</p>
        <p class="origin"><a href="${esc(blog.home)}">네이버 블로그에서 보기</a></p>
        ${categoryLinks(blog.id, blogPosts)}
        ${postList(blogPosts, { showBlog: false, showCategory: true })}
        ${footer(data)}`,
    });

    const categories = [...new Set(blogPosts.map((post) => post.category).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "ko"),
    );
    const used = new Map();
    for (const category of categories) {
      const slug = categorySlug(category);
      if (used.has(slug)) throw new Error(`카테고리 주소가 겹칩니다: ${category}`);
      used.set(slug, category);
      const list = blogPosts.filter((post) => post.category === category);
      const catPath = categoryPath(blog.id, category);
      pages.push({ path: catPath, lastmod: latestDay(list, data.updatedAt) });
      files[`${blog.id}/category/${slug}/index.html`] = layout({
        title: `${category} · ${blog.name}`,
        description: `${blog.name}의 ${category} 글 목록입니다.`,
        canonicalPath: catPath,
        current: blog.id,
        main: `<p class="lede">${esc(blog.name)} · ${esc(category)}</p>
        ${categoryLinks(blog.id, blogPosts, category)}
        ${postList(list, { showBlog: false, showCategory: false })}
        ${footer(data)}`,
      });
    }
  }

  files["sitemap.xml"] = renderSitemap(pages);
  return files;
}

function latestDay(posts, fallbackIso) {
  if (posts.length > 0) return posts.reduce((max, post) => (post.publishedAt > max ? post.publishedAt : max), posts[0].publishedAt).slice(0, 10);
  if (fallbackIso) return fallbackIso.slice(0, 10);
  return null;
}

function renderSitemap(pages) {
  const body = pages
    .map((page) => {
      const lastmod = page.lastmod ? `\n    <lastmod>${page.lastmod}</lastmod>` : "";
      return `  <url>\n    <loc>${esc(absoluteUrl(page.path))}</loc>${lastmod}\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function safeJoin(root, rel) {
  const dest = path.resolve(root, rel);
  const base = path.resolve(root);
  if (dest !== base && !dest.startsWith(`${base}${path.sep}`)) {
    throw new Error("출력 경로가 잘못되었습니다.");
  }
  return dest;
}

async function atomicWrite(dest, body) {
  const tmp = `${dest}.tmp`;
  await writeFile(tmp, body);
  await rename(tmp, dest);
}

async function removeStaleCategories(root, files) {
  for (const blog of BLOGS) {
    const dir = path.join(root, blog.id, "category");
    let names;
    try {
      names = await readdir(dir);
    } catch (err) {
      if (err && err.code === "ENOENT") continue;
      throw err;
    }
    for (const name of names) {
      const rel = `${blog.id}/category/${name}/index.html`;
      if (!files.has(rel)) await rm(path.join(dir, name), { recursive: true, force: true });
    }
  }
}

export async function writeSite(root, data, files) {
  for (const rel of Object.keys(files)) {
    const dest = safeJoin(root, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await atomicWrite(dest, files[rel]);
  }
  await removeStaleCategories(root, new Set(Object.keys(files)));
  const dataPath = safeJoin(root, "data/posts.json");
  await mkdir(path.dirname(dataPath), { recursive: true });
  const json = `${JSON.stringify({ updatedAt: data.updatedAt, posts: data.posts }, null, 2)}\n`;
  await atomicWrite(dataPath, json);
}

export async function updateHub({ root, fetchText = defaultFetchText, now = () => new Date(), blogs = BLOGS } = {}) {
  if (!root) throw new Error("출력 폴더가 없습니다.");
  const existing = await readDataset(path.join(root, "data", "posts.json"));
  const incoming = [];
  for (const blog of blogs) {
    let xml;
    try {
      xml = await fetchText(blog.rss);
    } catch (err) {
      throw new Error(`${blog.name} 피드를 읽지 못했습니다. 기존 목록은 유지합니다. ${err.message}`);
    }
    let posts;
    try {
      posts = parseFeed(xml, blog);
    } catch (err) {
      throw new Error(`${blog.name} 피드를 해석하지 못했습니다. 기존 목록은 유지합니다. ${err.message}`);
    }
    incoming.push(...posts);
  }
  const merged = mergePosts(existing.posts, incoming);
  assertNotShrinking(existing.posts, merged);
  const postsChanged = !samePosts(existing.posts, merged);
  const data = {
    updatedAt: postsChanged ? toKstIso(now()) : existing.updatedAt,
    posts: merged,
  };
  const files = renderSite(data);
  if (!postsChanged && !(await outputsDiffer(root, files))) return { changed: false, posts: merged };
  await writeSite(root, data, files);
  return { changed: true, posts: merged };
}

async function outputsDiffer(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    try {
      const current = await readFile(safeJoin(root, rel), "utf8");
      if (current !== body) return true;
    } catch {
      return true;
    }
  }
  return false;
}

export function countPosts(posts) {
  return Object.fromEntries(BLOGS.map((blog) => [blog.id, posts.filter((post) => post.blog === blog.id).length]));
}
