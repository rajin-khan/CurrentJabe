#!/usr/bin/env node

import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const locationsPath = join(root, "data", "locations.json");
const mapPath = join(root, "data", "map-paths.json");
const locations = JSON.parse(readFileSync(locationsPath, "utf8"));
const map = JSON.parse(readFileSync(mapPath, "utf8"));
const errors = [];

function check(condition, message) {
  if (!condition) errors.push(message);
}

check(Array.isArray(locations), "locations.json must contain an array");
check(locations.length === 557, `expected 557 searchable units, received ${locations.length}`);
check(
  locations.filter((location) => location.kind === "upazila").length === 495,
  "expected the published 495-upazila hierarchy",
);
check(
  locations.filter((location) => location.kind === "thana").length === 61,
  "expected 61 metropolitan thana records from the boundary source",
);
check(
  locations.filter((location) => location.kind === "locality").length === 1,
  "expected one explicitly sourced finer locality",
);
check(new Set(locations.map((location) => location.district)).size === 64, "expected all 64 districts");
check(new Set(locations.map((location) => location.slug)).size === locations.length, "location slugs must be unique");
check(new Set(locations.map((location) => location.id)).size === locations.length, "location IDs must be unique");

const validProviders = new Set(["bpdb", "breb", "dpdc", "desco", "wzpdcl", "nesco"]);
const locationIds = new Set(locations.map((location) => location.id));
for (const location of locations) {
  check(location.id === location.slug, `${location.slug}: id and slug must remain identical`);
  check(Boolean(location.district && location.upazila), `${location.slug}: missing English name`);
  check(Array.isArray(location.providerHints), `${location.slug}: providerHints must be an array`);
  for (const provider of location.providerHints ?? []) {
    check(validProviders.has(provider), `${location.slug}: unknown provider ${provider}`);
  }
  for (const mapping of location.providerMappings ?? []) {
    check(validProviders.has(mapping.providerId), `${location.slug}: unknown mapped provider ${mapping.providerId}`);
    check(location.providerHints.includes(mapping.providerId), `${location.slug}: mapped provider must also be a display hint`);
    check(/^https:\/\//.test(mapping.sourceUrl), `${location.slug}: provider mapping must cite an HTTPS source`);
    check(
      ["confirmed", "probable", "unverified"].includes(mapping.confidence),
      `${location.slug}: invalid provider mapping confidence`,
    );
  }
  if (location.kind === "upazila") {
    check(Boolean(location.upazilaBn), `${location.slug}: missing verified Bangla upazila name`);
  }
  if (location.kind === "locality") {
    check(Boolean(location.parentId), `${location.slug}: locality must have a parent location`);
    check(Boolean(location.upazilaBn), `${location.slug}: locality must have a Bangla display name`);
    check(!location.geometryAvailable, `${location.slug}: locality must not claim an administrative polygon`);
    check(
      Array.isArray(location.approximateMapFeatureIds) && location.approximateMapFeatureIds.length > 0,
      `${location.slug}: locality must declare approximate map coverage`,
    );
  }
  if (location.parentId) {
    check(locationIds.has(location.parentId), `${location.slug}: unknown parent ${location.parentId}`);
    check(location.parentId !== location.id, `${location.slug}: location cannot parent itself`);
  }
  check(
    !(location.geometryAvailable && location.approximateMapFeatureIds?.length),
    `${location.slug}: exact and approximate geometry cannot both be declared`,
  );
}

check(JSON.stringify(map.viewBox) === JSON.stringify([0, 0, 720, 960]), "unexpected shared SVG viewBox");
check(Array.isArray(map.features), "map-paths.json features must be an array");
check(map.features.length === 544, `expected 544 boundary features, received ${map.features.length}`);
check(new Set(map.features.map((feature) => feature.id)).size === map.features.length, "map feature IDs must be unique");

const geometryIds = new Set(map.features.map((feature) => feature.id));
const locationsWithGeometry = new Set(
  locations.filter((location) => location.geometryAvailable).map((location) => location.id),
);
check(
  geometryIds.size === locationsWithGeometry.size && [...geometryIds].every((id) => locationsWithGeometry.has(id)),
  "geometryAvailable locations and map feature IDs must match exactly",
);

for (const location of locations) {
  for (const featureId of location.approximateMapFeatureIds ?? []) {
    check(geometryIds.has(featureId), `${location.slug}: unknown approximate map feature ${featureId}`);
  }
  if (location.parentId) {
    const parent = locations.find((candidate) => candidate.id === location.parentId);
    check(parent?.district === location.district, `${location.slug}: parent must be in the same district`);
  }
}

for (const feature of map.features) {
  check(typeof feature.path === "string" && feature.path.startsWith("M") && feature.path.endsWith("Z"), `${feature.id}: invalid SVG path`);
  check(!/NaN|Infinity/.test(feature.path), `${feature.id}: non-finite SVG coordinate`);
  check(Array.isArray(feature.bbox) && feature.bbox.length === 4, `${feature.id}: invalid bbox`);
  check(Array.isArray(feature.labelPoint) && feature.labelPoint.length === 2, `${feature.id}: invalid label point`);
}

check(statSync(mapPath).size < 1_000_000, "map path payload exceeded the 1 MB target");

if (errors.length) {
  console.error(`Geographic data validation failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const districtFallbacks = locations.filter(
  (location) => !location.geometryAvailable && !location.approximateMapFeatureIds?.length,
).length;
const approximateLocations = locations.filter(
  (location) => !location.geometryAvailable && location.approximateMapFeatureIds?.length,
).length;
console.log(
  `Geographic data valid: ${locations.length} locations (${districtFallbacks} district-fallback, ${approximateLocations} approximate), ${map.features.length} SVG features, ${Math.round(statSync(mapPath).size / 1024)} KiB.`,
);
