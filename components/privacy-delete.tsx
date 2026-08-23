"use client";

import { useState } from "react";
import { ApiError, deleteMyReports } from "@/lib/client-api";

export function PrivacyDelete() {
  const [state, setState] = useState<"idle" | "confirm" | "working" | "done">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const remove = async () => {
    setState("working");
    setMessage(null);
    try {
      const result = await deleteMyReports();
      setMessage(
        `Deleted ${result.reportsDeleted} reports and reset this browser’s private contributor identity.`,
      );
      setState("done");
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Deletion could not be completed.");
      setState("idle");
    }
  };

  return (
    <div className="privacy-delete">
      <h2>Delete this browser’s reports</h2>
      <p>
        CurrentJabe can delete reports associated with this browser’s private contributor cookie.
        This cannot find reports submitted after clearing cookies or from another browser.
      </p>
      {state === "confirm" ? (
        <div className="privacy-delete__actions">
          <button className="button-primary" type="button" onClick={remove}>Delete my reports</button>
          <button className="button-ghost" type="button" onClick={() => setState("idle")}>Cancel</button>
        </div>
      ) : state === "done" ? null : (
        <button className="button-secondary" type="button" disabled={state === "working"} onClick={() => setState("confirm")}>
          {state === "working" ? "Deleting…" : "Request deletion"}
        </button>
      )}
      {message ? <p className="privacy-delete__message" role="status">{message}</p> : null}
    </div>
  );
}
