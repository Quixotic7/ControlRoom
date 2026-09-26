import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectState } from "../src/types";
import { api } from "./api";

// Loads project state and keeps it fresh from file-change events, a periodic
// poll, and explicit reloads after mutations. Responses are sequenced so a
// slow, older request can never overwrite newer state.
export function useProjectState() {
  const [state, setState] = useState<ProjectState | null>(null);
  const [loadError, setLoadError] = useState("");
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const request = ++latest.current;
    try {
      const next = await api<ProjectState>("/state");
      if (request !== latest.current) return;
      setLoadError("");
      // Keep the same object when nothing changed so views don't recompute.
      setState((prev) => (prev?.revision === next.revision ? prev : next));
    } catch (e) {
      if (request !== latest.current) return;
      setLoadError(String(e));
    }
  }, []);
  useEffect(() => {
    void reload();
    const events = new EventSource("/api/events");
    events.onmessage = () => void reload();
    const interval = setInterval(reload, 5000);
    const active = () => {
      if (document.visibilityState === "visible")
        api("/active", "POST", {}).catch(() => {});
    };
    active();
    window.addEventListener("focus", active);
    document.addEventListener("visibilitychange", active);
    return () => {
      events.close();
      clearInterval(interval);
      window.removeEventListener("focus", active);
      document.removeEventListener("visibilitychange", active);
    };
  }, [reload]);
  return { state, reload, loadError };
}
