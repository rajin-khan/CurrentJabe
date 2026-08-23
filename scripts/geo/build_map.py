#!/usr/bin/env python3
"""Build CurrentJabe's compact Bangladesh location and SVG-path datasets.

This script intentionally uses only Python's standard library. The source files
are pinned, attributable public datasets; see data/SOURCES.md for provenance and
licensing. It accepts local copies so rebuilding does not require network access.

Example:
  python3 scripts/geo/build_map.py \
    --adm2 /tmp/bgd-adm2.geojson \
    --adm3 /tmp/bgd-adm3.geojson \
    --district-names /tmp/nuhil-districts.json \
    --upazila-names /tmp/nuhil-upazilas.json \
    --metro-thanas data/metropolitan-thanas.json
"""

from __future__ import annotations

import argparse
import json
import math
import re
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Iterable, Sequence


VIEWBOX_WIDTH = 720.0
VIEWBOX_HEIGHT = 960.0
VIEWBOX_PADDING = 22.0
SIMPLIFY_TOLERANCE_PX = 0.32


DISTRICT_RENAMES = {
    "barisal": "Barishal",
    "bogra": "Bogura",
    "brahamanbaria": "Brahmanbaria",
    "chittagong": "Chattogram",
    "comilla": "Cumilla",
    "coxsbazar": "Cox's Bazar",
    "jessore": "Jashore",
    "jhalokati": "Jhalakathi",
    "jhalakathi": "Jhalakathi",
    "maulvibazar": "Moulvibazar",
    "nawabganj": "Chapainawabganj",
    "netrakona": "Netrokona",
    "netrokona": "Netrokona",
}


DISTRICT_BN_OVERRIDES = {
    "mymensingh": "ময়মনসিংহ",
    "narayanganj": "নারায়ণগঞ্জ",
}


# The boundary snapshot predates both current split scopes and the PHC 2022
# roster. Keep known aggregate outlines only as neutral orientation features so
# no current unit claims them as an exact boundary.
LEGACY_AGGREGATE_FEATURE_RENAMES = {
    "chattogram-fatikchhari": "geo-chattogram-fatikchhari-2020-aggregate",
    "cumilla-muradnagar": "geo-cumilla-muradnagar-2020-aggregate",
    "dhaka-badda": "geo-dhaka-badda-2020-aggregate",
    "dhaka-uttara": "geo-dhaka-uttara-2020-aggregate",
    "mymensingh-gafargaon": "geo-mymensingh-gafargaon-2020-aggregate",
}

# `dhaka-uttara` was an aggregate product bucket before the BBS Purba/Pashchim
# split was reconciled. It must not be silently reused for either current scope,
# because production evidence is keyed by this stable ID.
RETIRED_SOURCE_LOCATION_IDS = {"dhaka-uttara"}

ADMIN_APPROXIMATE_FEATURES = {
    "chattogram-fatikchhari": ["geo-chattogram-fatikchhari-2020-aggregate"],
    "chattogram-fatikchhari-north": ["geo-chattogram-fatikchhari-2020-aggregate"],
    "cumilla-muradnagar": ["geo-cumilla-muradnagar-2020-aggregate"],
    "cumilla-bangara": ["geo-cumilla-muradnagar-2020-aggregate"],
    "mymensingh-gafargaon": ["geo-mymensingh-gafargaon-2020-aggregate"],
    "mymensingh-gafargaon-south": ["geo-mymensingh-gafargaon-2020-aggregate"],
}

METRO_APPROXIMATE_FEATURES = {
    "dhaka-badda": ["geo-dhaka-badda-2020-aggregate"],
    "dhaka-bhatara": ["geo-dhaka-badda-2020-aggregate"],
    "dhaka-uttara-pashchim": ["geo-dhaka-uttara-2020-aggregate"],
    "dhaka-uttara-purba": ["geo-dhaka-uttara-2020-aggregate"],
}

# A name match between the 2020 ADM3 snapshot and a PHC 2022 thana is not proof
# that their extents are identical. Add an ID here only after independently
# verifying the polygon against the current BBS scope. Until then every legacy
# metro polygon is an explicitly approximate orientation aid.
VERIFIED_EXACT_METRO_BOUNDARY_IDS: set[str] = set()


# Renames that happened after the 2020 boundary snapshot. The geometry remains
# the source polygon, while the UI gets the current public-facing name.
UNIT_RENAMES = {
    ("Sunamganj", "Dakshin Sunamganj"): (
        "Shantiganj",
        "শান্তিগঞ্জ",
        ["Dakshin Sunamganj", "South Sunamganj"],
    ),
    ("Pirojpur", "Zianagar"): (
        "Indurkani",
        "ইন্দুরকানী",
        ["Zianagar"],
    ),
}


# These reference upazilas post-date, or are absent from, the 2020 polygon
# snapshot. They remain searchable and explicitly have no polygon.
NO_GEOMETRY_REFERENCE_UNITS = {
    ("Barguna", "Taltali"),
    ("Chattogram", "Karnafuli"),
    ("Cox's Bazar", "Eidgaon"),
    ("Cumilla", "Lalmai"),
    ("Khagrachhari", "Guimara"),
    ("Madaripur", "Dasar"),
    ("Mymensingh", "Tarakanda"),
    ("Natore", "Naldanga"),
    ("Patuakhali", "Rangabali"),
    ("Sylhet", "Osmaninagar"),
    ("Sunamganj", "Madhyanagar"),
}


