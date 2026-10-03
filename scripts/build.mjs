// site/（編集用ソース）→ docs/（公開用）へビルドする。
// JS と CSS は esbuild で圧縮し、HTML はコメントと余分な空白を落とす。
// docs/data/ と docs/radar/data/ は収集スクリプトが書く JSON なので触らない。
import { readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join, dirname, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";
import sharp from "sharp";

// カードのサムネイル枠は 382x200 程度なので、その 2 倍を上限に縮小する
const IMAGE_MAX_WIDTH = 800;
const IMAGE_QUALITY = 82;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "site");
const OUT = join(ROOT, "docs");
// 日付は入れない。中身が変わっていなくても毎日 docs/ に差分が出て、収集のたびに
// 無意味なコミットと FTP アップロードが発生するため
const banner = `/* GameLab Radar */`;

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    // _partials/ などの「_」始まりは HTML に埋め込む部品なので、そのままは出力しない
    if (e.name.startsWith("_")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

// 共通のヘッダー・フッターは site/_partials/ に置き、<!--#include header --> の位置に差し込む。
// 部品の中の {{base}} は、そのページの <body data-base="../"> の値（トップは空）に置き換える。
const PARTIALS = join(SRC, "_partials");
const partialCache = new Map();
async function expandIncludes(html) {
  const base = (html.match(/<body[^>]*\sdata-base="([^"]*)"/) || [])[1] || "";
  const names = [...html.matchAll(/<!--#include (\w+) -->/g)].map((m) => m[1]);
  for (const name of names) {
    if (!partialCache.has(name)) partialCache.set(name, await readFile(join(PARTIALS, `${name}.html`), "utf8"));
  }
  return html.replace(/<!--#include (\w+) -->/g, (_, name) =>
    partialCache.get(name).replaceAll("{{base}}", base).replaceAll("{{home}}", base || "./")
  );
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

  // 画像は表示サイズに合わせて縮小・再圧縮する（元ファイルは site/ にそのまま残す）
  if (ext === ".jpg" || ext === ".jpeg" || ext === ".png") {
    // 出力が元画像より新しければ作り直さない（1.5MB の再圧縮を毎回の収集で走らせないため）
    const [srcStat, destStat] = await Promise.all([stat(file), stat(dest).catch(() => null)]);
    if (destStat && destStat.mtimeMs >= srcStat.mtimeMs) {
      console.log(`${rel.padEnd(28)} (変更なしのためスキップ)`);
      continue;
    }
    const buf = await readFile(file);
    const meta = await sharp(buf).metadata();
    let img = sharp(buf).rotate();
    if ((meta.width || 0) > IMAGE_MAX_WIDTH) img = img.resize({ width: IMAGE_MAX_WIDTH });
    const data = ext === ".png" ? await img.png({ compressionLevel: 9 }).toBuffer() : await img.jpeg({ quality: IMAGE_QUALITY, mozjpeg: true }).toBuffer();
    await writeFile(dest, data);
    count++;
    console.log(`${rel.padEnd(28)} ${String(buf.length).padStart(7)} → ${String(data.length).padStart(7)} B (${Math.round((data.length / buf.length) * 100)}%)`);
    continue;
  }

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
    out = minifyHtml(await expandIncludes(src));
  }
  await writeFile(dest, out, "utf8");
  count++;
  const before = Buffer.byteLength(src);
  const after = Buffer.byteLength(out);
  console.log(`${rel.padEnd(28)} ${String(before).padStart(7)} → ${String(after).padStart(7)} B (${Math.round((after / before) * 100)}%)`);
}
console.log(`built ${count} files → docs/`);
