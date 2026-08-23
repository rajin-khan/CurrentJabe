"use client";

import { useState } from "react";
import { LazyBangladeshMap } from "@/components/lazy-bangladesh-map";
import { LocationSearch } from "@/components/location-search";
import { ReportDialog, type ReportMode } from "@/components/report-dialog";
import { useLanguage } from "@/components/language-provider";
import type { LocationRecord } from "@/lib/locations";

export function SubmitExperience() {
  const { text } = useLanguage();
  const [selected, setSelected] = useState<LocationRecord | null>(null);
  const [mode, setMode] = useState<ReportMode | null>(null);

  return (
    <section className="submit-page">
      <div className="submit-page__copy">
        <p className="eyebrow">{text.submit.eyebrow}</p>
        <h1>{text.submit.title}</h1>
        <p>{text.submit.body}</p>
        <LocationSearch compact selected={selected} onSelect={setSelected} />
        {selected ? (
          <div className="submit-mode-picker">
            <button type="button" onClick={() => setMode("out")}>
              <small>{text.submit.now}</small>
              <strong>{text.actions.out}</strong>
            </button>
            <button type="button" onClick={() => setMode("on")}>
              <small>{text.submit.now}</small>
              <strong>{text.actions.on}</strong>
            </button>
            <button type="button" onClick={() => setMode("daily")}>
              <small>{text.submit.todayOrYesterday}</small>
              <strong>{text.submit.history}</strong>
            </button>
          </div>
        ) : null}
      </div>
      <div className="submit-page__map">
        <LazyBangladeshMap compact selected={selected} onSelect={setSelected} />
      </div>
      {selected && mode ? (
        <ReportDialog
          area={{
            id: selected.id,
            slug: selected.slug,
            name: selected.upazila,
            nameBn: selected.upazilaBn,
            districtName: selected.district,
            districtNameBn: selected.districtBn,
          }}
          mode={mode}
          onClose={() => setMode(null)}
        />
      ) : null}
    </section>
  );
}
