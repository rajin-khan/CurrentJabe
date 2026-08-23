"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ApiError,
  ensureVisitor,
  getMyReports,
  submitDailyReport,
  submitLiveReport,
  type DailyWindowInput,
  type LiveState,
  type MyReports,
} from "@/lib/client-api";
import { getDhakaDate } from "@/lib/dhaka-date";
import { CheckIcon, CloseIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";

export type ReportArea = {
  id: string;
  slug: string;
  name: string;
  nameBn?: string | null;
  districtName?: string | null;
  districtNameBn?: string | null;
};

export type ReportMode = "out" | "on" | "daily";

export type ReportSubmissionReceipt =
  | {
      mode: "out" | "on";
      duplicate: boolean;
      liveState: LiveState;
    }
  | {
      mode: "daily";
      duplicate: boolean;
      insertedTimedEvents: number;
      date: string;
      ignoredIncompleteWindows?: number;
    };

type TimeWindowDraft = {
  id: string;
  startTime: string;
  endTime: string;
  approximate: boolean;
};

type DailyFormDraft = {
  countKnown: boolean;
  outageCount: number | null;
  rememberTimes: boolean;
  windows: TimeWindowDraft[];
  step: "form" | "times";
};

function createWindow(id: string): TimeWindowDraft {
  return { id, startTime: "", endTime: "", approximate: false };
}

function reportErrorMessage(
  error: unknown,
  locale: "en" | "bn",
  fallback: string,
  messages: {
    invalid: string;
    rateLimit: string;
    temporary: string;
  },
): string {
  if (!(error instanceof ApiError)) return messages.temporary || fallback;
  if (error.code === "rate_limit_exceeded") return messages.rateLimit;
  if (error.code === "validation_error" || error.code === "invalid_request") {
    return messages.invalid;
  }
  if (
    error.code === "database_error" ||
    error.code === "database_timeout" ||
    error.code === "database_unreachable" ||
    error.code === "invalid_response" ||
    error.code === "request_failed"
  ) {
    return messages.temporary;
  }
  if (error.code === "submissions_disabled" || error.code === "area_disabled") {
    return locale === "bn"
      ? "এই এলাকার কমিউনিটি রিপোর্ট সাময়িকভাবে বন্ধ আছে। একটু পরে আবার চেষ্টা করুন।"
      : "Community reporting for this area is temporarily paused. Please try again later.";
  }
  return fallback;
}

function formatSavedTime(iso: string, locale: "en" | "bn"): string {
  return new Intl.DateTimeFormat(locale === "bn" ? "bn-BD" : "en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Dhaka",
  }).format(new Date(iso));
}

