"use client";

import { useEffect, useState } from "react";
import { CheckIcon, ShareIcon } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { ReportDialog, type ReportArea, type ReportMode } from "@/components/report-dialog";
import { recordAnalytics, type AreaSnapshot } from "@/lib/client-api";

function formatHour(hour: number, locale: "en" | "bn") {
  const normalized = ((hour % 24) + 24) % 24;
  const date = new Date(Date.UTC(2026, 0, 1, normalized, 0));
  return new Intl.DateTimeFormat(locale === "bn" ? "bn-BD" : "en-US", {
    hour: "numeric",
    minute: normalized % 1 === 0 ? undefined : "2-digit",
    hour12: true,
    timeZone: "UTC",
  }).format(date);
}

function interpolate(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replace(`{${key}}`, String(value)),
    template,
  );
}

export function AreaSignal({
  area,
  snapshot,
  loading = false,
  unavailable = false,
  onRefresh,
}: {
  area: ReportArea;
  snapshot: AreaSnapshot;
  loading?: boolean;
  unavailable?: boolean;
  onRefresh?: () => void;
}) {
  const { locale, text } = useLanguage();
  const [reportMode, setReportMode] = useState<ReportMode | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(0);
  const expired = Boolean(
    now > 0 &&
      snapshot.liveState.expiresAt &&
      Date.parse(snapshot.liveState.expiresAt) <= now,
  );
  const state = expired ? "unknown" : snapshot.liveState.state;
  const areaName = locale === "bn" && area.nameBn ? area.nameBn : area.name;
  const districtName =
    locale === "bn" && area.districtNameBn ? area.districtNameBn : area.districtName;

  const statusLabel =
    state === "appears_out"
      ? text.status.out
      : state === "appears_on"
        ? text.status.on
        : text.status.unknown;
  const statusDetail =
    state === "appears_out"
      ? text.status.outDetail
      : state === "appears_on"
        ? text.status.onDetail
        : text.status.unknownDetail;

  useEffect(() => {
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(interval);
  }, []);

  const shareArea = async () => {
    const url = `${window.location.origin}/area/${area.slug}`;
    const shareData = {
      title: `${areaName} · CurrentJabe`,
      text:
        state === "appears_out"
          ? `${areaName}: people are reporting an electricity outage.`
          : snapshot.forecast.eligible
            ? `${areaName} now has a community outage forecast.`
            : `Help ${areaName} unlock its community outage forecast.`,
      url,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }
      await recordAnalytics("share", area.id);
    } catch {
      // Native share cancellation is not an error worth surfacing.
    }
  };

  return (
    <div className={`area-signal area-signal--${state}${loading ? " is-loading" : ""}`}>
      {unavailable ? (
        <p className="service-notice" role="status">{text.common.unavailable}</p>
      ) : null}
      <section className="live-signal" aria-live="polite">
        <div className="live-signal__header">
          <div>
            <p className="eyebrow">{text.hero.mapLabel}</p>
            <h2>{areaName}</h2>
            {districtName ? <span>{districtName}</span> : null}
          </div>
          <button className="share-button" type="button" onClick={shareArea}>
            <ShareIcon />
            {copied ? text.actions.copied : text.actions.share}
          </button>
        </div>

        <div className="live-signal__state">
          <span className="status-mark" aria-hidden="true" />
          <div>
            <strong>{statusLabel}</strong>
            <p>{statusDetail}</p>
          </div>
        </div>

        <p className="live-signal__meta">
          <b>{expired ? 0 : snapshot.liveState.contributorCount}</b>{" "}
          {text.status.evidence} · {text.status.freshness}
        </p>

        <div className="signal-actions">
          <button className="signal-action signal-action--out" type="button" onClick={() => setReportMode("out")}>
            <small>{locale === "bn" ? "এখন জানান" : "Report now"}</small>
            <strong>{text.actions.out}</strong>
          </button>
          <button className="signal-action signal-action--on" type="button" onClick={() => setReportMode("on")}>
            <small>{locale === "bn" ? "এখন নিশ্চিত করুন" : "Confirm now"}</small>
            <strong>{text.actions.on}</strong>
          </button>
        </div>
        <button className="history-action" type="button" onClick={() => setReportMode("daily")}>
          {text.actions.history}
        </button>
        <p className="signal-disclaimer">{text.status.disclaimer}</p>
      </section>

      <ForecastCard snapshot={snapshot} onReport={() => setReportMode("daily")} />

      {reportMode ? (
        <ReportDialog
          area={area}
          mode={reportMode}
          onClose={() => setReportMode(null)}
          onSubmitted={onRefresh}
        />
      ) : null}
    </div>
  );
}

function ForecastCard({
  snapshot,
  onReport,
}: {
  snapshot: AreaSnapshot;
  onReport: () => void;
}) {
  const { locale, text } = useLanguage();
  const evidence = snapshot.forecast.evidence;
  const requirements = [
    { label: text.forecast.people, value: evidence.independentContributors, target: 10 },
    { label: text.forecast.events, value: evidence.timedEvents, target: 10 },
    { label: text.forecast.days, value: evidence.distinctDays, target: 3 },
  ];

  return (
    <section className="forecast-card">
      <div className="forecast-card__header">
        <div>
          <p className="eyebrow">{text.forecast.eyebrow}</p>
          <h2>{text.forecast.title}</h2>
        </div>
        <span className={`forecast-state${snapshot.forecast.eligible ? " is-unlocked" : ""}`}>
          {snapshot.forecast.eligible ? text.forecast.live : text.forecast.lockedLabel}
        </span>
      </div>

      {snapshot.forecast.eligible && snapshot.forecast.windows.length > 0 ? (
        <div className="forecast-windows">
          <p>{text.forecast.likely}</p>
          {snapshot.forecast.windows.slice(0, 3).map((window, index) => (
            <div className="forecast-window" key={`${window.startsAt}-${index}`}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>
                {formatHour(window.localStartHour, locale)}
                <i>—</i>
                {formatHour(window.localStartHour + 1, locale)}
              </strong>
              <small>{Math.round(window.score * 100)} {text.forecast.score}</small>
            </div>
          ))}
          <p className="forecast-evidence-line">
            {interpolate(text.forecast.basedOn, {
              reports: evidence.timedEvents,
              days: evidence.distinctDays,
            })}
          </p>
          {evidence.distinctDays >= 7 ? (
            <p className="forecast-verified">
              <CheckIcon />
              {interpolate(text.forecast.verified, {
                days:
                  locale === "bn"
                    ? evidence.distinctDays.toLocaleString("bn-BD")
                    : evidence.distinctDays,
              })}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="forecast-locked">
          <h3>{text.forecast.locked}</h3>
          <p>{text.forecast.lockedBody}</p>
          <ul className="evidence-summary">
            {requirements.map((requirement) => (
              <li key={requirement.label}>
                <strong>{requirement.value}/{requirement.target}</strong>
                <span>{requirement.label}</span>
              </li>
            ))}
            <li>
              <strong>{evidence.hasRecentEvidence ? text.forecast.live : "—"}</strong>
              <span>{text.forecast.recent}</span>
            </li>
          </ul>
          <button className="button-dark" type="button" onClick={onReport}>
            {text.forecast.unlock}
          </button>
        </div>
      )}
      <p className="forecast-disclaimer">{text.forecast.disclaimer}</p>
    </section>
  );
}
