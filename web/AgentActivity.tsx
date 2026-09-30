import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type Activity = { ticket: string; runId: string; worker: string };
const ActivityContext = createContext<Activity[]>([]);

// One lightweight poll for the entire workspace, not one per card. A failed or
// stalled request clears the signal rather than retaining a false running state.
export function AgentActivityProvider({ children }: { children: ReactNode }) {
  const [activity, setActivity] = useState<Activity[]>([]);
  useEffect(() => {
    let disposed = false;
    let controller: AbortController | undefined;
    async function refresh() {
      if (controller || document.hidden) return;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 4000);
      try {
        const response = await fetch("/api/activity", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Activity unavailable");
        const next = (await response.json()) as Activity[];
        if (!Array.isArray(next)) throw new Error("Invalid activity");
        if (!disposed)
          setActivity((previous) =>
            JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
          );
      } catch {
        if (!disposed)
          setActivity((previous) => (previous.length ? [] : previous));
      } finally {
        clearTimeout(timeout);
        controller = undefined;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    const visibility = () => {
      // Background timers may be suspended. Never redisplay an old running
      // indication while waiting for a fresh check after returning to the tab.
      setActivity([]);
      controller?.abort();
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true;
      clearInterval(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  return (
    <ActivityContext.Provider value={activity}>
      {children}
    </ActivityContext.Provider>
  );
}

export function useAgentActivity(ticket: string) {
  return useContext(ActivityContext).find(
    (activity) => activity.ticket === ticket,
  );
}
