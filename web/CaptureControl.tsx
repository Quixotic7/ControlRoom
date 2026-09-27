import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, ConnectionError } from "./api";
import { ImageIcon } from "./Icons";
import { PageHeader } from "./Pages";

// Keep capture-command confirmation separate from its diagnostic status read.
// Losing that read does not mean the screenshot failed or justify recapturing.
export function CaptureControl({ children }: { children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState(false);
  const active = useRef(true);
  const pending = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  async function checkStatus(requested: boolean) {
    try {
      const status = await api<{ state: string; message?: string }>(
        "/capture/status",
      );
      if (!active.current) return;
      setProblem(false);
      setMessage(
        ["ready", "capturing", "cancelled"].includes(status.state)
          ? ""
          : `${status.message || "Capture companion unavailable."} See Settings for permissions and companion status.`,
      );
    } catch (e) {
      if (!active.current) return;
      setProblem(true);
      setMessage(
        e instanceof ConnectionError
          ? `${requested ? "Capture was requested, but its status is temporarily unavailable." : "Capture status is temporarily unavailable."} Check Screenshots for the image. Use Check capture status to reconnect without taking another screenshot.`
          : String(e),
      );
    }
  }
  async function run(capture: boolean) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    setProblem(false);
    try {
      if (capture) {
        try {
          await api("/capture/request", "POST", {});
        } catch (e) {
          if (active.current) {
            setProblem(true);
            setMessage(
              e instanceof ConnectionError
                ? "Couldn't confirm the capture request. If the capture picker opened, finish or cancel it. Check Screenshots and use Check capture status before requesting another capture."
                : String(e),
            );
          }
          return;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (active.current) await checkStatus(capture);
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        title="Screenshots"
        description="Capture, annotate, and keep visual notes, with or without a ticket."
      >
        <button
          className="button"
          disabled={busy}
          title="Select a region or window with the macOS companion"
          onClick={() => void run(true)}
        >
          <ImageIcon />
          {busy ? "Checking capture…" : "Capture a region or window"}
        </button>
        {children}
      </PageHeader>
      {message && (
        <div
          className={`banner${problem ? " error" : ""}`}
          role={problem ? "alert" : "status"}
        >
          <span>{message}</span>
          <button
            className="button"
            disabled={busy}
            onClick={() => void run(false)}
          >
            Check capture status
          </button>
          <button
            aria-label="Dismiss capture message"
            onClick={() => setMessage("")}
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
