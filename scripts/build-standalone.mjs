import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
const root = path.resolve("dist/client");
const mime = {
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".jpg": "image/jpeg",
};
async function dataUrl(file) {
  return `data:${mime[path.extname(file)] ?? "application/octet-stream"};base64,${(await readFile(file)).toString("base64")}`;
}
async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}
let html = await readFile(path.join(root, "index.html"), "utf8");
const scriptPath = html.match(/<script[^>]*src="([^"]+)"[^>]*><\/script>/)[1];
const cssPath = html.match(
  /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/,
)[1];
let script = await readFile(path.join(root, scriptPath), "utf8");
let css = await readFile(path.join(root, cssPath), "utf8");
for (const file of await walk(path.join(root, "assets"))) {
  if (!mime[path.extname(file)]) continue;
  const url = "/" + path.relative(root, file).split(path.sep).join("/");
  const embedded = await dataUrl(file);
  script = script.split(url).join(embedded);
  css = css.split(url).join(embedded);
  css = css.split("./" + path.basename(file)).join(embedded);
}
html = html.replace(
  /<script[^>]*src="[^"]+"[^>]*><\/script>/,
  () =>
    `<script type="module">${script.replace(/<\/script/gi, "<\\/script")}</script>`,
);
html = html.replace(
  /<link[^>]*rel="stylesheet"[^>]*>/,
  () => `<style>${css}</style>`,
);
html = html.replace(/<link[^>]*rel="manifest"[^>]*>/, "");
html = html.replace(
  /href="\/assets\/app\/baiwan-cat-192-v1.png"/,
  `href="${await dataUrl(path.join(root, "assets/app/baiwan-cat-192-v1.png"))}"`,
);
html = html.replace(
  /href="\/assets\/app\/baiwan-cat-180-v1.png"/,
  `href="${await dataUrl(path.join(root, "assets/app/baiwan-cat-180-v1.png"))}"`,
);
await writeFile("百万背单词-离线版.html", html);
console.log(
  `Standalone offline app: 百万背单词-离线版.html (${Math.round(Buffer.byteLength(html) / 1024)} KB)`,
);
