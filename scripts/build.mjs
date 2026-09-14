// site/（編集用ソース）→ docs/（公開用）へビルドする。
// JS と CSS は esbuild で圧縮し、HTML はコメントと余分な空白を落とす。
// docs/data/ と docs/radar/data/ は収集スクリプトが書く JSON なので触らない。
import { readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join, dirname, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "site");
const OUT = join(ROOT, "docs");
const banner = `/* GameLab Radar — built ${new Date().toISOString().slice(0, 10)} */`;

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

function minifyHtml(html) {
  return html
    .replace(/<!--(?!\[if)[\s\S]*?-->/g, "") // 条件付きコメント以外のコメントを除去
    .replace(/>\s+</g, "><") // タグ間の空白
    .replace(/\s{2,}/g, " ")
    .trim();
}

let count = 0;
for (const file of await walk(SRC)) {
  const rel = relative(SRC, file);
  const dest = join(OUT, rel);
  await mkdir(dirname(dest), { recursive: true });
  const ext = extname(file).toLowerCase();
  const src = await readFile(file, "utf8");
  let out = src;
  if (ext === ".js") {
    // 圧縮 + 変数名の短縮。文字列（日本語の表示文言）はそのまま残る
    const r = await transform(src, { minify: true, target: "es2019", legalComments: "none" });
    out = `${banner}\n${r.code}`;
  } else if (ext === ".css") {
    const r = await transform(src, { loader: "css", minify: true, legalComments: "none" });
    out = `${banner}\n${r.code}`;
  } else if (ext === ".html") {
    out = minifyHtml(src);
  }
  await writeFile(dest, out, "utf8");
  count++;
  const before = Buffer.byteLength(src);
  const after = Buffer.byteLength(out);
  console.log(`${rel.padEnd(28)} ${String(before).padStart(7)} → ${String(after).padStart(7)} B (${Math.round((after / before) * 100)}%)`);
}
console.log(`built ${count} files → docs/`);
