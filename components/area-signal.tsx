"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon, ShareIcon } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import {
  ReportDialog,
  type ReportArea,
  type ReportMode,
  type ReportSubmissionReceipt,
} from "@/components/report-dialog";
import {
  getMyReports,
  recordAnalytics,
  type AreaSnapshot,
  type LiveState,
  type MyReports,
} from "@/lib/client-api";
import { getDhakaDate } from "@/lib/dhaka-date";

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

function optimisticLiveState(current: LiveState, mode: "out" | "on"): LiveState {
  const onContributorCount = current.onContributorCount + (mode === "on" ? 1 : 0);
  const outContributorCount = current.outContributorCount + (mode === "out" ? 1 : 0);
  const leadingState = onContributorCount === outContributorCount
    ? mode
    : onContributorCount > outContributorCount
      ? "on"
      : "out";
  return {
    ...current,
    recentContributorCount: Math.max(onContributorCount, outContributorCount),
    onContributorCount,
    outContributorCount,
    leadingState,
    observedAt: new Date().toISOString(),
  };
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
  onRefresh?: () => void | Promise<void>;
}) {
  const { locale, text } = useLanguage();
  const [reportMode, setReportMode] = useState<ReportMode | null>(null);
  const [displayedLiveState, setDisplayedLiveState] = useState(snapshot.liveState);
  const [reportPhase, setReportPhase] = useState<"submitting" | "refreshing" | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(0);
  const [myReports, setMyReports] = useState<MyReports | null>(null);
  const myReportsRequestRef = useRef(0);
  const closeReportDialog = useCallback(() => setReportMode(null), []);
  const expired = Boolean(
    now > 0 &&
      displayedLiveState.expiresAt &&
      Date.parse(displayedLiveState.expiresAt) <= now,
  );
  const state = expired ? "unknown" : displayedLiveState.state;
  const recentContributorCount = displayedLiveState.recentContributorCount;
  const areaName = locale === "bn" && area.nameBn ? area.nameBn : area.name;
  const districtName =
    locale === "bn" && area.districtNameBn ? area.districtNameBn : area.districtName;
  const openOutage = myReports?.events.find((event) => event.isOpen) ?? null;
  const reportedOutageCount = Math.max(
    myReports?.events.length ?? 0,
    myReports?.dailySubmission?.outageCount ?? 0,
  );

  const statusLabel =
    state === "appears_out"
      ? text.status.out
      : state === "appears_on"
        ? text.status.on
        : recentContributorCount > 0
          ? text.status.gathering
          : text.status.unknown;
  const statusDetail =
    state === "appears_out"
      ? text.status.outDetail
      : state === "appears_on"
        ? text.status.onDetail
        : recentContributorCount > 0 && displayedLiveState.leadingState
          ? interpolate(
              displayedLiveState.leadingState === "out"
                ? text.status.gatheringOutDetail
                : text.status.gatheringOnDetail,
              {
                count:
                  locale === "bn"
                    ? recentContributorCount.toLocaleString("bn-BD")
                    : recentContributorCount,
              },
            )
          : text.status.unknownDetail;

  useEffect(() => {
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (reportPhase === null) setDisplayedLiveState(snapshot.liveState);
  }, [reportPhase, snapshot.liveState]);

  const refreshMyReports = useCallback(async () => {
    const requestId = ++myReportsRequestRef.current;
    try {
      const response = await getMyReports(area.id, getDhakaDate());
      if (requestId === myReportsRequestRef.current) setMyReports(response);
    } catch {
      // Personal context is a convenience; public reporting stays available.
    }
  }, [area.id]);

  useEffect(() => {
    setMyReports(null);
    void refreshMyReports();
  }, [refreshMyReports]);

  const handleSubmitting = (mode: ReportMode) => {
    setReportPhase("submitting");
    if (mode === "out" || mode === "on") {
      setDisplayedLiveState((current) => optimisticLiveState(current, mode));
    }
  };

  const handleSubmissionError = () => {
    setDisplayedLiveState(snapshot.liveState);
    setReportPhase(null);
  };

  const handleSubmitted = async (receipt: ReportSubmissionReceipt) => {
    if (receipt.mode === "out" || receipt.mode === "on") {
      setDisplayedLiveState(receipt.liveState);
    }
    setReportPhase("refreshing");
    try {
      await Promise.all([
        Promise.resolve(onRefresh?.()),
        refreshMyReports(),
      ]);
    } finally {
      setReportPhase(null);
    }
  };

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

  if (loading) {
    return (
      <div className="area-signal area-signal--loading" aria-busy="true">
        <p className="sr-only" role="status">{text.common.loading}</p>
        <section className="signal-loading-card" aria-hidden="true">
          <div>
            <span>{text.common.loading}</span>
            <strong>{areaName}</strong>
          </div>
          <i />
        </section>
        <section className="signal-loading-card signal-loading-card--forecast" aria-hidden="true">
          <div>
            <span>{text.forecast.eyebrow}</span>
            <strong>{text.forecast.title}</strong>
          </div>
          <i />
        </section>
      </div>
    );
  }

  return (
    <div
      aria-busy={loading || reportPhase !== null}
      className={`area-signal area-signal--${state}${state === "unknown" && recentContributorCount > 0 ? ` area-signal--gathering area-signal--pending-${displayedLiveState.leadingState ?? "unknown"}` : ""}${loading ? " is-loading" : ""}`}
    >
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

        <div className="live-signal__meta-row">
          <p className="live-signal__meta">
            <b>{locale === "bn" ? `${recentContributorCount.toLocaleString("bn-BD")}/১০` : `${recentContributorCount}/10`}</b>{" "}
            {text.status.evidence} · {text.status.freshness}
          </p>
          {reportPhase ? (
            <p className="live-signal__update" role="status" aria-live="polite" aria-atomic="true">
              {reportPhase === "submitting" ? text.status.submitting : text.status.refreshing}
            </p>
          ) : null}
        </div>

        {reportedOutageCount > 0 ? (
          <p className="personal-report-note" role="status">
            {openOutage
              ? locale === "bn"
                ? "এই ব্রাউজার থেকে একটি চলমান বিভ্রাট রিপোর্ট করা হয়েছে। কারেন্ট এলে নিচে জানান।"
                : "This browser reported an ongoing outage. When power returns, tell us below."
              : locale === "bn"
                ? `আজ এই ব্রাউজার থেকে ${reportedOutageCount.toLocaleString("bn-BD")}টি বিভ্রাট রিপোর্ট করা হয়েছে।`
                : `This browser has reported ${reportedOutageCount} outage${reportedOutageCount === 1 ? "" : "s"} today.`}
          </p>
        ) : null}

        <div className="signal-actions">
          <button className="signal-action signal-action--out" type="button" onClick={() => setReportMode("out")}>
            <small>
              {openOutage
                ? locale === "bn" ? "অবস্থা একই" : "Still out"
                : locale === "bn" ? "এখন জানান" : "Report now"}
            </small>
            <strong>
              {!openOutage && reportedOutageCount > 0
                ? locale === "bn" ? "আবার কারেন্ট গেছে" : "Current is out again"
                : text.actions.out}
            </strong>
          </button>
          <button className="signal-action signal-action--on" type="button" onClick={() => setReportMode("on")}>
            <small>
              {openOutage
                ? locale === "bn" ? "পরিবর্তন জানান" : "Report the change"
                : locale === "bn" ? "এখন নিশ্চিত করুন" : "Confirm now"}
            </small>
            <strong>
              {openOutage
                ? locale === "bn" ? "কারেন্ট ফিরে এসেছে" : "Current is back"
                : text.actions.on}
            </strong>
          </button>
        </div>
        <button className="history-action" type="button" onClick={() => setReportMode("daily")}>
          <small>{text.submit.todayOrYesterday}</small>
          <strong>{text.submit.history}</strong>
        </button>
        <p className="signal-disclaimer">{text.status.disclaimer}</p>
      </section>

      <ForecastCard snapshot={snapshot} onReport={() => setReportMode("daily")} />

      {reportMode ? (
        <ReportDialog
          area={area}
          mode={reportMode}
          onClose={closeReportDialog}
          onSubmitting={handleSubmitting}
          onSubmitted={handleSubmitted}
          onSubmissionError={handleSubmissionError}
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
    <section className="forecast-card" id="predictor">
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
