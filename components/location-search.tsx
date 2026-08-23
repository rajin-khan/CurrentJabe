"use client";

import { useDeferredValue, useEffect, useId, useMemo, useState } from "react";
import { ChevronIcon, MapPinIcon, SearchIcon } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import {
  locations,
  providers,
  searchLocations,
  type LocationRecord,
} from "@/lib/locations";

export function LocationSearch({
  selected,
  onSelect,
  compact = false,
}: {
  selected?: LocationRecord | null;
  onSelect: (location: LocationRecord) => void;
  compact?: boolean;
}) {
  const { locale, text } = useLanguage();
  const inputId = useId();
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const deferredQuery = useDeferredValue(query);

  const results = useMemo(() => {
    if (!deferredQuery.trim()) {
      return [
        ...locations.filter((location) => location.kind === "locality"),
        ...locations.filter((location) => location.kind !== "locality"),
      ].slice(0, compact ? 5 : 8);
    }
    return searchLocations(deferredQuery).slice(0, compact ? 5 : 8);
  }, [compact, deferredQuery]);

  useEffect(() => {
    setActiveIndex(0);
  }, [deferredQuery]);

  const displayName = (location: LocationRecord) =>
    locale === "bn" && location.upazilaBn ? location.upazilaBn : location.upazila;
  const displayDistrict = (location: LocationRecord) =>
    locale === "bn" && location.districtBn ? location.districtBn : location.district;

  const choose = (location: LocationRecord) => {
    setQuery(displayName(location));
    setOpen(false);
    onSelect(location);
  };

  return (
    <div className={`location-search${compact ? " location-search--compact" : ""}`}>
      <label htmlFor={inputId}>{text.hero.searchLabel}</label>
      <div className={`location-search__control${open ? " is-open" : ""}`}>
        <SearchIcon />
        <input
          id={inputId}
          autoComplete="off"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-activedescendant={
            open && results[activeIndex]
              ? `${listboxId}-option-${results[activeIndex].id}`
              : undefined
          }
          aria-expanded={open}
          placeholder={text.hero.searchPlaceholder}
          role="combobox"
          value={query}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onFocus={() => {
            setActiveIndex(0);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((current) => Math.min(current + 1, Math.max(0, results.length - 1)));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((current) => Math.max(current - 1, 0));
            }
            if (event.key === "Enter" && results[activeIndex]) {
              event.preventDefault();
              choose(results[activeIndex]);
            }
            if (event.key === "Escape") setOpen(false);
          }}
        />
        <ChevronIcon />
      </div>

      {open ? (
        <div className="location-results" id={listboxId} role="listbox">
          {results.length > 0 ? (
            results.map((location, index) => {
              const providerNames = location.providerHints
                .map((providerId) => providers.find((provider) => provider.id === providerId)?.shortName)
                .filter(Boolean)
                .join(" · ");
              const kindLabel =
                location.kind === "locality"
                  ? locale === "bn" ? "স্থানীয় এলাকা" : "Local area"
                  : location.kind === "thana"
                    ? locale === "bn" ? "থানা" : "Thana"
                    : locale === "bn" ? "উপজেলা" : "Upazila";
              return (
                <button
                  aria-selected={activeIndex === index}
                  className={[
                    selected?.id === location.id ? "is-selected" : "",
                    activeIndex === index ? "is-active" : "",
                  ].filter(Boolean).join(" ")}
                  id={`${listboxId}-option-${location.id}`}
                  key={location.id}
                  role="option"
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(location)}
                >
                  <MapPinIcon />
                  <span>
                    <strong>{displayName(location)}</strong>
                    <small>
                      {displayDistrict(location)} · {kindLabel}
                      {providerNames ? ` · ${providerNames}` : ""}
                    </small>
                  </span>
                </button>
              );
            })
          ) : (
            <p>{text.common.noResults}</p>
          )}
        </div>
      ) : null}
      {compact ? null : <p className="location-search__hint">{text.hero.searchHint}</p>}
    </div>
  );
}
