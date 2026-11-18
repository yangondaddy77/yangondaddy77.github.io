import path from "node:path";
import { fileURLToPath } from "node:url";
import { BLOGS, countPosts, updateHub } from "./lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  try {
    const result = await updateHub({ root });
    if (!result.changed) {
      console.log("변경 없음");
      return;
    }
    const counts = countPosts(result.posts);
    const summary = BLOGS.map((blog) => `${blog.name} ${counts[blog.id]}편`).join(", ");
    console.log(`목록을 갱신했습니다. ${summary}. 전체 ${result.posts.length}편.`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : "갱신에 실패했습니다. 기존 목록은 유지합니다.");
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
