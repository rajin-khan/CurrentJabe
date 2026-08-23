const MAX_LOCALITY_NAME_LENGTH = 72;

const LATIN_UPPERCASE_TOKENS = new Set([
  "dohs",
  "r",
  "a",
]);

const LATIN_LOWERCASE_TOKENS = new Set(["and", "of", "the"]);
const BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯";

export type CanonicalLocalityName = {
  displayName: string;
  normalizedName: string;
  slugPart: string;
};

function titleCaseLatin(value: string): string {
  let wordIndex = 0;
  return value.replace(/[A-Za-z]+/g, (token) => {
    const lower = token.toLocaleLowerCase("en");
    const next = LATIN_UPPERCASE_TOKENS.has(lower)
      ? lower.toLocaleUpperCase("en")
      : wordIndex > 0 && LATIN_LOWERCASE_TOKENS.has(lower)
        ? lower
        : `${lower.charAt(0).toLocaleUpperCase("en")}${lower.slice(1)}`;
    wordIndex += 1;
    return next;
  });
}

function normalizeDigits(value: string): string {
  return value.replace(/[০-৯]/g, (digit) => String(BANGLA_DIGITS.indexOf(digit)));
}

export function normalizedLocationName(value: string): string {
  return normalizeDigits(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .replace(/defen[cs]e officers housing societ(?:y|ies)/g, "dohs")
    .replace(/residential areas?/g, "ra")
    .replace(/\b(?:road|rd)\b/g, "")
    .replace(/রোড/g, "")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "");
}

export function parentRelativeNormalizedLocationName(
  value: string,
  parentName: string,
  parentNameBn?: string | null,
): string {
  const normalized = normalizedLocationName(value);
  const parentNames = [parentName, parentNameBn]
    .filter((name): name is string => Boolean(name))
    .map(normalizedLocationName)
    .sort((left, right) => right.length - left.length);
  for (const normalizedParent of parentNames) {
    if (!normalized.startsWith(normalizedParent)) continue;
    const relative = normalized.slice(normalizedParent.length);
    if (relative.length >= 2) return relative;
  }
  return normalized;
}

export function slugifyLocalityName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
}

export function canonicalizeLocalityName(value: string): CanonicalLocalityName {
  if (/https?:|www\.|@/i.test(value)) {
    throw new Error("Enter an area name, not a link or contact detail.");
  }
  const phoneDigits = normalizeDigits(value).replace(/\D/g, "");
  const hasPrivateAddressUnit =
    /\b(?:house|flat|apartment|apt|holding|plot)\b/i.test(value) ||
    /(?:^|[\s,/-])(?:বাসা|বাড়ি|বাড়ি|ফ্ল্যাট|অ্যাপার্টমেন্ট|হোল্ডিং|প্লট)(?=$|[\s,/-])/u.test(value);
  if ((hasPrivateAddressUnit && !/^\s*house building\s*$/i.test(value)) || phoneDigits.length >= 7) {
    throw new Error("Use a neighborhood or road name—never a house, flat, phone number or personal detail.");
  }

  const cleaned = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/[’‘`´]/g, "'")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[／⁄]/g, "/")
    .replace(/[^\p{L}\p{M}\p{N}\s.,/'&()_-]+/gu, " ")
    .replace(/\s*([/-])\s*/g, "$1")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length < 2 || cleaned.length > MAX_LOCALITY_NAME_LENGTH) {
    throw new Error(`Area names must be between 2 and ${MAX_LOCALITY_NAME_LENGTH} characters.`);
  }
  if (!/[\p{L}]/u.test(cleaned)) {
    throw new Error("Area names must include at least one letter.");
  }
  const letters = cleaned.match(/\p{L}/gu) ?? [];
  if (letters.some((letter) => !/[\p{Script=Latin}\p{Script=Bengali}]/u.test(letter))) {
    throw new Error("Area names currently support English or Bangla text.");
  }

  const displayName = titleCaseLatin(cleaned)
    .replace(/\bR\/A\b/g, "R/A")
    .replace(/\bDohs\b/g, "DOHS");
  const normalizedName = normalizedLocationName(displayName);
  const slugPart = slugifyLocalityName(displayName) || "area";
  if (normalizedName.length < 2) {
    throw new Error("That area name cannot be formatted safely yet.");
  }
  return { displayName, normalizedName, slugPart };
}

export function localitySlugPart(displayName: string, parentName: string): string {
  const localityPart = slugifyLocalityName(displayName);
  const parentPart = slugifyLocalityName(parentName);
  if (localityPart.startsWith(`${parentPart}-`)) {
    return localityPart.slice(parentPart.length + 1) || localityPart;
  }
  return localityPart || "area";
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + cost,
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

export function localitySimilarity(left: string, right: string): number {
  const normalizedLeft = normalizedLocationName(left);
  const normalizedRight = normalizedLocationName(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;

  const leftNumbers = normalizeDigits(left).match(/\d+/g) ?? [];
  const rightNumbers = normalizeDigits(right).match(/\d+/g) ?? [];
  if (leftNumbers.join(":") !== rightNumbers.join(":")) return 0;

  const longest = Math.max(normalizedLeft.length, normalizedRight.length);
  return longest === 0 ? 0 : 1 - editDistance(normalizedLeft, normalizedRight) / longest;
}
