#!/usr/bin/env node

import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const locationsPath = join(root, "data", "locations.json");
const mapPath = join(root, "data", "map-paths.json");
const metroThanasPath = join(root, "data", "metropolitan-thanas.json");
const locations = JSON.parse(readFileSync(locationsPath, "utf8"));
const map = JSON.parse(readFileSync(mapPath, "utf8"));
const metroThanas = JSON.parse(readFileSync(metroThanasPath, "utf8"));
const errors = [];

function check(condition, message) {
  if (!condition) errors.push(message);
}

check(Array.isArray(locations), "locations.json must contain an array");
const metroRows = metroThanas.districts.flatMap((district) =>
  district.thanas.map((thana) => ({
    ...thana,
    district: district.district,
    districtBn: district.districtBn,
  })),
);
const metroInstanceCount = metroRows.reduce((total, row) => total + (row.instanceCount ?? 1), 0);
check(metroThanas.expectedLocationCount === 102, "expected the BBS roster contract to contain 102 unique choices");
check(metroThanas.expectedInstanceCount === 105, "expected the BBS roster contract to contain 105 city-corporation instances");
check(metroRows.length === metroThanas.expectedLocationCount, "metro-thana unique count does not match its contract");
check(metroInstanceCount === metroThanas.expectedInstanceCount, "metro-thana instance count does not match its contract");
for (const district of metroThanas.districts) {
  const instances = district.thanas.reduce((total, row) => total + (row.instanceCount ?? 1), 0);
  check(instances === district.expectedInstanceCount, `${district.district}: metro-thana instance count changed`);
}
for (const sourceUrl of metroThanas.sourceUrls ?? []) {
  check(/^https:\/\//.test(sourceUrl), `metro-thana registry source must use HTTPS: ${sourceUrl}`);
}

const expectedUpazilaCount = 498;
const expectedLocationCount = expectedUpazilaCount + metroThanas.expectedLocationCount + 1;
check(locations.length === expectedLocationCount, `expected ${expectedLocationCount} searchable units, received ${locations.length}`);
check(
  locations.filter((location) => location.kind === "upazila").length === expectedUpazilaCount,
  "expected 495 PHC upazilas plus the three NICAR-approved July 2026 units",
);
check(
  locations.filter((location) => location.kind === "thana").length === metroThanas.expectedLocationCount,
  `expected all ${metroThanas.expectedLocationCount} unique BBS metro-thana choices`,
);
check(
  locations.filter((location) => location.kind === "locality").length === 1,
  "expected one explicitly sourced finer locality",
);
check(new Set(locations.map((location) => location.district)).size === 64, "expected all 64 districts");
for (const district of new Set(locations.map((location) => location.district))) {
  const banglaNames = new Set(
    locations.filter((location) => location.district === district).map((location) => location.districtBn),
  );
  check(banglaNames.size === 1, `${district}: district must have one consistent Bangla name`);
}
check(new Set(locations.map((location) => location.slug)).size === locations.length, "location slugs must be unique");
check(new Set(locations.map((location) => location.id)).size === locations.length, "location IDs must be unique");

const validProviders = new Set(["bpdb", "breb", "dpdc", "desco", "wzpdcl", "nesco"]);
const locationIds = new Set(locations.map((location) => location.id));
const locationsById = new Map(locations.map((location) => [location.id, location]));
const normalizedNames = new Map();
function normalizeName(value) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}
function searchMatches(query) {
  const needle = normalizeName(query);
  return locations.filter((location) =>
    [location.upazila, location.upazilaBn, ...(location.aliases ?? [])]
      .filter(Boolean)
      .some((value) => normalizeName(value).startsWith(needle)),
  );
}
for (const location of locations) {
  check(location.id === location.slug, `${location.slug}: id and slug must remain identical`);
  check(Boolean(location.district && location.upazila), `${location.slug}: missing English name`);
  for (const [field, value] of Object.entries({
    district: location.district,
    districtBn: location.districtBn,
    upazila: location.upazila,
    upazilaBn: location.upazilaBn,
  })) {
    if (typeof value !== "string") continue;
    check(value === value.trim(), `${location.slug}: ${field} has surrounding whitespace`);
    check(!/[\u0000-\u001f\u007f]/.test(value), `${location.slug}: ${field} contains a control character`);
  }
  const normalizedKey = `${location.district}|${location.kind}|${normalizeName(location.upazila)}`;
  check(!normalizedNames.has(normalizedKey), `${location.slug}: duplicates ${normalizedNames.get(normalizedKey)} within district and kind`);
  normalizedNames.set(normalizedKey, location.slug);
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
  if (location.kind === "thana") {
    check(Boolean(location.upazilaBn), `${location.slug}: missing verified Bangla thana name`);
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

const metroIds = new Set(metroRows.map((row) => row.id));
check(metroIds.size === metroRows.length, "metro-thana registry IDs must be unique");
for (const row of metroRows) {
  const location = locationsById.get(row.id);
  check(Boolean(location), `${row.id}: roster entry is missing from locations.json`);
  if (!location) continue;
  check(location.kind === "thana", `${row.id}: roster entry must be typed as a thana`);
  check(location.district === row.district, `${row.id}: district differs from the roster`);
  check(location.districtBn === row.districtBn, `${row.id}: Bangla district differs from the roster`);
  check(location.upazila === row.name, `${row.id}: English name differs from the roster`);
  check(location.upazilaBn === row.nameBn, `${row.id}: Bangla name differs from the roster`);
  for (const alias of row.aliases ?? []) {
    check(location.aliases?.includes(alias), `${row.id}: missing roster alias ${alias}`);
  }
  if (row.geocode) check(/^\d{8}$/.test(row.geocode), `${row.id}: invalid official geocode`);
}
for (const location of locations.filter((row) => row.kind === "thana")) {
  check(metroIds.has(location.id), `${location.id}: thana is not in the BBS registry`);
}

const bhatara = locationsById.get("dhaka-bhatara");
check(bhatara?.aliases?.includes("Vatara"), "Bhatara must remain searchable as Vatara");
check(bhatara?.upazilaBn === "ভাটারা", "Bhatara must include its Bangla name");
check(bhatara?.providerHints?.includes("desco"), "Bhatara must retain its sourced DESCO hint");
check(
  bhatara?.providerMappings?.some((mapping) => mapping.providerId === "desco"),
  "Bhatara must retain its direct DESCO source mapping",
);
for (const query of ["Vatara", "ভাটারা"]) {
  check(
    JSON.stringify(searchMatches(query).map((location) => location.id))
      === JSON.stringify(["dhaka-bhatara"]),
    `${query}: search must resolve only to Bhatara`,
  );
}
check(
  JSON.stringify(searchMatches("Gazipur Sadar").map((location) => location.id))
    === JSON.stringify(["gazipur-gazipur-sadar"]),
  "Gazipur Sadar search must not resolve to Joydebpur",
);
const baddaAggregateId = "geo-dhaka-badda-2020-aggregate";
for (const baddaId of ["dhaka-badda", "dhaka-bhatara"]) {
  const baddaScope = locationsById.get(baddaId);
  check(!baddaScope?.geometryAvailable, `${baddaId}: legacy Badda aggregate must not be exact`);
  check(
    baddaScope?.approximateMapFeatureIds?.includes(baddaAggregateId),
    `${baddaId}: must reference the legacy Badda aggregate only as approximate`,
  );
}
check(!locationsById.has("dhaka-uttara"), "legacy aggregate Uttara ID must not be reused");
check(locationsById.get("dhaka-uttara-purba")?.providerHints?.includes("desco"), "Uttara Purba must retain DESCO");
check(locationsById.get("dhaka-uttara-pashchim")?.providerHints?.includes("desco"), "Uttara Pashchim must retain DESCO");
const uttaraAggregateId = "geo-dhaka-uttara-2020-aggregate";
for (const uttaraId of ["dhaka-uttara-purba", "dhaka-uttara-pashchim"]) {
  const uttara = locationsById.get(uttaraId);
  check(!uttara?.geometryAvailable, `${uttaraId}: legacy aggregate must not be claimed as exact`);
  check(
    uttara?.approximateMapFeatureIds?.includes(uttaraAggregateId),
    `${uttaraId}: must reference the legacy Uttara aggregate only as approximate`,
  );
  check(
    !(uttara?.aliases ?? []).some((alias) => normalizeName(alias) === "uttara"),
    `${uttaraId}: bare Uttara must not resolve to only one side of the split`,
  );
}
check(
  JSON.stringify(searchMatches("Uttara").map((location) => location.id).sort())
    === JSON.stringify(["dhaka-uttara-pashchim", "dhaka-uttara-purba"]),
  "bare Uttara search must offer both current BBS scopes",
);
const exactMetroLocations = locations.filter(
  (location) => location.kind === "thana" && location.geometryAvailable,
);
const approximateMetroLocations = locations.filter(
  (location) => location.kind === "thana" && location.approximateMapFeatureIds?.length,
);
const fallbackMetroLocations = locations.filter(
  (location) => location.kind === "thana"
    && !location.geometryAvailable
    && !location.approximateMapFeatureIds?.length,
);
check(
  exactMetroLocations.length === 0,
  "legacy metro polygons must remain approximate until their current BBS extents are verified",
);
check(approximateMetroLocations.length === 63, "expected 63 metro-thana choices with approximate orientation");
check(fallbackMetroLocations.length === 39, "expected 39 metro-thana choices with district fallback");
const approvedSplitScopes = [
  {
    featureId: "geo-chattogram-fatikchhari-2020-aggregate",
    locationIds: ["chattogram-fatikchhari", "chattogram-fatikchhari-north"],
  },
  {
    featureId: "geo-cumilla-muradnagar-2020-aggregate",
    locationIds: ["cumilla-muradnagar", "cumilla-bangara"],
  },
  {
    featureId: "geo-mymensingh-gafargaon-2020-aggregate",
    locationIds: ["mymensingh-gafargaon", "mymensingh-gafargaon-south"],
  },
];
for (const { featureId, locationIds: splitLocationIds } of approvedSplitScopes) {
  for (const locationId of splitLocationIds) {
    const splitLocation = locationsById.get(locationId);
    check(splitLocation?.kind === "upazila", `${locationId}: approved split upazila is missing`);
    check(!splitLocation?.geometryAvailable, `${locationId}: pre-split aggregate must not be exact`);
    check(
      splitLocation?.approximateMapFeatureIds?.includes(featureId),
      `${locationId}: must reference its pre-split aggregate only as approximate`,
    );
  }
}
check(locationsById.get("rajshahi-matihar")?.providerHints?.includes("nesco"), "Matihar must retain NESCO");

const distinctSameNameScopes = [
  ["cumilla-cumilla-adarsha-sadar", "cumilla-adarsha-sadar-thana"],
  ["cumilla-cumilla-sadar-dakshin", "cumilla-sadar-dakkhin-thana"],
  ["mymensingh-mymensingh-sadar", "mymensingh-mymensingh-sadar-thana"],
  ["narayanganj-bandar", "narayanganj-bandar-thana"],
  ["narayanganj-narayanganj-sadar", "narayanganj-narayanganj-sadar-thana"],
  ["sylhet-dakshinsurma", "sylhet-dakkhin-surma-thana"],
];
for (const [upazilaId, thanaId] of distinctSameNameScopes) {
  check(locationsById.get(upazilaId)?.kind === "upazila", `${upazilaId}: same-name upazila scope was lost`);
  check(locationsById.get(thanaId)?.kind === "thana", `${thanaId}: city-corporation thana scope was lost`);
}

check(JSON.stringify(map.viewBox) === JSON.stringify([0, 0, 720, 960]), "unexpected shared SVG viewBox");
check(Array.isArray(map.features), "map-paths.json features must be an array");
check(map.features.length === 544, `expected 544 boundary features, received ${map.features.length}`);
check(new Set(map.features.map((feature) => feature.id)).size === map.features.length, "map feature IDs must be unique");

const geometryIds = new Set(map.features.map((feature) => feature.id));
check(
  [...metroIds].every((id) => !geometryIds.has(id)),
  "unverified metro-thana IDs must not double as exact-looking map feature IDs",
);
const metroApproximateFeatureIds = new Set(
  locations
    .filter((location) => location.kind === "thana")
    .flatMap((location) => location.approximateMapFeatureIds ?? []),
);
check(
  metroApproximateFeatureIds.size === 61,
  "expected all 61 legacy metro outlines to have neutral approximate feature IDs",
);
check(
  [...metroApproximateFeatureIds].every((id) => id.startsWith("geo-") && geometryIds.has(id)),
  "every approximate metro outline must resolve to a neutral map feature",
);
const locationsWithGeometry = new Set(
  locations.filter((location) => location.geometryAvailable).map((location) => location.id),
);
const sourcedCoverageIds = new Set([
  ...locationsWithGeometry,
  ...locations.flatMap((location) => location.approximateMapFeatureIds ?? []),
]);
check(
  geometryIds.size === sourcedCoverageIds.size && [...geometryIds].every((id) => sourcedCoverageIds.has(id)),
  "every map feature must provide exact or explicitly approximate location coverage",
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
  `Geographic data valid: ${locations.length} locations (${metroThanas.expectedLocationCount} unique BBS metro-thanas / ${metroThanas.expectedInstanceCount} instances; ${districtFallbacks} district-fallback, ${approximateLocations} approximate), ${map.features.length} SVG features, ${Math.round(statSync(mapPath).size / 1024)} KiB.`,
);
