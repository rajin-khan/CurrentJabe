"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronIcon, LocateIcon, MapPinIcon, PlusIcon, SearchIcon } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { createLocality, getLocalities } from "@/lib/client-api";
import {
  canonicalizeLocalityName,
  localitySimilarity,
  normalizedLocationName,
  parentRelativeNormalizedLocationName,
} from "@/lib/domain/locality";
import { browseParentIdFor } from "@/lib/domain/catalog";
import { matchCoordinatesToLocation } from "@/lib/client-locator";
import { locations, providers, type LocationRecord } from "@/lib/locations";

type LocalityOption =
  | { type: "location"; location: LocationRecord }
  | { type: "add"; displayName: string };

function localizedName(location: LocationRecord, locale: "en" | "bn") {
  return locale === "bn" && location.upazilaBn ? location.upazilaBn : location.upazila;
}

function localizedDistrict(location: LocationRecord, locale: "en" | "bn") {
  return locale === "bn" && location.districtBn ? location.districtBn : location.district;
}

function mergeLocations(...groups: ReadonlyArray<readonly LocationRecord[]>): LocationRecord[] {
  const merged = new Map<string, LocationRecord>();
  for (const group of groups) {
    for (const location of group) {
      if (location.kind === "locality") merged.set(location.id, location);
    }
  }
  return [...merged.values()].sort((left, right) =>
    left.upazila.localeCompare(right.upazila, "en"),
  );
}

function rankLocations(
  candidates: readonly LocationRecord[],
  query: string,
  limit: number,
  parent?: LocationRecord | null,
): LocationRecord[] {
  const normalizeForSearch = (value: string) => parent
    ? parentRelativeNormalizedLocationName(value, parent.upazila, parent.upazilaBn)
    : normalizedLocationName(value);
  const needle = normalizeForSearch(query);
  if (!needle) return candidates.slice(0, limit);

  return candidates
    .map((location) => {
      const values = [location.upazila, location.upazilaBn, ...(location.aliases ?? [])]
        .filter((value): value is string => Boolean(value));
      const rank = Math.min(
        ...values.map((value) => {
          const normalized = normalizeForSearch(value);
          if (normalized === needle) return 0;
          if (normalized.startsWith(needle)) return 1;
          if (normalized.includes(needle)) return 2;
          const similarity = localitySimilarity(needle, normalized);
          return similarity >= 0.44 ? 3 - similarity : Number.POSITIVE_INFINITY;
        }),
      );
      return { location, rank };
    })
    .filter((result) => Number.isFinite(result.rank))
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        left.location.upazila.localeCompare(right.location.upazila, "en"),
    )
    .slice(0, limit)
    .map((result) => result.location);
}

