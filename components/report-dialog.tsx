"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ApiError,
  recordAnalytics,
  submitDailyReport,
  submitLiveReport,
  type DailyWindowInput,
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

type TimeWindowDraft = {
  id: string;
  startTime: string;
  endTime: string;
  approximate: boolean;
};

function createWindow(id: string): TimeWindowDraft {
  return { id, startTime: "", endTime: "", approximate: false };
}

export function ReportDialog({
  area,
  mode,
  onClose,
  onSubmitted,
}: {
  area: ReportArea;
  mode: ReportMode;
  onClose: () => void;
  onSubmitted?: () => void;
}) {
  const { locale, text } = useLanguage();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<"form" | "times" | "success">("form");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateOffset, setDateOffset] = useState<0 | -1>(0);
  const [countKnown, setCountKnown] = useState(true);
  const [outageCount, setOutageCount] = useState<number | null>(1);
  const [rememberTimes, setRememberTimes] = useState(true);
  const [windows, setWindows] = useState<TimeWindowDraft[]>([createWindow("window-1")]);

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
        onClose();
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

  const finishSuccess = async () => {
    setStep("success");
    await recordAnalytics("report_completed", area.id);
    onSubmitted?.();
  };

  const submitLive = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      await submitLiveReport(mode as "out" | "on", area.id);
      await finishSuccess();
    } catch (requestError) {
      setError(
        requestError instanceof ApiError ? requestError.message : text.report.error,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitDaily = async () => {
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

    if (!countKnown && usableWindows.length === 0) {
      setError(text.report.needOneMemory);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await submitDailyReport({
        upazilaId: area.id,
        date: getDhakaDate(dateOffset),
        countKnown,
        outageCount,
        windows: usableWindows,
      });
      await finishSuccess();
    } catch (requestError) {
      setError(
        requestError instanceof ApiError ? requestError.message : text.report.error,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const setCount = (count: number) => {
    setCountKnown(true);
    setOutageCount(count);
    setRememberTimes(true);
    setWindows((current) => {
      const desired = count;
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

  const title =
    mode === "out"
      ? text.report.titleOut
      : mode === "on"
        ? text.report.titleOn
        : text.report.titleHistory;

  return createPortal(
    <div className="report-overlay" role="presentation" onMouseDown={onClose}>
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="report-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <button className="dialog-close" type="button" onClick={onClose} aria-label={text.actions.close}>
          <CloseIcon />
        </button>
        <div className="report-dialog__body" ref={bodyRef}>
          {step === "success" ? (
            <div className="report-success">
              <span className="report-success__icon"><CheckIcon /></span>
              <p className="eyebrow">{text.report.received}</p>
              <h2 id={titleId}>{text.report.successTitle}</h2>
              <p>{text.report.successBody}</p>
              <button className="button-dark" type="button" onClick={onClose}>
                {text.actions.done}
              </button>
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
                    {isSubmitting ? text.common.loading : mode === "out" ? text.actions.out : text.actions.on}
                  </button>
                </div>
              ) : step === "form" ? (
                <div className="daily-count-form">
                  <div className="date-switch" aria-label={text.report.dateLabel}>
                    <button
                      className={dateOffset === 0 ? "is-active" : ""}
                      type="button"
                      onClick={() => setDateOffset(0)}
                    >
                      {text.report.today}
                    </button>
                    <button
                      className={dateOffset === -1 ? "is-active" : ""}
                      type="button"
                      onClick={() => setDateOffset(-1)}
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
                        className={outageCount === count ? "is-active" : ""}
                        key={count}
                        type="button"
                        onClick={() => setCount(count)}
                      >
                        {locale === "bn" ? count.toLocaleString("bn-BD") : count}
                      </button>
                    ))}
                    <button
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
                  <div>
                    <h3>{text.report.rememberQuestion}</h3>
                    <p>{text.report.rememberHelp}</p>
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
                      {isSubmitting ? text.common.loading : text.actions.submit}
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
