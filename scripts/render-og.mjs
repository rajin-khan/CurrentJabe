import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptsDir, "..");
const templatePath = join(scriptsDir, "og-card.html");
const mapPath = join(projectRoot, "data", "map-paths.json");
const outputPath = join(projectRoot, "public", "opengraph-image.png");

const assetUrl = (path) => pathToFileURL(join(projectRoot, path)).href;

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} failed${details ? `:\n${details}` : "."}`);
  }
}

const [template, rawMap] = await Promise.all([
  readFile(templatePath, "utf8"),
  readFile(mapPath, "utf8"),
]);
const map = JSON.parse(rawMap);
const paths = map.features
  .map((feature) => `<path d="${feature.path}" />`)
  .join("");

const html = template
  .replace("__SATOSHI_REGULAR__", assetUrl("app/fonts/satoshi-400.woff2"))
  .replace("__SATOSHI_MEDIUM__", assetUrl("app/fonts/satoshi-500.woff2"))
  .replace("__SATOSHI_BOLD__", assetUrl("app/fonts/satoshi-700.woff2"))
  .replace("__CURRENTJABE_MARK__", assetUrl("public/brand/currentjabe-mark-v3.png"))
  .replace("<!-- MAP_PATHS -->", paths);

const previewDirectory = await mkdtemp(join(tmpdir(), "currentjabe-og-"));
const renderedHtmlPath = join(previewDirectory, "currentjabe-og.html");
const previewPath = `${renderedHtmlPath}.png`;

try {
  await writeFile(renderedHtmlPath, html, "utf8");
  run("qlmanage", ["-t", "-s", "1200", "-o", previewDirectory, renderedHtmlPath]);
  run("ffmpeg", [
    "-y",
    "-i",
    previewPath,
    "-vf",
    "crop=1200:630:0:0",
    "-frames:v",
    "1",
    outputPath,
  ]);
  process.stdout.write(`Rendered ${outputPath}\n`);
} finally {
  await rm(previewDirectory, { recursive: true, force: true });
}
