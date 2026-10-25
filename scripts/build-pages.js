import {
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "dist");
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
// Whitelist public assets. Never package data/, environment files, or résumé uploads.
const assets = [
  "index.html",
  "style.css",
  "app.js",
  "matching.js",
  "jobs.js",
  "demo.js",
  "browser-api.js",
  "feed-sync.js",
  "storage.js",
];
for (const asset of assets)
  cpSync(path.join(root, "public", asset), path.join(target, asset));
if (existsSync(path.join(root, "public/jobs-feed.json")))
  cpSync(
    path.join(root, "public/jobs-feed.json"),
    path.join(target, "jobs-feed.json"),
  );
const html = readFileSync(path.join(target, "index.html"), "utf8").replace(
  "<head>",
  '<head>\n    <meta name="shortlist-mode" content="browser">',
);
writeFileSync(path.join(target, "index.html"), html);
writeFileSync(path.join(target, ".nojekyll"), "");
console.log("Static GitHub Pages build created in dist/ (public assets only).");
