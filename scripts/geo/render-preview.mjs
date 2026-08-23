#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const output = resolve(process.argv[2] ?? join(root, "data", "map-preview.svg"));
const map = JSON.parse(readFileSync(join(root, "data", "map-paths.json"), "utf8"));
const paths = map.features
  .map(
    (feature, index) =>
      `<path d="${feature.path}" fill="${index % 9 === 0 ? "#f3d9d4" : "#f7f2ec"}" stroke="#8c2f22" stroke-width="0.35" vector-effect="non-scaling-stroke"/>`,
  )
  .join("");

writeFileSync(
  output,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${map.viewBox.join(" ")}" fill-rule="evenodd"><rect width="720" height="960" fill="#fffaf3"/>${paths}</svg>`,
);
console.log(output);

