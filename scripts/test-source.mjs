// 収集元を 1 つだけ実行して結果を表示する開発用ツール
// 使い方: node scripts/test-source.mjs producthunt [件数]
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readJson, log } from "./lib/util.mjs";
import { SOURCES } from "./lib/sources.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = await readJson(join(ROOT, "config.json"));
const name = process.argv[2];
const limit = Number(process.argv[3] || 10);

if (!SOURCES[name]) {
  console.log("available:", Object.keys(SOURCES).join(", "));
  process.exit(1);
}

process.env.NEWSITES_DEBUG = "1";
const items = await SOURCES[name](config);
log(`${name}: ${items.length} items`);
for (const it of items.slice(0, limit)) {
  console.log(`- ${it.title} | ${it.url} | cats=${(it.phCategories || []).join(",")} tags=${(it.tags || []).join(",")} | img=${it.image ? "yes" : "no"}`);
}
