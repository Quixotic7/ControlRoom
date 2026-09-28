import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectState } from "../src/types";
import { api, isRemoteBrowser } from "./api";

// Loads project state and keeps it fresh from file-change events, a periodic
// poll, and explicit reloads after mutations. Coalesce concurrent triggers,
// with a trailing read so a mutation during a read still refreshes the view.
export function useProjectState() {
  const [state, setState] = useState<ProjectState | null>(null);
  const [loadError, setLoadError] = useState("");
  const inFlight = useRef<Promise<void> | null>(null);
  const queued = useRef(false);
  const reload = useCallback(() => {
    queued.current = true;
    if (inFlight.current) return inFlight.current;
    inFlight.current = (async () => {
      do {
        queued.current = false;
        try {
          const next = await api<ProjectState>("/state");
          setLoadError("");
          setState((prev) => (prev?.revision === next.revision ? prev : next));
        } catch (e) {
          setLoadError(String(e));
          // Do not let polling during an outage create an endless request loop.
          queued.current = false;
        }
      } while (queued.current);
    })().finally(() => {
      inFlight.current = null;
    });
    return inFlight.current;
  }, []);
  useEffect(() => {
    void reload();
    const events = new EventSource("/api/events");
    events.onmessage = () => void reload();
    const interval = setInterval(reload, 5000);
    const activate = () => {
      if (
        !isRemoteBrowser() &&
        document.visibilityState === "visible" &&
        document.hasFocus()
      )
        api("/active", "POST", {}).catch(() => {});
    };
    const active = () => {
      if (document.visibilityState === "visible") void reload();
      activate();
    };
    active();
    window.addEventListener("focus", active);
    document.addEventListener("visibilitychange", active);
    // Two windows can both be visible. Actual interaction, not background
    // refreshes or mounting a tab, determines the next capture destination.
    window.addEventListener("pointerdown", activate);
    window.addEventListener("keydown", activate);
    return () => {
      events.close();
      clearInterval(interval);
      window.removeEventListener("focus", active);
      document.removeEventListener("visibilitychange", active);
      window.removeEventListener("pointerdown", activate);
      window.removeEventListener("keydown", activate);
    };
  }, [reload]);
  return { state, reload, loadError };
}