# Official units absent from the pinned 2023 bilingual reference snapshot.
# The last three were approved by NICAR on 2026-07-01 and intentionally have no
# invented codes or split polygons while BBS/DGHS reference data catches up.
OFFICIAL_SUPPLEMENTAL_UNITS = [
    {
        "district": "Habiganj",
        "districtBn": "হবিগঞ্জ",
        "upazila": "Shayestaganj",
        "upazilaBn": "শায়েস্তাগঞ্জ",
        "aliases": ["Shaistaganj", "Shaistagonj"],
    },
    {
        "district": "Chattogram",
        "districtBn": "চট্টগ্রাম",
        "upazila": "Fatikchhari North",
        "upazilaBn": "ফটিকছড়ি উত্তর",
        "aliases": ["North Fatikchhari", "Fatikchhari Uttar"],
    },
    {
        "district": "Cumilla",
        "districtBn": "কুমিল্লা",
        "upazila": "Bangara",
        "upazilaBn": "বাঙ্গরা",
        "aliases": ["Bangora", "Bangra"],
    },
    {
        "district": "Mymensingh",
        "districtBn": "ময়মনসিংহ",
        "upazila": "Gafargaon South",
        "upazilaBn": "দক্ষিণ গফরগাঁও",
        "aliases": ["South Gafargaon", "Dakshin Gafargaon"],
    },
]


# Finer-than-thana catalog areas are added only when an official source names
# the locality and its utility relationship. Their map references are explicitly
# approximate administrative orientation, never invented locality/feeder shapes.
SOURCED_LOCALITIES = [
    {
        "id": "dhaka-mirpur-dohs",
        "slug": "dhaka-mirpur-dohs",
        "district": "Dhaka",
        "districtBn": "ঢাকা",
        "upazila": "Mirpur DOHS",
        "upazilaBn": "মিরপুর ডিওএইচএস",
        "providerHints": ["desco"],
        "kind": "locality",
        "parentId": "dhaka-pallabi",
        "geometryAvailable": False,
        "approximateMapFeatureIds": ["dhaka-pallabi", "dhaka-turag"],
        "providerMappings": [
            {
                "providerId": "desco",
                "sourceUrl": "https://www.adb.org/projects/documents/ban-55040-001-iee",
                "sourceLabel": "ADB-hosted DESCO project study naming the Mirpur DOHS-1 and Mirpur DOHS-2 distribution routes",
                "confidence": "confirmed",
            }
        ],
        "aliases": [
            "DOHS Mirpur",
            "Mirpur Defence Officers Housing Scheme",
            "মিরপুর ডিওএইচএস",
        ],
    }
]


REFERENCE_NAME_OVERRIDES = {
    ("Cumilla", "Comilla Adarsha Sadar"): "Comilla Sadar",
    ("Cumilla", "Comilla Sadar Dakshin"): "Sadarsouth",
    ("Jashore", "Kotwali"): "Jessore Sadar",
    ("Khulna", "Dacope"): "Dakop",
    ("Khulna", "Paikgachha"): "Paikgasa",
    ("Khulna", "Phultala"): "Fultola",
    ("Kurigram", "Raumari"): "Rowmari",
    ("Lakshmipur", "Roypur"): "Raipur",
    ("Narsingdi", "Roypura"): "Raipura",
    ("Nilphamari", "Saidpur"): "Syedpur",
    ("Noakhali", "Senbagh"): "Senbug",
    ("Sirajganj", "Royganj"): "Raigonj",
    ("Sunamganj", "Sulla"): "Shalla",
}


CANONICAL_UNIT_NAMES = {
    ("Barishal", "Barisal Sadar (Kotwali)"): "Barishal Sadar",
    ("Bogura", "Bogra Sadar"): "Bogura Sadar",
    ("Chattogram", "Chittagong Port"): "Chattogram Port",
    ("Cumilla", "Comilla Adarsha Sadar"): "Cumilla Adarsha Sadar",
    ("Cumilla", "Comilla Sadar Dakshin"): "Cumilla Sadar Dakshin",
    ("Jashore", "Kotwali"): "Jashore Sadar",
    ("Khulna", "Dacope"): "Dacope",
    ("Khulna", "Paikgachha"): "Paikgachha",
    ("Khulna", "Phultala"): "Phultala",
    ("Kurigram", "Raumari"): "Rowmari",
    ("Lakshmipur", "Roypur"): "Raipur",
    ("Narsingdi", "Roypura"): "Raipura",
    ("Nilphamari", "Saidpur"): "Saidpur",
    ("Noakhali", "Senbagh"): "Senbagh",
    ("Sirajganj", "Royganj"): "Raiganj",
    ("Sunamganj", "Sulla"): "Shalla",
}


CANONICAL_UNIT_BN = {
    ("Cumilla", "Cumilla Adarsha Sadar"): "কুমিল্লা আদর্শ সদর",
    ("Cumilla", "Cumilla Sadar Dakshin"): "কুমিল্লা সদর দক্ষিণ",
}


@dataclass(frozen=True)
class Projector:
    min_lon_scaled: float
    max_lat: float
    scale: float
    x_offset: float
    y_offset: float
    cos_lat: float

    def point(self, lon: float, lat: float) -> tuple[float, float]:
        x = self.x_offset + (lon * self.cos_lat - self.min_lon_scaled) * self.scale
        y = self.y_offset + (self.max_lat - lat) * self.scale
        return x, y


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    value = value.lower().replace("&", "and")
    return re.sub(r"[^a-z0-9]+", "", value)


