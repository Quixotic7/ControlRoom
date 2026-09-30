import { useEffect, useState } from "react";
import type { RecordFile, Claim } from "../src/types";
import { ago } from "./api";
export function ProgressReport({
  record,
  claim,
  role,
}: {
  record: RecordFile;
  claim?: Claim;
  role?: string;
}) {
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  const p = record.meta.progress,
    start = record.meta.progressStartedAt;
  const expired = !!claim && Date.parse(claim.expiresAt) <= clock;
  const last = [p?.at, claim?.reportedAt].filter(Boolean).sort().at(-1);
  const stale = !!last && clock - Date.parse(last) > 30 * 60 * 1000;
  if (!p && !claim && role !== "progress") return null;
  const minutes = start
    ? Math.max(0, Math.floor((clock - Date.parse(start)) / 60000))
    : null;
  const elapsed =
    minutes === null
      ? "Start unknown"
      : minutes < 60
        ? `${minutes}m`
        : minutes < 1440
          ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
          : `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
  return (
    <span
      className={`progress-report${role === "progress" && !record.meta.blocked && !expired && last && !stale ? " recent-report" : ""}`}
    >
      {role === "progress" && (
        <span title="Wall-clock time since the current In Progress entry; not active agent time">
          In Progress · {elapsed} elapsed
        </span>
      )}
      {claim && (
        <span className={expired ? "stale" : "muted"}>
          {expired ? "Expired claim" : "Claimed"} · {claim.actor.name}
        </span>
      )}
      {last && (
        <span title={last}>
          Last reported {ago(last)}
          {p && p.at === last ? ` by ${p.actor.name}` : ""}
          {stale ? " · stale report" : ""}
        </span>
      )}
      {p && (
        <span title={`${p.actor.name}: ${p.note}`}>
          {start && p.at < start ? "Earlier session: " : ""}
          {p.note} ·{" "}
          {p.percent === undefined ? "No estimate" : `${p.percent}% estimate`}
        </span>
      )}
      {p?.percent !== undefined && (
        <span
          className="progress-meter"
          role="meter"
          aria-label="Reported progress estimate"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={p.percent}
        >
          <span style={{ width: `${p.percent}%` }} />
        </span>
      )}
    </span>
  );
}