export function ReportDialog({
  area,
  mode,
  onClose,
  onSubmitting,
  onSubmitted,
  onSubmissionError,
}: {
  area: ReportArea;
  mode: ReportMode;
  onClose: () => void;
  onSubmitting?: (mode: ReportMode) => void;
  onSubmitted?: (receipt: ReportSubmissionReceipt) => void | Promise<void>;
  onSubmissionError?: () => void;
}) {
  const { locale, text } = useLanguage();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const submittingRef = useRef(false);
  const dailyDraftsRef = useRef<Record<string, DailyFormDraft>>({});
  const [step, setStep] = useState<"loading" | "form" | "times" | "success">(
    mode === "daily" ? "loading" : "form",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<ReportSubmissionReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dateOffset, setDateOffset] = useState<0 | -1>(0);
  const [reportDate, setReportDate] = useState(() => getDhakaDate());
  const [countKnown, setCountKnown] = useState(true);
  const [outageCount, setOutageCount] = useState<number | null>(1);
  const [rememberTimes, setRememberTimes] = useState(true);
  const [windows, setWindows] = useState<TimeWindowDraft[]>([createWindow("window-1")]);
  const [history, setHistory] = useState<MyReports | null>(null);

  const areaName = locale === "bn" && area.nameBn ? area.nameBn : area.name;
  const districtName =
    locale === "bn" && area.districtNameBn ? area.districtNameBn : area.districtName;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overlay = panelRef.current?.parentElement ?? null;
    const background = Array.from(document.body.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== overlay)
      .map((element) => ({
        element,
        inert: element.inert,
        ariaHidden: element.getAttribute("aria-hidden"),
      }));
    for (const item of background) {
      item.element.inert = true;
      item.element.setAttribute("aria-hidden", "true");
    }
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!submittingRef.current) onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      for (const item of background) {
        item.element.inert = item.inert;
        if (item.ariaHidden === null) item.element.removeAttribute("aria-hidden");
        else item.element.setAttribute("aria-hidden", item.ariaHidden);
      }
      previousFocus?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [step]);

  useEffect(() => {
    let active = true;
    if (mode !== "daily") {
      void ensureVisitor().catch(() => undefined);
      return () => {
        active = false;
      };
    }

    const date = getDhakaDate(dateOffset);
    setReportDate(date);
    setStep("loading");
    setError(null);
    setHistory(null);
    void getMyReports(area.id, date)
      .then((saved) => {
        if (!active) return;
        setHistory(saved);
        const draft = dailyDraftsRef.current[date];
        if (draft) {
          setCountKnown(draft.countKnown);
          setOutageCount(draft.outageCount);
          setRememberTimes(draft.rememberTimes);
          setWindows(draft.windows);
          setStep(draft.step);
          return;
        }
        const savedCount = Math.max(
          saved.events.length,
          saved.dailySubmission?.outageCount ?? 0,
        );
        if (saved.events.length > 0 || saved.dailySubmission) {
          const savedCountKnown = saved.dailySubmission?.countKnown ?? true;
          setCountKnown(savedCountKnown);
          setOutageCount(savedCountKnown ? savedCount : null);
          setRememberTimes(true);
          setWindows([createWindow(`window-return-${date}`)]);
          setStep("times");
        } else {
          setCountKnown(true);
          setOutageCount(1);
          setRememberTimes(true);
          setWindows([createWindow(`window-first-${date}`)]);
          setStep("form");
        }
      })
      .catch(() => {
        if (!active) return;
        setHistory(null);
        const draft = dailyDraftsRef.current[date];
        if (draft) {
          setCountKnown(draft.countKnown);
          setOutageCount(draft.outageCount);
          setRememberTimes(draft.rememberTimes);
          setWindows(draft.windows);
          setStep(draft.step);
        } else {
          setCountKnown(true);
          setOutageCount(1);
          setRememberTimes(true);
          setWindows([createWindow(`window-fallback-${date}`)]);
          setStep("form");
        }
        void ensureVisitor().catch(() => undefined);
      });

    return () => {
      active = false;
    };
  }, [area.id, dateOffset, mode]);

  const finishSuccess = (nextReceipt: ReportSubmissionReceipt) => {
    setReceipt(nextReceipt);
    setStep("success");
    void Promise.resolve(onSubmitted?.(nextReceipt));
  };

  const submitLive = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    onSubmitting?.(mode);
    try {
      await ensureVisitor();
      const result = await submitLiveReport(mode as "out" | "on", area.id);
      finishSuccess({
        mode: mode as "out" | "on",
        duplicate: result.duplicate,
        liveState: result.liveState,
      });
    } catch (requestError) {
      onSubmissionError?.();
      setError(reportErrorMessage(requestError, locale, text.report.error, {
        invalid: text.report.friendlyInvalid,
        rateLimit: text.report.friendlyRateLimit,
        temporary: text.report.friendlyTemporary,
      }));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const submitDaily = async () => {
    if (submittingRef.current) return;
    const incompleteWindowCount = rememberTimes
      ? windows.filter((window) => Boolean(window.startTime) !== Boolean(window.endTime)).length
      : 0;
    const usableWindows: DailyWindowInput[] = rememberTimes
      ? windows.flatMap((window) =>
          window.startTime && window.endTime
            ? [
                {
                  startTime: window.startTime,
                  endTime: window.endTime,
                  precision: window.approximate ? "approximate" : "exact",
                } satisfies DailyWindowInput,
              ]
            : [],
        )
      : [];

    submittingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    onSubmitting?.("daily");
    try {
      await ensureVisitor();
      const date = reportDate;
      const savedFloor = Math.max(
        history?.events.length ?? 0,
        history?.dailySubmission?.outageCount ?? 0,
      );
      const effectiveCountKnown = countKnown || Boolean(history?.dailySubmission?.countKnown);
      const effectiveOutageCount = effectiveCountKnown
        ? Math.min(
            24,
            Math.max(
              outageCount ?? 0,
              savedFloor,
              savedFloor + usableWindows.length,
              usableWindows.length,
            ),
          )
        : null;
      const result = await submitDailyReport({
        upazilaId: area.id,
        date,
        countKnown: effectiveCountKnown,
        outageCount: effectiveOutageCount,
        windows: usableWindows,
      });
      finishSuccess({
        mode: "daily",
        duplicate: result.duplicate,
        insertedTimedEvents: result.insertedEventIds.length,
        date,
        ignoredIncompleteWindows: incompleteWindowCount,
      });
    } catch (requestError) {
      onSubmissionError?.();
      setError(reportErrorMessage(requestError, locale, text.report.error, {
        invalid: text.report.friendlyInvalid,
        rateLimit: text.report.friendlyRateLimit,
        temporary: text.report.friendlyTemporary,
      }));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const setCount = (count: number) => {
    setCountKnown(true);
    setOutageCount(count);
    setRememberTimes(true);
    setWindows((current) => {
      const savedFloor = Math.max(
        history?.events.length ?? 0,
        history?.dailySubmission?.outageCount ?? 0,
      );
      const desired = Math.max(1, count - savedFloor);
      if (current.length >= desired) return current.slice(0, desired);
      return [
        ...current,
        ...Array.from({ length: desired - current.length }, (_, index) =>
          createWindow(`window-${current.length + index + 1}-${Date.now()}`),
        ),
      ];
    });
  };

  const setUnknownCount = () => {
    setCountKnown(false);
    setOutageCount(null);
    setRememberTimes(true);
    setWindows((current) => (current.length > 0 ? current : [createWindow(`window-${Date.now()}`)]));
  };

  const changeDate = (nextOffset: 0 | -1) => {
    if (nextOffset === dateOffset) return;
    dailyDraftsRef.current[reportDate] = {
      countKnown,
      outageCount,
      rememberTimes,
      windows,
      step: step === "times" ? "times" : "form",
    };
    setDateOffset(nextOffset);
  };

  const title =
    mode === "out"
      ? text.report.titleOut
      : mode === "on"
        ? text.report.titleOn
        : text.report.titleHistory;

  const hadSavedDailyHistory = Boolean(history?.events.length || history?.dailySubmission);
  const savedOutageCount = Math.max(
    history?.events.length ?? 0,
    history?.dailySubmission?.outageCount ?? 0,
  );
  const successBody = receipt?.mode === "daily"
    ? receipt.ignoredIncompleteWindows
      ? `${hadSavedDailyHistory ? text.report.successDailyUpdate : text.report.successDaily} ${text.report.partialSaved}`
      : receipt.duplicate
        ? text.report.successNoChange
        : hadSavedDailyHistory
          ? text.report.successDailyUpdate
          : text.report.successDaily
    : receipt?.duplicate
      ? text.report.successDuplicate
      : receipt
        ? text.report.successLive.replace(
            "{count}",
            locale === "bn"
              ? receipt.liveState.recentContributorCount.toLocaleString("bn-BD")
              : String(receipt.liveState.recentContributorCount),
          )
        : text.report.successBody;

  return createPortal(
    <div
      className="report-overlay"
      role="presentation"
      onMouseDown={() => {
        if (!submittingRef.current) onClose();
      }}
    >
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        aria-busy={isSubmitting || step === "loading"}
        className="report-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <button className="dialog-close" disabled={isSubmitting} type="button" onClick={onClose} aria-label={text.actions.close}>
          <CloseIcon />
        </button>
        <div className="report-dialog__body" ref={bodyRef}>
          {step === "success" ? (
            <div className="report-success">
              <span className="report-success__icon"><CheckIcon /></span>
              <p className="eyebrow">{text.report.received}</p>
              <h2 id={titleId}>{text.report.successTitle}</h2>
              <p role="status" aria-live="polite">{successBody}</p>
              <div className="report-success__actions">
                <a className="button-dark" href={`/area/${area.slug}`}>
                  {locale === "bn" ? "আপডেট করা এলাকা দেখুন" : "View updated area"}
                </a>
                <button className="button-ghost" type="button" onClick={onClose}>
                  {text.actions.done}
                </button>
              </div>
            </div>
          ) : step === "loading" ? (
            <div className="report-history-loading" role="status" aria-live="polite">
              <span aria-hidden="true" />
              <p className="eyebrow">{text.report.privacy}</p>
              <h2 id={titleId}>{text.report.loadingHistory}</h2>
              <div aria-hidden="true"><i /><i /><i /></div>
            </div>
          ) : (
            <>
              <p className="eyebrow">{text.report.privacy}</p>
              <h2 id={titleId}>{title}</h2>
              <div className="report-location">
                <span>{text.report.location}</span>
                <strong>{areaName}</strong>
                {districtName ? <small>{districtName}</small> : null}
              </div>

              {mode === "out" || mode === "on" ? (
                <div className="live-report-form">
                  <p>{mode === "out" ? text.report.liveOutBody : text.report.liveOnBody}</p>
                  {error ? <p className="form-error" role="alert">{error}</p> : null}
                  <button
                    className={mode === "out" ? "live-submit live-submit--out" : "live-submit live-submit--on"}
                    disabled={isSubmitting}
                    type="button"
                    onClick={submitLive}
                  >
                    {isSubmitting ? text.status.submitting : mode === "out" ? text.actions.out : text.actions.on}
                  </button>
                </div>
              ) : step === "form" ? (
                <div className="daily-count-form">
                  <div className="date-switch" aria-label={text.report.dateLabel} role="group">
                    <button
                      aria-pressed={dateOffset === 0}
                      className={dateOffset === 0 ? "is-active" : ""}
                      type="button"
                      onClick={() => changeDate(0)}
                    >
                      {text.report.today}
                    </button>
                    <button
                      aria-pressed={dateOffset === -1}
                      className={dateOffset === -1 ? "is-active" : ""}
                      type="button"
                      onClick={() => changeDate(-1)}
                    >
                      {text.report.yesterdayLabel}
                    </button>
                  </div>
                  <div>
                    <h3>{text.report.countQuestion}</h3>
                    <p>{text.report.countHelp}</p>
                  </div>
                  <div className="count-picker" role="group" aria-label={text.report.countQuestion}>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((count) => (
                      <button
                        aria-pressed={outageCount === count}
                        className={outageCount === count ? "is-active" : ""}
                        key={count}
                        type="button"
                        onClick={() => setCount(count)}
                      >
                        {locale === "bn" ? count.toLocaleString("bn-BD") : count}
                      </button>
                    ))}
                    <button
                      aria-pressed={!countKnown}
                      className={`count-unknown${countKnown ? "" : " is-active"}`}
                      type="button"
                      onClick={setUnknownCount}
                    >
                      {text.report.unknownCount}
                    </button>
                  </div>
                  <button className="button-primary report-next" type="button" onClick={() => setStep("times")}>
                    {text.actions.continue}
                  </button>
                </div>
              ) : (
                <div className="daily-times-form">
                  {hadSavedDailyHistory ? (
                    <section className="saved-report-summary" aria-label={dateOffset === 0 ? text.report.todaySoFar : text.report.yesterdaySoFar}>
                      <p className="eyebrow">
                        {dateOffset === 0 ? text.report.todaySoFar : text.report.yesterdaySoFar}
                      </p>
                      <strong>
                        {text.report.savedOutages.replace(
                          "{count}",
                          locale === "bn"
                            ? savedOutageCount.toLocaleString("bn-BD")
                            : String(savedOutageCount),
                        )}
                      </strong>
                      {history && history.events.length > 0 ? (
                        <div className="saved-report-times">
                          {history.events.slice(0, 8).map((event) => (
                            <span key={event.id}>
                              {formatSavedTime(event.startedAt, locale)}
                              {" - "}
                              {event.endedAt
                                ? formatSavedTime(event.endedAt, locale)
                                : locale === "bn" ? "এখনও চলছে" : "ongoing"}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <small>{text.report.noSavedTimes}</small>
                      )}
                      <p>{text.report.addAnother}</p>
                    </section>
                  ) : null}
                  <div>
                    <h3>{hadSavedDailyHistory ? text.report.addWindow : text.report.rememberQuestion}</h3>
                    <p>{text.report.rememberHelp}</p>
                    <p className="daily-evidence-note">{text.report.countOnlyNote}</p>
                  </div>
                  {countKnown ? (
                    <label className="memory-toggle">
                      <input
                        checked={!rememberTimes}
                        type="checkbox"
                        onChange={(event) => setRememberTimes(!event.target.checked)}
                      />
                      <span aria-hidden="true" />
                      {text.report.noTimes}
                    </label>
                  ) : null}

                  {rememberTimes ? (
                    <div className="time-window-list">
                      {windows.map((window, index) => (
                        <div className="time-window" key={window.id}>
                          <div className="time-window__head">
                            <strong>{text.report.outage} {index + 1}</strong>
                            {windows.length > 1 ? (
                              <button
                                type="button"
                                aria-label={text.report.removeOutage.replace("{number}", String(index + 1))}
                                onClick={() => setWindows((current) => current.filter((item) => item.id !== window.id))}
                              >
                                <TrashIcon />
                              </button>
                            ) : null}
                          </div>
                          <div className="time-window__fields">
                            <label>
                              <span>{text.report.start}</span>
                              <input
                                type="time"
                                value={window.startTime}
                                onChange={(event) =>
                                  setWindows((current) =>
                                    current.map((item) =>
                                      item.id === window.id ? { ...item, startTime: event.target.value } : item,
                                    ),
                                  )
                                }
                              />
                            </label>
                            <label>
                              <span>{text.report.end}</span>
                              <input
                                type="time"
                                value={window.endTime}
                                onChange={(event) =>
                                  setWindows((current) =>
                                    current.map((item) =>
                                      item.id === window.id ? { ...item, endTime: event.target.value } : item,
                                    ),
                                  )
                                }
                              />
                            </label>
                          </div>
                          <label className="approx-toggle">
                            <input
                              checked={window.approximate}
                              type="checkbox"
                              onChange={(event) =>
                                setWindows((current) =>
                                  current.map((item) =>
                                    item.id === window.id ? { ...item, approximate: event.target.checked } : item,
                                  ),
                                )
                              }
                            />
                            <span aria-hidden="true" />
                            {text.report.approximate}
                          </label>
                        </div>
                      ))}
                      {windows.length < (outageCount ?? 10) ? (
                        <button
                          className="add-window"
                          type="button"
                          onClick={() => setWindows((current) => [...current, createWindow(`window-${Date.now()}`)])}
                        >
                          <PlusIcon />
                          {text.report.addWindow}
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {error ? <p className="form-error" role="alert">{error}</p> : null}
                  <div className="report-dialog__footer-actions">
                    <button className="button-ghost" type="button" onClick={() => setStep("form")}>
                      {text.actions.back}
                    </button>
                    <button className="button-primary" disabled={isSubmitting} type="button" onClick={submitDaily}>
                      {isSubmitting
                        ? text.status.submitting
                        : hadSavedDailyHistory
                          ? text.report.saveUpdate
                          : text.actions.submit}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