def slugify(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    value = value.lower().replace("&", "and").replace("'", "")
    return re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", value))


def canonical_district(source_name: str) -> str:
    return DISTRICT_RENAMES.get(normalize(source_name), source_name)


def load_metro_thanas(path: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    rows: list[dict[str, Any]] = []
    district_instance_count = 0
    for district_group in payload.get("districts", []):
        group_rows = district_group.get("thanas", [])
        group_instances = sum(row.get("instanceCount", 1) for row in group_rows)
        expected_group_instances = district_group.get("expectedInstanceCount")
        if group_instances != expected_group_instances:
            raise ValueError(
                f"Metro-thana instance mismatch for {district_group.get('district')}: "
                f"expected {expected_group_instances}, received {group_instances}"
            )
        district_instance_count += group_instances
        for row in group_rows:
            rows.append(
                {
                    **row,
                    "district": district_group["district"],
                    "districtBn": district_group["districtBn"],
                }
            )

    ids = [row["id"] for row in rows]
    if len(ids) != len(set(ids)):
        duplicates = sorted({row_id for row_id in ids if ids.count(row_id) > 1})
        raise ValueError(f"Duplicate metro-thana IDs: {duplicates}")
    if len(rows) != payload.get("expectedLocationCount"):
        raise ValueError(
            f"Metro-thana location mismatch: expected {payload.get('expectedLocationCount')}, "
            f"received {len(rows)}"
        )
    if district_instance_count != payload.get("expectedInstanceCount"):
        raise ValueError(
            f"Metro-thana instance mismatch: expected {payload.get('expectedInstanceCount')}, "
            f"received {district_instance_count}"
        )
    return payload, rows


def phpmyadmin_rows(payload: Any) -> list[dict[str, str]]:
    if isinstance(payload, list):
        for item in payload:
            if isinstance(item, dict) and item.get("type") == "table":
                rows = item.get("data")
                if isinstance(rows, list):
                    return rows
    raise ValueError("Expected phpMyAdmin JSON export with a table data array")


def iter_rings(geometry: dict[str, Any]) -> Iterable[list[list[float]]]:
    if geometry["type"] == "Polygon":
        yield from geometry["coordinates"]
    elif geometry["type"] == "MultiPolygon":
        for polygon in geometry["coordinates"]:
            yield from polygon
    else:
        raise ValueError(f"Unsupported geometry: {geometry['type']}")


def iter_outer_rings(geometry: dict[str, Any]) -> Iterable[list[list[float]]]:
    if geometry["type"] == "Polygon":
        yield geometry["coordinates"][0]
    elif geometry["type"] == "MultiPolygon":
        for polygon in geometry["coordinates"]:
            yield polygon[0]
    else:
        raise ValueError(f"Unsupported geometry: {geometry['type']}")


def signed_area(ring: Sequence[Sequence[float]]) -> float:
    area = 0.0
    for index, (x1, y1) in enumerate(ring):
        x2, y2 = ring[(index + 1) % len(ring)]
        area += x1 * y2 - x2 * y1
    return area / 2.0


def polygon_centroid(ring: Sequence[Sequence[float]]) -> tuple[float, float]:
    area = signed_area(ring)
    if abs(area) < 1e-12:
        return (
            sum(point[0] for point in ring) / len(ring),
            sum(point[1] for point in ring) / len(ring),
        )
    cx = 0.0
    cy = 0.0
    for index, (x1, y1) in enumerate(ring):
        x2, y2 = ring[(index + 1) % len(ring)]
        cross = x1 * y2 - x2 * y1
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    factor = 1.0 / (6.0 * area)
    return cx * factor, cy * factor


def point_in_ring(point: tuple[float, float], ring: Sequence[Sequence[float]]) -> bool:
    x, y = point
    inside = False
    previous = ring[-1]
    for current in ring:
        x1, y1 = current
        x2, y2 = previous
        if (y1 > y) != (y2 > y):
            crossing_x = (x2 - x1) * (y - y1) / (y2 - y1) + x1
            if x < crossing_x:
                inside = not inside
        previous = current
    return inside


def point_in_geometry(point: tuple[float, float], geometry: dict[str, Any]) -> bool:
    if geometry["type"] == "Polygon":
        polygons = [geometry["coordinates"]]
    else:
        polygons = geometry["coordinates"]
    for polygon in polygons:
        if point_in_ring(point, polygon[0]) and not any(
            point_in_ring(point, hole) for hole in polygon[1:]
        ):
            return True
    return False


def representative_candidates(geometry: dict[str, Any]) -> list[tuple[float, float]]:
    outer_rings = sorted(iter_outer_rings(geometry), key=lambda ring: abs(signed_area(ring)), reverse=True)
    candidates: list[tuple[float, float]] = []
    for ring in outer_rings[:4]:
        ring_without_close = ring[:-1] if ring[0] == ring[-1] else ring
        centroid = polygon_centroid(ring_without_close)
        candidates.append(centroid)
        xs = [point[0] for point in ring_without_close]
        ys = [point[1] for point in ring_without_close]
        candidates.append(((min(xs) + max(xs)) / 2.0, (min(ys) + max(ys)) / 2.0))
        candidates.extend(
            (float(ring_without_close[index][0]), float(ring_without_close[index][1]))
            for index in range(0, len(ring_without_close), max(1, len(ring_without_close) // 24))
        )
    return candidates


def interior_point(geometry: dict[str, Any]) -> tuple[float, float]:
    """Return a stable point inside the largest polygon without GIS packages."""
    outer_rings = sorted(iter_outer_rings(geometry), key=lambda ring: abs(signed_area(ring)), reverse=True)
    for ring in outer_rings:
        source = ring[:-1] if ring[0] == ring[-1] else ring
        centroid = polygon_centroid(source)
        if point_in_geometry(centroid, geometry):
            return centroid
        xs = [point[0] for point in source]
        ys = [point[1] for point in source]
        center = ((min(xs) + max(xs)) / 2.0, (min(ys) + max(ys)) / 2.0)
        if point_in_geometry(center, geometry):
            return center

        # Find the widest interior segment across several scanlines. This also
        # works for the highly concave coastal polygons whose centroid is water.
        best: tuple[float, tuple[float, float]] | None = None
        for fraction in (0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8):
            y = min(ys) + (max(ys) - min(ys)) * fraction
            intersections: list[float] = []
            previous = source[-1]
            for current in source:
                x1, y1 = previous
                x2, y2 = current
                if (y1 > y) != (y2 > y):
                    intersections.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
                previous = current
            intersections.sort()
            for index in range(0, len(intersections) - 1, 2):
                left = intersections[index]
                right = intersections[index + 1]
                point = ((left + right) / 2.0, y)
                width = right - left
                if width > 0 and point_in_geometry(point, geometry) and (best is None or width > best[0]):
                    best = (width, point)
        if best:
            return best[1]
    raise ValueError("Could not find a point inside geometry")


def locate_parent(
    geometry: dict[str, Any], district_features: Sequence[dict[str, Any]]
) -> dict[str, Any]:
    point = interior_point(geometry)
    direct = [feature for feature in district_features if point_in_geometry(point, feature["geometry"])]
    if len(direct) == 1:
        return direct[0]

    # Boundary snapshots are independently simplified, so an interior ADM3
    # point can occasionally fall just outside every ADM2 polygon. Score several
    # interior candidates as a conservative fallback.
    scores: list[tuple[int, dict[str, Any]]] = []
    candidates = [candidate for candidate in representative_candidates(geometry) if point_in_geometry(candidate, geometry)]
    for feature in district_features:
        score = sum(point_in_geometry(candidate, feature["geometry"]) for candidate in candidates)
        if score:
            scores.append((score, feature))
    scores.sort(key=lambda item: item[0], reverse=True)
    if scores and (len(scores) == 1 or scores[0][0] > scores[1][0]):
        return scores[0][1]
    for point in representative_candidates(geometry):
        matches = [feature for feature in district_features if point_in_geometry(point, feature["geometry"])]
        if len(matches) == 1:
            return matches[0]
    raise ValueError("Could not assign an ADM3 feature to exactly one ADM2 district")


def point_segment_distance(
    point: tuple[float, float], start: tuple[float, float], end: tuple[float, float]
) -> float:
    px, py = point
    x1, y1 = start
    x2, y2 = end
    dx = x2 - x1
    dy = y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(px - x1, py - y1)
    t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))


def simplify_rdp(
    points: Sequence[tuple[float, float]], tolerance: float
) -> list[tuple[float, float]]:
    if len(points) <= 3:
        return list(points)
    max_distance = 0.0
    split_index = 0
    for index in range(1, len(points) - 1):
        distance = point_segment_distance(points[index], points[0], points[-1])
        if distance > max_distance:
            max_distance = distance
            split_index = index
    if max_distance <= tolerance:
        return [points[0], points[-1]]
    left = simplify_rdp(points[: split_index + 1], tolerance)
    right = simplify_rdp(points[split_index:], tolerance)
    return left[:-1] + right


def format_number(value: float) -> str:
    rounded = round(value, 1)
    if rounded == int(rounded):
        return str(int(rounded))
    return f"{rounded:.1f}"


def make_projector(features: Sequence[dict[str, Any]]) -> Projector:
    points = [
        point
        for feature in features
        for ring in iter_rings(feature["geometry"])
        for point in ring
    ]
    min_lon = min(point[0] for point in points)
    max_lon = max(point[0] for point in points)
    min_lat = min(point[1] for point in points)
    max_lat = max(point[1] for point in points)
    mean_lat = (min_lat + max_lat) / 2.0
    cos_lat = math.cos(math.radians(mean_lat))
    min_lon_scaled = min_lon * cos_lat
    max_lon_scaled = max_lon * cos_lat
    available_width = VIEWBOX_WIDTH - 2 * VIEWBOX_PADDING
    available_height = VIEWBOX_HEIGHT - 2 * VIEWBOX_PADDING
    scale = min(
        available_width / (max_lon_scaled - min_lon_scaled),
        available_height / (max_lat - min_lat),
    )
    content_width = (max_lon_scaled - min_lon_scaled) * scale
    content_height = (max_lat - min_lat) * scale
    return Projector(
        min_lon_scaled=min_lon_scaled,
        max_lat=max_lat,
        scale=scale,
        x_offset=(VIEWBOX_WIDTH - content_width) / 2.0,
        y_offset=(VIEWBOX_HEIGHT - content_height) / 2.0,
        cos_lat=cos_lat,
    )


def geometry_to_path(
    geometry: dict[str, Any], projector: Projector
) -> tuple[str, list[float], list[float]]:
    commands: list[str] = []
    all_points: list[tuple[float, float]] = []
    for ring in iter_rings(geometry):
        source = ring[:-1] if ring[0] == ring[-1] else ring
        projected = [projector.point(float(lon), float(lat)) for lon, lat in source]
        quantized: list[tuple[float, float]] = []
        for point in projected:
            rounded = (round(point[0], 1), round(point[1], 1))
            if not quantized or rounded != quantized[-1]:
                quantized.append(rounded)
        if len(quantized) < 3:
            continue
        simplified = simplify_rdp(quantized, SIMPLIFY_TOLERANCE_PX)
        if len(simplified) < 3:
            simplified = quantized[:3]
        all_points.extend(simplified)
        commands.append(
            "M"
            + "L".join(f"{format_number(x)},{format_number(y)}" for x, y in simplified)
            + "Z"
        )
    if not all_points:
        raise ValueError("Geometry produced no SVG path")
    xs = [point[0] for point in all_points]
    ys = [point[1] for point in all_points]
    bbox = [round(min(xs), 1), round(min(ys), 1), round(max(xs) - min(xs), 1), round(max(ys) - min(ys), 1)]
    representative = interior_point(geometry)
    label_x, label_y = projector.point(*representative)
    return "".join(commands), bbox, [round(label_x, 1), round(label_y, 1)]


def possible_name_keys(value: str) -> set[str]:
    values = {value, re.sub(r"\([^)]*\)", "", value)}
    replacements = {
        "south": "dakshin",
        "north": "uttar",
        "sadar dakshin": "sadar south",
        "chhari": "chari",
        "chhara": "chara",
        "ganj": "gonj",
        "para": "para",
    }
    keys: set[str] = set()
    for candidate in values:
        keys.add(normalize(candidate))
        lowered = candidate.lower()
        for source, target in replacements.items():
            lowered = lowered.replace(source, target)
        keys.add(normalize(lowered))
    return {key for key in keys if key}


def match_reference_unit(
    district: str,
    source_name: str,
    reference_by_district: dict[str, list[dict[str, str]]],
    claimed_ids: set[str],
) -> dict[str, str] | None:
    candidates = [row for row in reference_by_district.get(normalize(district), []) if row["id"] not in claimed_ids]
    override = REFERENCE_NAME_OVERRIDES.get((district, source_name))
    if override:
        matched = [row for row in candidates if normalize(row["name"]) == normalize(override)]
        if len(matched) != 1:
            raise ValueError(f"Reference override did not resolve uniquely: {district}: {source_name}")
        return matched[0]
    source_keys = possible_name_keys(source_name)
    exact = [
        row
        for row in candidates
        if source_keys & possible_name_keys(row["name"])
    ]
    if len(exact) == 1:
        return exact[0]

    scored: list[tuple[float, dict[str, str]]] = []
    for row in candidates:
        score = max(
            SequenceMatcher(None, left, right).ratio()
            for left in source_keys
            for right in possible_name_keys(row["name"])
        )
        scored.append((score, row))
    scored.sort(key=lambda item: item[0], reverse=True)
    if scored and scored[0][0] >= 0.78 and (len(scored) == 1 or scored[0][0] - scored[1][0] >= 0.06):
        return scored[0][1]
    return None


def provider_hints(
    district: str,
    unit: str,
    kind: str,
    aliases: Sequence[str] = (),
) -> list[str]:
    district_key = normalize(district)
    unit_keys = {normalize(unit), *(normalize(alias) for alias in aliases)}
    hints: set[str] = set()

    nesco_units = {
        "rajshahi": {"tanore", "godagari", "paba", "boalia", "matihar", "rajpara", "shahmakhdum"},
        "chapainawabganj": {"chapainawabganjsadar", "nawabganjsadar", "gomastapur", "shibganj"},
        "pabna": {"pabnasadar", "ishwardi"},
        "natore": {"natoresadar"},
        "bogura": {"bogurasadar", "shajahanpur", "kahaloo", "sherpur", "adamdighi", "shibganj", "dhupchanchia"},
        "joypurhat": {"akkelpur", "joypurhatsadar"},
        "naogaon": {"naogaonsadar"},
        "sirajganj": {"sirajganjsadar"},
        "rangpur": {"rangpursadar"},
        "lalmonirhat": {"lalmonirhatsadar", "patgram", "hatibandha", "kaliganj"},
        "kurigram": {"kurigramsadar"},
        "gaibandha": {"gaibandhasadar", "gobindaganj", "palashbari"},
        "nilphamari": {"nilphamarisadar", "jaldhaka", "kishoreganj", "domar", "saidpur"},
        "dinajpur": {"dinajpursadar", "bochaganj", "fulbari", "parbatipur"},
        "thakurgaon": {"thakurgaonsadar"},
        "panchagarh": {"panchagarhsadar", "tentulia"},
    }
    if unit_keys & nesco_units.get(district_key, set()):
        hints.add("nesco")

    wzpdcl_units = {
        ("khulna", "phultala"),
        ("khulna", "dighalia"),
        ("bagerhat", "mongla"),
        ("satkhira", "kaliganj"),
        ("jhenaidah", "kotchandpur"),
        ("jhenaidah", "maheshpur"),
        ("jhenaidah", "shailkupa"),
        ("chuadanga", "alamdanga"),
        ("kushtia", "bheramara"),
        ("kushtia", "kumarkhali"),
        ("rajbari", "pangsha"),
        ("rajbari", "goalandaghat"),
        ("faridpur", "madhukhali"),
        ("faridpur", "sadarpur"),
        ("faridpur", "bhanga"),
        ("pirojpur", "bhandaria"),
        ("bhola", "burhanuddin"),
        ("bhola", "charfasson"),
        ("bhola", "manpura"),
        ("jhalokati", "nalchity"),
        ("jhalokati", "kanthalia"),
    }
    wzpdcl_districts = {
        "khulna", "bagerhat", "satkhira", "narail", "jashore", "jhenaidah", "magura", "kushtia", "meherpur", "chuadanga",
        "faridpur", "rajbari", "madaripur", "shariatpur", "gopalganj", "barishal", "jhalokati", "patuakhali", "barguna", "bhola", "pirojpur",
    }
    if any((district_key, unit_key) in wzpdcl_units for unit_key in unit_keys) or (
        district_key in wzpdcl_districts and any(unit_key.endswith("sadar") for unit_key in unit_keys)
    ):
        hints.add("wzpdcl")

    desco_dhaka_units = {
        "mirpur", "pallabi", "kafrul", "cantonment", "gulshan", "badda", "bhatara", "vatara",
        "uttara", "uttaraeast", "uttarapurba", "uttarawest", "uttarapashchim", "uttarkhan", "dakshinkhan",
    }
    if district_key == "dhaka" and unit_keys & desco_dhaka_units:
        hints.add("desco")
    if district_key == "narayanganj" and "rupganj" in unit_keys:
        hints.add("desco")

    # DPDC's official coverage statement covers Dhaka City Corporation areas and
    # parts of Narayanganj. This is still only a candidate hint: administrative
    # thana/upazila borders do not equal distribution boundaries.
    if district_key == "dhaka" and kind == "thana" and "desco" not in hints:
        hints.add("dpdc")
    if district_key == "narayanganj" and "narayanganjsadar" in unit_keys:
        hints.add("dpdc")

    return sorted(hints)


def build(args: argparse.Namespace) -> None:
    adm2 = json.loads(Path(args.adm2).read_text(encoding="utf-8"))
    adm3 = json.loads(Path(args.adm3).read_text(encoding="utf-8"))
    district_rows = phpmyadmin_rows(json.loads(Path(args.district_names).read_text(encoding="utf-8")))
    unit_rows = phpmyadmin_rows(json.loads(Path(args.upazila_names).read_text(encoding="utf-8")))
    metro_payload, metro_thanas = load_metro_thanas(args.metro_thanas)

    district_by_id = {row["id"]: row for row in district_rows}
    district_bn = {
        normalize(canonical_district(row["name"])): DISTRICT_BN_OVERRIDES.get(
            normalize(canonical_district(row["name"])), row["bn_name"].strip()
        )
        for row in district_rows
    }
    reference_by_district: dict[str, list[dict[str, str]]] = {}
    for row in unit_rows:
        district_row = district_by_id[row["district_id"]]
        district_name = canonical_district(district_row["name"])
        reference_by_district.setdefault(normalize(district_name), []).append(row)

    district_features = adm2["features"]
    unit_features = adm3["features"]
    projector = make_projector(unit_features)
    claimed_reference_ids: set[str] = set()
    locations: list[dict[str, Any]] = []
    map_features: list[dict[str, Any]] = []
    unmatched_geometry: list[str] = []

    for feature in unit_features:
        source_unit = feature["properties"]["shapeName"].strip()
        district_feature = locate_parent(feature["geometry"], district_features)
        source_district = district_feature["properties"]["shapeName"].strip()
        district = canonical_district(source_district)
        reference = match_reference_unit(
            district, source_unit, reference_by_district, claimed_reference_ids
        )
        if reference:
            claimed_reference_ids.add(reference["id"])
            unit = reference["name"]
            unit_bn = (reference.get("bn_name") or "").strip() or None
            kind = "upazila"
        else:
            unit = source_unit
            unit_bn = None
            kind = "thana"
            unmatched_geometry.append(f"{district}: {source_unit}")

        canonical_unit = CANONICAL_UNIT_NAMES.get((district, source_unit))
        if canonical_unit:
            unit = canonical_unit
        unit_bn = CANONICAL_UNIT_BN.get((district, unit), unit_bn)
        aliases = sorted({name for name in [source_unit, reference["name"] if reference else None] if name and name != unit})
        rename = UNIT_RENAMES.get((district, source_unit)) or UNIT_RENAMES.get((district, unit))
        if rename:
            current_name, current_bn, former_names = rename
            aliases = sorted(set(aliases + [unit] + former_names) - {current_name})
            unit = current_name
            unit_bn = current_bn

        slug = f"{slugify(district)}-{slugify(unit)}"
        location = {
            "id": slug,
            "slug": slug,
            "district": district,
            "upazila": unit,
            "providerHints": provider_hints(district, unit, kind),
            "kind": kind,
            "geometryAvailable": True,
        }
        bn = district_bn.get(normalize(district))
        if bn:
            location["districtBn"] = bn
        if unit_bn:
            location["upazilaBn"] = unit_bn
        if aliases:
            location["aliases"] = aliases
        locations.append(location)

        path, bbox, label_point = geometry_to_path(feature["geometry"], projector)
        map_features.append(
            {
                "id": slug,
                "slug": slug,
                "district": district,
                "path": path,
                "bbox": bbox,
                "labelPoint": label_point,
            }
        )

    # Keep post-2020 units searchable without drawing a false polygon. The UI can
    # select the parent district and state that a precise boundary is unavailable.
    for row in unit_rows:
        if row["id"] in claimed_reference_ids:
            continue
        district_row = district_by_id[row["district_id"]]
        district = canonical_district(district_row["name"])
        unit = row["name"]
        if (district, unit) not in NO_GEOMETRY_REFERENCE_UNITS:
            raise ValueError(f"Unexpected unmatched bilingual reference row: {district}: {unit}")
        slug = f"{slugify(district)}-{slugify(unit)}"
        location = {
            "id": slug,
            "slug": slug,
            "district": district,
            "districtBn": district_bn.get(normalize(district)),
            "upazila": unit,
            "upazilaBn": (row.get("bn_name") or "").strip() or None,
            "providerHints": provider_hints(district, unit, "upazila"),
            "kind": "upazila",
            "geometryAvailable": False,
        }
        locations.append({key: value for key, value in location.items() if value is not None})
        claimed_reference_ids.add(row["id"])

    for supplemental in OFFICIAL_SUPPLEMENTAL_UNITS:
        district = supplemental["district"]
        unit = supplemental["upazila"]
        slug = f"{slugify(district)}-{slugify(unit)}"
        locations.append(
            {
                "id": slug,
                "slug": slug,
                "district": district,
                "districtBn": supplemental["districtBn"],
                "upazila": unit,
                "upazilaBn": supplemental["upazilaBn"],
                "providerHints": provider_hints(district, unit, "upazila"),
                "kind": "upazila",
                "geometryAvailable": False,
                "aliases": supplemental["aliases"],
            }
        )

    # The 2020 boundary snapshot happens to contain 61 urban thana outlines, but
    # that accidental subset is neither a national roster nor proof of current
    # extent. Give every unverified metro outline a neutral feature ID before
    # reconciling it against the complete PHC 2022 registry. This also prevents
    # stale live-state keys from coloring an approximate polygon.
    all_source_geometry_thana_ids = {
        location["id"]
        for location in locations
        if location["kind"] == "thana" and location["geometryAvailable"]
    }
    metro_feature_ids = {
        location_id: (
            location_id
            if location_id in VERIFIED_EXACT_METRO_BOUNDARY_IDS
            else LEGACY_AGGREGATE_FEATURE_RENAMES.get(
                location_id, f"geo-{location_id}-legacy-approximate"
            )
        )
        for location_id in all_source_geometry_thana_ids
    }
    for feature in map_features:
        replacement_id = LEGACY_AGGREGATE_FEATURE_RENAMES.get(
            feature["id"], metro_feature_ids.get(feature["id"])
        )
        if replacement_id:
            feature["id"] = replacement_id
            feature["slug"] = replacement_id

    locations = [
        location
        for location in locations
        if location["id"] not in RETIRED_SOURCE_LOCATION_IDS
    ]

    # Add remaining roster records as either explicitly approximate orientation
    # references or district fallbacks. Never invent a polygon or overwrite an
    # upazila that happens to share a name.
    location_indexes = {location["id"]: index for index, location in enumerate(locations)}
    for location_id, approximate_feature_ids in ADMIN_APPROXIMATE_FEATURES.items():
        location_index = location_indexes.get(location_id)
        if location_index is None:
            raise ValueError(f"Approximate admin override has no location: {location_id}")
        location = locations[location_index]
        if location["kind"] != "upazila":
            raise ValueError(f"Approximate admin override is not an upazila: {location_id}")
        location["geometryAvailable"] = False
        location["approximateMapFeatureIds"] = approximate_feature_ids

    roster_ids = {row["id"] for row in metro_thanas}
    unknown_approximate_ids = sorted(set(METRO_APPROXIMATE_FEATURES) - roster_ids)
    if unknown_approximate_ids:
        raise ValueError(
            f"Approximate metro-thana overrides missing from the BBS registry: "
            f"{unknown_approximate_ids}"
        )
    map_feature_ids = {feature["id"] for feature in map_features}
    missing_approximate_features = sorted(
        {
            feature_id
            for feature_ids in (
                *ADMIN_APPROXIMATE_FEATURES.values(),
                *METRO_APPROXIMATE_FEATURES.values(),
            )
            for feature_id in feature_ids
        }
        - map_feature_ids
    )
    if missing_approximate_features:
        raise ValueError(
            f"Approximate metro-thana features are unavailable: "
            f"{missing_approximate_features}"
        )
    source_geometry_thana_ids = {
        location["id"]
        for location in locations
        if location["kind"] == "thana" and location["geometryAvailable"]
    }
    unregistered_geometry = sorted(source_geometry_thana_ids - roster_ids)
    if unregistered_geometry:
        raise ValueError(f"Geometry thanas missing from the BBS registry: {unregistered_geometry}")
    unknown_exact_ids = sorted(VERIFIED_EXACT_METRO_BOUNDARY_IDS - roster_ids)
    if unknown_exact_ids:
        raise ValueError(f"Verified exact metro IDs missing from the BBS registry: {unknown_exact_ids}")
    exact_ids_without_geometry = sorted(
        VERIFIED_EXACT_METRO_BOUNDARY_IDS - source_geometry_thana_ids
    )
    if exact_ids_without_geometry:
        raise ValueError(
            f"Verified exact metro IDs have no source geometry: {exact_ids_without_geometry}"
        )

    for row in metro_thanas:
        existing_index = location_indexes.get(row["id"])
        existing = locations[existing_index] if existing_index is not None else None
        if existing and existing["kind"] != "thana":
            raise ValueError(
                f"Metro-thana ID collides with a {existing['kind']}: {row['id']}"
            )
        if existing and existing["district"] != row["district"]:
            raise ValueError(f"Metro-thana district changed for stable ID {row['id']}")

        aliases = set(row.get("aliases", []))
        if existing:
            aliases.update(existing.get("aliases", []))
            if existing["upazila"] != row["name"]:
                aliases.add(existing["upazila"])
        aliases.discard(row["name"])
        approximate_feature_ids = METRO_APPROXIMATE_FEATURES.get(row["id"], [])
        has_source_geometry = bool(existing and existing["geometryAvailable"])
        is_verified_exact = row["id"] in VERIFIED_EXACT_METRO_BOUNDARY_IDS
        if has_source_geometry and not is_verified_exact and not approximate_feature_ids:
            approximate_feature_ids = [metro_feature_ids[row["id"]]]
        location = {
            "id": row["id"],
            "slug": row["id"],
            "district": row["district"],
            "districtBn": row["districtBn"],
            "upazila": row["name"],
            "upazilaBn": row["nameBn"],
            "providerHints": provider_hints(
                row["district"], row["name"], "thana", sorted(aliases)
            ),
            "kind": "thana",
            "geometryAvailable": has_source_geometry and is_verified_exact,
        }
        if approximate_feature_ids:
            location["approximateMapFeatureIds"] = approximate_feature_ids
        if aliases:
            location["aliases"] = sorted(aliases)
        if row.get("providerMappings"):
            location["providerMappings"] = row["providerMappings"]

        if existing_index is None:
            location_indexes[row["id"]] = len(locations)
            locations.append(location)
        else:
            locations[existing_index] = location

    for sourced_locality in SOURCED_LOCALITIES:
        locations.append(
            {
                **sourced_locality,
                "approximateMapFeatureIds": [
                    metro_feature_ids.get(feature_id, feature_id)
                    for feature_id in sourced_locality["approximateMapFeatureIds"]
                ],
            }
        )

    slugs = [location["slug"] for location in locations]
    if len(slugs) != len(set(slugs)):
        duplicates = sorted({slug for slug in slugs if slugs.count(slug) > 1})
        raise ValueError(f"Duplicate slugs: {duplicates}")

    locations.sort(key=lambda item: (item["district"], item["upazila"]))
    map_features.sort(key=lambda item: item["id"])
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "locations.json").write_text(
        json.dumps(locations, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (output_dir / "map-paths.json").write_text(
        json.dumps(
            {
                "viewBox": [0, 0, int(VIEWBOX_WIDTH), int(VIEWBOX_HEIGHT)],
                "features": map_features,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
        + "\n",
        encoding="utf-8",
    )
    report = {
        "locationCount": len(locations),
        "geometryCount": len(map_features),
        "upazilaCount": sum(location["kind"] == "upazila" for location in locations),
        "thanaCount": sum(location["kind"] == "thana" for location in locations),
        "localityCount": sum(location["kind"] == "locality" for location in locations),
        "metroThanaRegistry": {
            "asOf": metro_payload["asOf"],
            "instanceCount": metro_payload["expectedInstanceCount"],
            "locationCount": metro_payload["expectedLocationCount"],
            "sourceGeometryCount": len(all_source_geometry_thana_ids),
            "exactGeometryCount": len(VERIFIED_EXACT_METRO_BOUNDARY_IDS),
            "approximateLocationCount": sum(
                location["kind"] == "thana"
                and bool(location.get("approximateMapFeatureIds"))
                for location in locations
            ),
            "districtFallbackCount": sum(
                location["kind"] == "thana"
                and not location["geometryAvailable"]
                and not location.get("approximateMapFeatureIds")
                for location in locations
            ),
        },
        "withoutGeometry": [
            location["slug"]
            for location in locations
            if not location["geometryAvailable"] and not location.get("approximateMapFeatureIds")
        ],
        "approximateGeometry": [
            location["slug"]
            for location in locations
            if not location["geometryAvailable"] and location.get("approximateMapFeatureIds")
        ],
        "unmatchedGeometryClassifiedAsThana": unmatched_geometry,
        "unclaimedReferenceRows": [
            f"{district_by_id[row['district_id']]['name']}: {row['name']}"
            for row in unit_rows
            if row["id"] not in claimed_reference_ids
        ],
    }
    (output_dir / "geo-build-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--adm2", required=True)
    parser.add_argument("--adm3", required=True)
    parser.add_argument("--district-names", required=True)
    parser.add_argument("--upazila-names", required=True)
    parser.add_argument(
        "--metro-thanas",
        default=str(Path(__file__).resolve().parents[2] / "data" / "metropolitan-thanas.json"),
    )
    parser.add_argument(
        "--output-dir",
        default=str(Path(__file__).resolve().parents[2] / "data"),
    )
    return parser.parse_args()


if __name__ == "__main__":
    build(parse_args())