function parentForSelection(location: LocationRecord | null | undefined) {
  if (!location) return null;
  if (location.kind !== "locality") return location;
  const parentId = browseParentIdFor(location);
  if (!parentId) return null;
  return locations.find((candidate) => candidate.id === parentId) ?? null;
}

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
  const parentInputId = useId();
  const parentListboxId = useId();
  const localityInputId = useId();
  const localityListboxId = useId();
  const localityHintId = useId();
  const requestRef = useRef(0);
  const addRequestRef = useRef(0);
  const addInFlightRef = useRef(false);
  const activeParentIdRef = useRef(parentForSelection(selected)?.id ?? null);

  const [parent, setParent] = useState<LocationRecord | null>(() => parentForSelection(selected));
  const [parentQuery, setParentQuery] = useState(() => {
    const initialParent = parentForSelection(selected);
    return initialParent ? localizedName(initialParent, locale) : "";
  });
  const [parentOpen, setParentOpen] = useState(false);
  const [parentActiveIndex, setParentActiveIndex] = useState(0);
  const [localityQuery, setLocalityQuery] = useState(() =>
    selected?.kind === "locality" ? localizedName(selected, locale) : "",
  );
  const [localityOpen, setLocalityOpen] = useState(false);
  const [localityActiveIndex, setLocalityActiveIndex] = useState(0);
  const [localities, setLocalities] = useState<LocationRecord[]>(() =>
    selected?.kind === "locality" ? [selected] : [],
  );
  const [loadingLocalities, setLoadingLocalities] = useState(false);
  const [addingLocality, setAddingLocality] = useState(false);
  const [localityError, setLocalityError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [locating, setLocating] = useState(false);
  const [locatorMessage, setLocatorMessage] = useState<string | null>(null);

  const deferredParentQuery = useDeferredValue(parentQuery);
  const deferredLocalityQuery = useDeferredValue(localityQuery);
  const optionLimit = compact ? 5 : 8;
  const labels = useMemo(() => locale === "bn"
    ? ({
        group: "এলাকা নির্বাচন",
        parent: "থানা বা বড় এলাকা",
        parentPlaceholder: "মিরপুর বা ধানমন্ডি খুঁজুন",
        locality: "নির্দিষ্ট এলাকা (ঐচ্ছিক)",
        localityPlaceholder: "যেমন ধানমন্ডি ৬/এ",
        localityHint: "না থাকলে পাড়া বা রোডের নাম যোগ করুন। বাসা, ফোন নম্বর বা ব্যক্তিগত তথ্য নয়।",
        localArea: "স্থানীয় এলাকা",
        communityAdded: "কমিউনিটির যোগ করা এলাকা",
        thana: "থানা",
        upazila: "উপজেলা",
        loading: "নির্দিষ্ট এলাকাগুলো খোঁজা হচ্ছে…",
        loadingFailed: "নতুন এলাকার তালিকা এখন আনা যাচ্ছে না। আবার চেষ্টা করুন।",
        noneYet: "এখনও কোনো নির্দিষ্ট এলাকা যোগ হয়নি। নাম লিখে প্রথমটি যোগ করুন।",
        add: (name: string) => `“${name}” যোগ করুন`,
        adding: (name: string) => `“${name}” যোগ হচ্ছে…`,
        under: (name: string) => `${name}-এর অধীনে`,
        ready: (name: string) => `${name}-এর নির্দিষ্ট এলাকা এখন বেছে নিতে পারেন।`,
        chooseSpecific: (name: string) => `${name} নির্বাচিত। চাইলে আরও নির্দিষ্ট এলাকা বেছে নিন।`,
        added: (name: string, created: boolean) =>
          created ? `${name} যোগ করে নির্বাচন করা হয়েছে।` : `${name} আগে থেকেই ছিল এবং এখন নির্বাচন করা হয়েছে।`,
      })
    : ({
        group: "Location selection",
        parent: "Thana or broad area",
        parentPlaceholder: "Search Mirpur or Dhanmondi",
        locality: "Specific area (optional)",
        localityPlaceholder: "e.g. Dhanmondi 6/A",
        localityHint: "Choose one or add a neighborhood or road. Never add a house, phone number or personal detail.",
        localArea: "Local area",
        communityAdded: "Community-added area",
        thana: "Thana",
        upazila: "Upazila",
        loading: "Finding specific areas…",
        loadingFailed: "Newer areas could not be loaded. Please try again.",
        noneYet: "No specific areas yet. Type a name to add the first one.",
        add: (name: string) => `Add “${name}”`,
        adding: (name: string) => `Adding “${name}”…`,
        under: (name: string) => `Under ${name}`,
        ready: (name: string) => `Specific areas for ${name} are ready.`,
        chooseSpecific: (name: string) => `${name} is selected. You can optionally choose a more specific area.`,
        added: (name: string, created: boolean) =>
          created ? `${name} was added and selected.` : `${name} already existed and is now selected.`,
      }), [locale]);

  const broadLocations = useMemo(
    () => locations.filter((location) => location.kind !== "locality"),
    [],
  );
  const parentResults = useMemo(
    () => rankLocations(broadLocations, deferredParentQuery, optionLimit),
    [broadLocations, deferredParentQuery, optionLimit],
  );
  const localityResults = useMemo(
    () => rankLocations(localities, deferredLocalityQuery, optionLimit, parent),
    [deferredLocalityQuery, localities, optionLimit, parent],
  );
  const canonicalDraft = useMemo(() => {
    if (!deferredLocalityQuery.trim()) return null;
    try {
      return canonicalizeLocalityName(deferredLocalityQuery);
    } catch {
      return null;
    }
  }, [deferredLocalityQuery]);
  const exactLocality = useMemo(() => {
    if (!canonicalDraft || !parent) return null;
    const normalizedDraft = parentRelativeNormalizedLocationName(
      canonicalDraft.displayName,
      parent.upazila,
      parent.upazilaBn,
    );
    return localities.find(
      (location) =>
        parentRelativeNormalizedLocationName(
          location.upazila,
          parent.upazila,
          parent.upazilaBn,
        ) === normalizedDraft ||
        (location.upazilaBn && parentRelativeNormalizedLocationName(
          location.upazilaBn,
          parent.upazila,
          parent.upazilaBn,
        ) === normalizedDraft) ||
        (location.aliases ?? []).some((alias) =>
          parentRelativeNormalizedLocationName(
            alias,
            parent.upazila,
            parent.upazilaBn,
          ) === normalizedDraft),
    ) ?? null;
  }, [canonicalDraft, localities, parent]);
  const localityOptions = useMemo<LocalityOption[]>(() => {
    const options: LocalityOption[] = localityResults.map((location) => ({
      type: "location",
      location,
    }));
    if (
      parent && canonicalDraft && !exactLocality &&
      canonicalDraft.normalizedName !== normalizedLocationName(parent.upazila) &&
      (!parent.upazilaBn || canonicalDraft.normalizedName !== normalizedLocationName(parent.upazilaBn))
    ) {
      options.push({ type: "add", displayName: canonicalDraft.displayName });
    }
    return options;
  }, [canonicalDraft, exactLocality, localityResults, parent]);

  useEffect(() => setParentActiveIndex(0), [deferredParentQuery]);
  useEffect(() => setLocalityActiveIndex(0), [deferredLocalityQuery, localities]);

  useEffect(() => {
    const nextParent = parentForSelection(selected);
    if (activeParentIdRef.current !== (nextParent?.id ?? null)) {
      addRequestRef.current += 1;
      addInFlightRef.current = false;
      setAddingLocality(false);
    }
    activeParentIdRef.current = nextParent?.id ?? null;
    setParent(nextParent);
    setParentQuery(nextParent ? localizedName(nextParent, locale) : "");
    if (selected?.kind === "locality") {
      setLocalityQuery(localizedName(selected, locale));
      setLocalities((current) => mergeLocations(current, [selected]));
    } else {
      setLocalityQuery("");
    }
  }, [locale, selected]);

  useEffect(() => {
    if (!parent) {
      requestRef.current += 1;
      setLocalities([]);
      setLoadingLocalities(false);
      return;
    }
    const requestId = ++requestRef.current;
    const knownChildren = locations.filter(
      (location) => location.kind === "locality" && browseParentIdFor(location) === parent.id,
    );
    setLocalities((current) => mergeLocations(
      knownChildren,
      current.filter((location) => location.parentId === parent.id),
    ));
    setLoadingLocalities(true);
    setLocalityError(null);

    void getLocalities(parent.id)
      .then((results) => {
        if (requestId !== requestRef.current) return;
        setLocalities((current) => mergeLocations(knownChildren, current, results));
        setAnnouncement(labels.ready(localizedName(parent, locale)));
      })
      .catch(() => {
        if (requestId !== requestRef.current) return;
        setLocalityError(labels.loadingFailed);
      })
      .finally(() => {
        if (requestId === requestRef.current) setLoadingLocalities(false);
      });

    return () => {
      requestRef.current += 1;
    };
  }, [labels, locale, parent]);

  const chooseParent = useCallback((location: LocationRecord) => {
    addRequestRef.current += 1;
    addInFlightRef.current = false;
    activeParentIdRef.current = location.id;
    setParent(location);
    setParentQuery(localizedName(location, locale));
    setParentOpen(false);
    setParentActiveIndex(0);
    setLocalityQuery("");
    setLocalityOpen(false);
    setLocalityActiveIndex(0);
    setLocalities([]);
    setLocalityError(null);
    setAddingLocality(false);
    setAnnouncement(labels.chooseSpecific(localizedName(location, locale)));
    onSelect(location);
  }, [labels, locale, onSelect]);

  const chooseLocality = useCallback((location: LocationRecord) => {
    addRequestRef.current += 1;
    addInFlightRef.current = false;
    setAddingLocality(false);
    setLocalityQuery(localizedName(location, locale));
    setLocalityOpen(false);
    setLocalityActiveIndex(0);
    setLocalityError(null);
    onSelect(location);
  }, [locale, onSelect]);

  const addLocality = useCallback(async (displayName: string) => {
    if (!parent || addInFlightRef.current) return;
    const parentAtStart = parent;
    const requestId = ++addRequestRef.current;
    addInFlightRef.current = true;
    setAddingLocality(true);
    setLocalityError(null);
    try {
      const result = await createLocality(parentAtStart.id, displayName, locale);
      if (
        requestId !== addRequestRef.current ||
        activeParentIdRef.current !== parentAtStart.id
      ) return;
      setLocalities((current) => mergeLocations(current, [result.location]));
      setLocalityQuery(localizedName(result.location, locale));
      setLocalityOpen(false);
      setLocalityActiveIndex(0);
      setAnnouncement(labels.added(localizedName(result.location, locale), result.created));
      onSelect(result.location);
    } catch (error) {
      if (requestId !== addRequestRef.current) return;
      setLocalityError(error instanceof Error && error.message ? error.message : text.report.error);
    } finally {
      if (requestId === addRequestRef.current) {
        addInFlightRef.current = false;
        setAddingLocality(false);
      }
    }
  }, [labels, locale, onSelect, parent, text.report.error]);

  const parentOptionId = (location: LocationRecord) =>
    `${parentListboxId}-option-${location.id}`;
  const localityOptionId = (option: LocalityOption) => option.type === "location"
    ? `${localityListboxId}-option-${option.location.id}`
    : `${localityListboxId}-option-add`;

  const locateUser = useCallback(() => {
    if (!navigator.geolocation) {
      setLocatorMessage(locale === "bn"
        ? "এই ব্রাউজারে লোকেশন পাওয়া যায় না। এলাকা লিখে খুঁজুন।"
        : "Location is unavailable in this browser. Search manually.");
      return;
    }
    setLocating(true);
    setLocatorMessage(null);
    navigator.geolocation.getCurrentPosition((position) => {
      const result = matchCoordinatesToLocation(
        position.coords.longitude,
        position.coords.latitude,
      );
      setLocating(false);
      if (result.status === "matched") {
        onSelect(result.location);
        setLocatorMessage(locale === "bn"
          ? `${result.location.upazilaBn || result.location.upazila} পাওয়া গেছে। সঠিক না হলে অন্য এলাকা লিখুন।`
          : `Located ${result.location.upazila}. If that is not right, search another area.`);
      } else if (result.status === "outside") {
        setLocatorMessage(locale === "bn"
          ? "লোকেশনটি বাংলাদেশের বাইরে মনে হচ্ছে। এলাকা লিখে খুঁজুন।"
          : "This location appears to be outside Bangladesh. Search manually.");
      } else {
        setLocatorMessage(locale === "bn"
          ? "সঠিক থানা নিশ্চিত করা যায়নি। এলাকা লিখে খুঁজুন।"
          : "We could not safely choose the exact thana. Search manually.");
      }
    }, (error) => {
      setLocating(false);
      setLocatorMessage(error.code === error.PERMISSION_DENIED
        ? locale === "bn" ? "লোকেশন অনুমতি বন্ধ আছে। ব্রাউজারের সাইট সেটিংস থেকে অনুমতি দিন, অথবা এলাকা লিখুন।" : "Location permission is blocked. Allow it in your browser's site settings, or search manually."
        : locale === "bn" ? "এখন লোকেশন পাওয়া যাচ্ছে না। এলাকা লিখে খুঁজুন।" : "Your location could not be read. Search manually.");
    }, { enableHighAccuracy: false, timeout: 9000, maximumAge: 300000 });
  }, [locale, onSelect]);

  return (
    <div
      aria-label={labels.group}
      className={`location-search location-search--two-level${compact ? " location-search--compact" : ""}`}
      role="group"
    >
      <div className="location-search__field location-search__field--parent">
        <label className="location-search__label" htmlFor={parentInputId}>{labels.parent}</label>
        <div className="location-search__parent-row">
          <div className={`location-search__control${parentOpen ? " is-open" : ""}`}>
            <SearchIcon />
            <input
            id={parentInputId}
            aria-activedescendant={
              parentOpen && parentResults[parentActiveIndex]
                ? parentOptionId(parentResults[parentActiveIndex])
                : undefined
            }
            aria-autocomplete="list"
            aria-controls={parentListboxId}
            aria-expanded={parentOpen}
            aria-haspopup="listbox"
            autoComplete="off"
            placeholder={labels.parentPlaceholder}
            role="combobox"
            value={parentQuery}
            onBlur={() => window.setTimeout(() => setParentOpen(false), 120)}
            onChange={(event) => {
              setParentQuery(event.target.value);
              setParentActiveIndex(0);
              setParentOpen(true);
            }}
            onFocus={() => {
              setParentActiveIndex(0);
              setParentOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setParentOpen(true);
                setParentActiveIndex((current) =>
                  Math.min(current + 1, Math.max(0, parentResults.length - 1)));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setParentOpen(true);
                setParentActiveIndex((current) => Math.max(current - 1, 0));
              } else if (event.key === "Home" && parentOpen) {
                event.preventDefault();
                setParentActiveIndex(0);
              } else if (event.key === "End" && parentOpen) {
                event.preventDefault();
                setParentActiveIndex(Math.max(0, parentResults.length - 1));
              } else if (event.key === "Enter" && parentOpen && parentResults[parentActiveIndex]) {
                event.preventDefault();
                chooseParent(parentResults[parentActiveIndex]);
              } else if (event.key === "Escape") {
                setParentOpen(false);
              }
            }}
            />
            <ChevronIcon />
          </div>
          <button
            className="location-search__locate"
            disabled={locating}
            type="button"
            onClick={locateUser}
          >
            <LocateIcon />
            <span>{locating
              ? locale === "bn" ? "খোঁজা হচ্ছে" : "Locating"
              : locale === "bn" ? "আমার এলাকা" : "Locate me"}</span>
          </button>
        </div>
        {locatorMessage ? <p className="location-search__locator-message" role="status">{locatorMessage}</p> : null}

        {parentOpen ? (
          <div className="location-results location-results--parent" id={parentListboxId} role="listbox">
            {parentResults.length > 0 ? parentResults.map((location, index) => {
              const providerNames = location.providerHints
                .map((providerId) => providers.find((provider) => provider.id === providerId)?.shortName)
                .filter(Boolean)
                .join(" · ");
              const kindLabel = location.kind === "thana" ? labels.thana : labels.upazila;
              return (
                <button
                  aria-selected={parent?.id === location.id}
                  className={[
                    parent?.id === location.id ? "is-selected" : "",
                    parentActiveIndex === index ? "is-active" : "",
                  ].filter(Boolean).join(" ")}
                  id={parentOptionId(location)}
                  key={location.id}
                  role="option"
                  type="button"
                  onClick={() => chooseParent(location)}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setParentActiveIndex(index)}
                >
                  <MapPinIcon />
                  <span>
                    <strong>{localizedName(location, locale)}</strong>
                    <small>
                      {localizedDistrict(location, locale)} · {kindLabel}
                      {providerNames ? ` · ${providerNames}` : ""}
                    </small>
                  </span>
                </button>
              );
            }) : <p>{text.common.noResults}</p>}
          </div>
        ) : null}
      </div>

      {parent ? (
        <div className="location-search__field location-search__field--locality">
          <label className="location-search__label" htmlFor={localityInputId}>{labels.locality}</label>
          <div
            aria-busy={loadingLocalities || addingLocality}
            className={`location-search__control${localityOpen ? " is-open" : ""}${loadingLocalities ? " is-loading" : ""}`}
          >
            <MapPinIcon />
            <input
              id={localityInputId}
              aria-activedescendant={
                localityOpen && localityOptions[localityActiveIndex]
                  ? localityOptionId(localityOptions[localityActiveIndex])
                  : undefined
              }
              aria-autocomplete="list"
              aria-controls={localityListboxId}
              aria-describedby={localityHintId}
              aria-expanded={localityOpen}
              aria-haspopup="listbox"
              autoComplete="off"
              disabled={addingLocality}
              placeholder={labels.localityPlaceholder}
              role="combobox"
              value={localityQuery}
              onBlur={() => window.setTimeout(() => setLocalityOpen(false), 120)}
              onChange={(event) => {
                setLocalityQuery(event.target.value);
                setLocalityActiveIndex(0);
                setLocalityError(null);
                setLocalityOpen(true);
              }}
              onFocus={() => {
                setLocalityActiveIndex(0);
                setLocalityOpen(true);
                const parentAtFocus = parent;
                void getLocalities(parentAtFocus.id)
                  .then((results) => {
                    if (activeParentIdRef.current !== parentAtFocus.id) return;
                    setLocalities((current) => mergeLocations(current, results));
                  })
                  .catch(() => {
                    // Keep the already-loaded choices usable while offline.
                  });
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setLocalityOpen(true);
                  setLocalityActiveIndex((current) =>
                    Math.min(current + 1, Math.max(0, localityOptions.length - 1)));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setLocalityOpen(true);
                  setLocalityActiveIndex((current) => Math.max(current - 1, 0));
                } else if (event.key === "Home" && localityOpen) {
                  event.preventDefault();
                  setLocalityActiveIndex(0);
                } else if (event.key === "End" && localityOpen) {
                  event.preventDefault();
                  setLocalityActiveIndex(Math.max(0, localityOptions.length - 1));
                } else if (event.key === "Enter" && localityOpen && localityOptions[localityActiveIndex]) {
                  event.preventDefault();
                  const option = localityOptions[localityActiveIndex];
                  if (option.type === "location") chooseLocality(option.location);
                  else void addLocality(option.displayName);
                } else if (event.key === "Escape") {
                  setLocalityOpen(false);
                }
              }}
            />
            <ChevronIcon />
          </div>
          <p className="location-search__field-hint" id={localityHintId}>{labels.localityHint}</p>

          {localityOpen ? (
            <div
              aria-busy={loadingLocalities || addingLocality}
              className="location-results location-results--locality"
              id={localityListboxId}
              role="listbox"
            >
              {loadingLocalities && localities.length === 0 ? (
                <div className="location-results__loading" role="status">
                  <span aria-hidden="true" />
                  <span>{labels.loading}</span>
                </div>
              ) : localityOptions.length > 0 ? localityOptions.map((option, index) => {
                if (option.type === "add") {
                  return (
                    <button
                      aria-disabled={addingLocality}
                      aria-selected={false}
                      className={`location-results__add${localityActiveIndex === index ? " is-active" : ""}`}
                      id={localityOptionId(option)}
                      key="add-locality"
                      role="option"
                      type="button"
                      onClick={() => void addLocality(option.displayName)}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setLocalityActiveIndex(index)}
                    >
                      <PlusIcon />
                      <span>
                        <strong>
                          {addingLocality
                            ? labels.adding(option.displayName)
                            : labels.add(option.displayName)}
                        </strong>
                        <small>{labels.under(localizedName(parent, locale))}</small>
                      </span>
                    </button>
                  );
                }
                const location = option.location;
                return (
                  <button
                    aria-selected={selected?.id === location.id}
                    className={[
                      selected?.id === location.id ? "is-selected" : "",
                      localityActiveIndex === index ? "is-active" : "",
                    ].filter(Boolean).join(" ")}
                    id={localityOptionId(option)}
                    key={location.id}
                    role="option"
                    type="button"
                    onClick={() => chooseLocality(location)}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setLocalityActiveIndex(index)}
                  >
                    <MapPinIcon />
                    <span>
                      <strong>{localizedName(location, locale)}</strong>
                      <small>
                        {location.communityAdded ? labels.communityAdded : labels.localArea}
                        {` · ${localizedDistrict(location, locale)}`}
                      </small>
                    </span>
                  </button>
                );
              }) : (
                <p>{deferredLocalityQuery.trim() ? text.common.noResults : labels.noneYet}</p>
              )}
            </div>
          ) : null}
          {localityError ? <p className="location-search__error" role="alert">{localityError}</p> : null}
        </div>
      ) : null}

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {compact ? null : <p className="location-search__hint">{text.hero.searchHint}</p>}
    </div>
  );
}
