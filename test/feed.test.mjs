import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  BLOGS,
  assertNotShrinking,
  canonicalFromUrl,
  mergePosts,
  parseFeed,
  renderSite,
  toKstIso,
  updateHub,
} from "../scripts/lib.mjs";

const sportsBlog = BLOGS[0];
const musicBlog = BLOGS[1];
const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("canonical post URL drops the RSS tracking query", () => {
  const canon = canonicalFromUrl(
    "https://blog.naver.com/yangon_daddy/224000000001?fromRss=true&trackingCode=rss",
  );
  assert.deepEqual(canon, {
    naverId: "yangon_daddy",
    logNo: "224000000001",
    url: "https://blog.naver.com/yangon_daddy/224000000001",
  });
  assert.equal(canonicalFromUrl("https://example.com/yangon_daddy/224000000001"), null);
});

test("pubDate is stored as Korea time", () => {
  assert.equal(toKstIso(new Date("Thu, 19 Nov 2026 07:00:00 +0900")), "2026-11-19T07:00:00+09:00");
  assert.equal(toKstIso(new Date("2026-11-18T15:00:00Z")), "2026-11-19T00:00:00+09:00");
});

test("parser keeps title, category, date, and canonical URL only", async () => {
  const posts = parseFeed(await fixture("sports-feed.xml"), sportsBlog);
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0], {
    blog: "sports",
    logNo: "224000000001",
    title: "테스트 축구 제목",
    url: "https://blog.naver.com/yangon_daddy/224000000001",
    publishedAt: "2026-11-19T07:00:00+09:00",
    category: "내맘대로 축구",
  });
  assert.equal(posts[1].title, '따옴표 "있는" 제목 & 엔티티');
  const blob = JSON.stringify(posts);
  assert.equal(blob.includes("본문 발췌"), false);
  assert.equal(blob.includes("blogthumb"), false);
  assert.equal(blob.includes("@"), false);
  assert.equal(blob.includes("fromRss"), false);
});

test("unexpected feeds are rejected", async () => {
  const html = await fixture("not-a-feed.html");
  const empty = await fixture("empty-feed.xml");
  await assert.rejects(async () => parseFeed(html, sportsBlog));
  await assert.rejects(async () => parseFeed(empty, sportsBlog), /글이 없습니다/);
  const mostlyBroken = `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>
    <item><title>주소 없음</title></item>
    <item><title>또 없음</title></item>
    <item><title>하나만 정상</title><link>https://blog.naver.com/yangon_daddy/224000000009</link><pubDate>Thu, 19 Nov 2026 07:00:00 +0900</pubDate></item>
    </channel></rss>`;
  await assert.rejects(async () => parseFeed(mostlyBroken, sportsBlog), /충분히/);
});

test("merge keeps posts outside the RSS window and refreshes titles", () => {
  const existing = [
    {
      blog: "sports",
      logNo: "100000000001",
      title: "예전 글 제목",
      url: "https://blog.naver.com/yangon_daddy/100000000001",
      publishedAt: "2024-01-02T03:04:05+09:00",
      category: "내맘대로 농구",
    },
    {
      blog: "sports",
      logNo: "224000000001",
      title: "옛 제목",
      url: "https://blog.naver.com/yangon_daddy/224000000001",
      publishedAt: "2026-11-19T07:00:00+09:00",
      category: "내맘대로 축구",
    },
  ];
  const incoming = [
    {
      blog: "sports",
      logNo: "224000000001",
      title: "테스트 축구 제목",
      url: "https://blog.naver.com/yangon_daddy/224000000001",
      publishedAt: "2026-11-19T07:00:00+09:00",
      category: "내맘대로 축구",
    },
    {
      blog: "sports",
      logNo: "224000000001",
      title: "같은 글이 피드에 두 번",
      url: "https://blog.naver.com/yangon_daddy/224000000001",
      publishedAt: "2026-11-19T07:00:00+09:00",
      category: "내맘대로 축구",
    },
  ];
  const merged = mergePosts(existing, incoming);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].title, "같은 글이 피드에 두 번");
  assert.equal(merged[1].title, "예전 글 제목");
  assert.throws(() => assertNotShrinking(existing, merged.slice(0, 1)), /기존 글/);
});

