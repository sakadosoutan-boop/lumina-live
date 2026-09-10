import { build } from "vite";
import react from "@vitejs/plugin-react";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = path.join(root, "release", "Lumina-Live-offline.html");

// A separate in-memory build leaves dist and electron-builder's release files
// intact. Never scan/copy public or the external 20 GB asset library.
const result = await build({
  root,
  configFile: false,
  publicDir: false,
  plugins: [react()],
  base: "./",
  build: {
    target: "es2022",
    write: false,
    emptyOutDir: false,
    copyPublicDir: false,
    sourcemap: false,
    cssCodeSplit: false,
    modulePreload: false,
    assetsInlineLimit: (_name, content) => content.length <= 1024 * 1024,
    rollupOptions: {
      input: path.join(root, "src", "main.tsx"),
      output: {
        format: "iife",
        name: "LuminaLive",
        inlineDynamicImports: true,
      },
    },
  },
});
if (!("output" in result)) throw new Error("Expected one standalone bundle");
const chunks = result.output.filter((item) => item.type === "chunk");
const styles = result.output.filter(
  (item) => item.type === "asset" && item.fileName.endsWith(".css"),
);
const extraAssets = result.output.filter(
  (item) => item.type === "asset" && !item.fileName.endsWith(".css"),
);
if (
  chunks.length !== 1 ||
  chunks[0].imports.length ||
  chunks[0].dynamicImports.length ||
  extraAssets.length
) {
  throw new Error(
    "Standalone build must contain one script and inline CSS only; external/large assets are not bundled",
  );
}
const js = chunks[0].code.replace(/<\/script/gi, "<\\/script");
const css = styles
  .map((item) => String(item.source))
  .join("\n")
  .replace(/<\/style/gi, "<\\/style");
if (/@import\s/i.test(css) || /url\(\s*["']?(?!data:|#)[^\s"')]+/i.test(css)) {
  throw new Error("Standalone CSS still contains an external resource");
}
const template = await readFile(path.join(root, "index.html"), "utf8");
const entry =
  /<script\b[^>]*\bsrc=["']\/src\/main\.tsx["'][^>]*>\s*<\/script>/i;
if (!entry.test(template))
  throw new Error("Cannot locate the renderer entry in index.html");
const html = template
  .replace(entry, () => `<script>${js}</script>`)
  .replace("</head>", () => `<style>${css}</style></head>`);
if (
  /<(?:script|link)\b[^>]*(?:src|href)\s*=/i.test(html) ||
  /<script\b[^>]*type=["']module/i.test(html)
) {
  throw new Error(
    "Standalone HTML must not load external scripts, styles or modules",
  );
}
if (Buffer.byteLength(html) > 16 * 1024 * 1024)
  throw new Error("Standalone HTML exceeds 16 MiB; keep media external");
await mkdir(path.dirname(destination), { recursive: true });
const temp = destination + ".tmp";
await writeFile(temp, html, "utf8");
await rename(temp, destination);
const webDestination = path.join(root, "web", "Lumina-Live.html");
await mkdir(path.dirname(webDestination), { recursive: true });
await writeFile(webDestination, html, "utf8");
// GitHub Pages serves /docs. Publish the exact tested application, including
// bundled presets, instead of maintaining a hand-written second entrypoint.
const pagesDir = path.join(root, "docs");
await mkdir(path.join(pagesDir, "assets"), { recursive: true });
await writeFile(path.join(pagesDir, "index.html"), html, "utf8");
await writeFile(path.join(pagesDir, ".nojekyll"), "", "utf8");
await writeFile(path.join(pagesDir, "assets", "catalog.json"), "[]\n", "utf8");
console.log(
  `Standalone HTML: ${destination} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KiB)`,
);