test("pages link to Naver posts and the sitemap lists hub pages only", async () => {
  const sports = parseFeed(await fixture("sports-feed.xml"), sportsBlog);
  const music = parseFeed(await fixture("music-feed.xml"), musicBlog);
  const files = renderSite({
    updatedAt: "2026-11-19T09:00:00+09:00",
    posts: [...sports, ...music],
  });
  const index = files["index.html"];
  assert.match(index, /<html lang="ko">/);
  assert.match(index, /<title>내맘대로 글 모음<\/title>/);
  assert.match(index, /name="description"/);
  assert.match(index, /href="https:\/\/blog\.naver\.com\/yangon_daddy\/224000000001"/);
  assert.match(index, /href="https:\/\/blog\.naver\.com\/jpopsakurazaka\/223000000001"/);
  assert.equal(index.includes("<script"), false);
  assert.equal(index.includes("본문 발췌"), false);
  assert.equal(index.includes("blogthumb"), false);
  assert.equal(index.includes("@naver.com"), false);
  assert.ok(files["music/category/내한공연-라이브/index.html"]);
  assert.match(files["sports/index.html"], /내맘대로 야구/);
  assert.match(files["404.html"], /lang="ko"/);
  assert.match(files["robots.txt"], /Sitemap: https:\/\/yangondaddy77\.github\.io\/sitemap\.xml/);
  assert.match(files["sitemap.xml"], /<loc>https:\/\/yangondaddy77\.github\.io\/sports\/<\/loc>/);
  assert.match(
    files["sitemap.xml"],
    /music\/category\/%EB%82%B4%ED%95%9C%EA%B3%B5%EC%97%B0-%EB%9D%BC%EC%9D%B4%EB%B8%8C\//,
  );
  assert.equal(files["sitemap.xml"].includes("blog.naver.com"), false);
});

async function tempRoot() {
  return mkdtemp(path.join(tmpdir(), "hub-"));
}

test("a failed or unexpected fetch does not touch the saved list", async () => {
  const root = await tempRoot();
  const file = path.join(root, "data", "posts.json");
  await mkdir(path.dirname(file), { recursive: true });
  const original = `${JSON.stringify({
    updatedAt: "2020-01-01T00:00:00+09:00",
    posts: [],
  })}\n`;
  await writeFile(file, original);

  await assert.rejects(() =>
    updateHub({
      root,
      fetchText: async () => {
        throw new Error("network down");
      },
    }),
  );
  assert.equal(await readFile(file, "utf8"), original);
  await assert.rejects(() => access(path.join(root, "index.html")));

  const sportsXml = await fixture("sports-feed.xml");
  const broken = await fixture("not-a-feed.html");
  await assert.rejects(() =>
    updateHub({
      root,
      fetchText: async (url) => (url.includes("jpopsakurazaka") ? broken : sportsXml),
    }),
  );
  assert.equal(await readFile(file, "utf8"), original);
  await assert.rejects(() => access(path.join(root, "index.html")));
});

test("a successful merge writes both blogs and keeps older posts", async () => {
  const root = await tempRoot();
  const sportsXml = await fixture("sports-feed.xml");
  const musicXml = await fixture("music-feed.xml");
  const fetchText = async (url) => (url.includes("jpopsakurazaka") ? musicXml : sportsXml);
  const now = () => new Date("2026-11-19T00:00:00Z");
  const file = path.join(root, "data", "posts.json");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify({
      updatedAt: "2024-01-02T03:04:05+09:00",
      posts: [
        {
          blog: "sports",
          logNo: "100000000001",
          title: "예전 글 제목",
          url: "https://blog.naver.com/yangon_daddy/100000000001",
          publishedAt: "2024-01-02T03:04:05+09:00",
          category: "내맘대로 농구",
        },
        {
          blog: "sports",
          logNo: "224000000001",
          title: "옛 제목",
          url: "https://blog.naver.com/yangon_daddy/224000000001",
          publishedAt: "2026-11-19T07:00:00+09:00",
          category: "내맘대로 축구",
        },
      ],
    })}\n`,
  );

  const first = await updateHub({ root, fetchText, now });
  assert.equal(first.changed, true);
  assert.equal(first.posts.length, 5);
  assert.equal(first.posts.find((post) => post.logNo === "224000000001").title, "테스트 축구 제목");
  assert.ok(first.posts.some((post) => post.title === "예전 글 제목"));

  const written = await readFile(file, "utf8");
  const index = await readFile(path.join(root, "index.html"), "utf8");
  assert.match(index, /예전 글 제목/);
  assert.match(index, /테스트 공연 제목/);
  assert.equal(written.includes("본문 발췌"), false);
  assert.equal(index.includes("@naver.com"), false);

  const snapshot = written;
  const second = await updateHub({ root, fetchText, now: () => new Date("2026-12-01T00:00:00Z") });
  assert.equal(second.changed, false);
  assert.equal(await readFile(file, "utf8"), snapshot);

  await rm(path.join(root, "index.html"));
  const rebuilt = await updateHub({ root, fetchText, now: () => new Date("2026-12-02T00:00:00Z") });
  assert.equal(rebuilt.changed, true);
  assert.match(await readFile(path.join(root, "index.html"), "utf8"), /예전 글 제목/);
  assert.equal(await readFile(file, "utf8"), snapshot);
});
