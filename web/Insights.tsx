import { useMemo } from "react";
import type { Column, ProjectState, RecordFile } from "../src/types";
import { ago } from "./api";
import { Label, StageIcon } from "./Icons";
import type { Context } from "./model";
import { PageHeader } from "./Pages";

const week = 7 * 24 * 60 * 60 * 1000;
const weeks = 8;
const roleOf = (r: RecordFile, ctx: Context) =>
  ctx.columns.find((c) => c.id === r.meta.status)?.role;

// Ticket flow over the last eight weeks: created vs finished per week.
export function flow(tickets: RecordFile[], ctx: Context, now = Date.now()) {
  const end = now + 1;
  const start = end - weeks * week;
  const bucket = (iso: string) => {
    const t = Date.parse(iso);
    return t >= start && t < end ? Math.floor((t - start) / week) : -1;
  };
  const created = new Array(weeks).fill(0),
    done = new Array(weeks).fill(0);
  for (const r of tickets) {
    const c = bucket(r.meta.createdAt);
    if (c >= 0) created[c]++;
    if (roleOf(r, ctx) === "done") {
      const d = bucket(r.meta.updatedAt);
      if (d >= 0) done[d]++;
    }
  }
  return Array.from({ length: weeks }, (_, i) => ({
    label: new Date(start + i * week).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
    created: created[i],
    done: done[i],
  }));
}

function FlowChart({ data }: { data: ReturnType<typeof flow> }) {
  const w = 640,
    h = 200,
    left = 28,
    top = 12,
    bottom = 28;
  const plotH = h - top - bottom;
  const max = Math.max(1, ...data.flatMap((d) => [d.created, d.done]));
  const slot = (w - left) / data.length;
  const bar = Math.min(22, slot / 3);
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const ticks = [0, Math.ceil(max / 2), max].filter(
    (v, i, a) => a.indexOf(v) === i,
  );
  const summary = data
    .map((d) => `${d.label}: ${d.created} created, ${d.done} done`)
    .join("; ");
  return (
    <svg
      className="flow-chart"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`Tickets created and finished per week. ${summary}`}
    >
      {ticks.map((v) => (
        <g key={v}>
          <line
            x1={left}
            x2={w}
            y1={y(v)}
            y2={y(v)}
            stroke="var(--line-soft)"
          />
          <text x={left - 6} y={y(v) + 3} textAnchor="end" className="axis">
            {v}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const x = left + i * slot + slot / 2;
        return (
          <g key={d.label}>
            <rect
              x={x - bar - 1}
              y={y(d.created)}
              width={bar}
              height={top + plotH - y(d.created)}
              fill="var(--accent)"
              rx="1"
            >
              <title>
                {d.created} created, week of {d.label}
              </title>
            </rect>
            <rect
              x={x + 1}
              y={y(d.done)}
              width={bar}
              height={top + plotH - y(d.done)}
              fill="var(--success)"
              rx="1"
            >
              <title>
                {d.done} done, week of {d.label}
              </title>
            </rect>
            <text x={x} y={h - 10} textAnchor="middle" className="axis">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function Insights({
  state,
  ctx,
}: {
  state: ProjectState;
  ctx: Context;
}) {
  const tickets = useMemo(
    () =>
      state.records.filter((r) => r.meta.kind === "ticket" && !r.meta.archived),
    [state.records],
  );
  const ids = new Set(tickets.map((r) => r.meta.id));
  const byRole = (role: Column["role"]) =>
    tickets.filter((r) => roleOf(r, ctx) === role).length;
  const open = tickets.filter((r) => roleOf(r, ctx) !== "done");
  const stats: [string, number][] = [
    ["Open tickets", open.length],
    ["In progress", byRole("progress")],
    ["In review", byRole("review")],
    ["Blocked", tickets.filter((r) => r.meta.blocked?.trim()).length],
    [
      "Open questions",
      state.comments.filter(
        (c) => c.kind === "question" && !c.resolved && ids.has(c.ticket),
      ).length,
    ],
  ];
  const data = useMemo(() => flow(tickets, ctx), [tickets, ctx]);
  const labels = new Map<string, number>();
  for (const r of open)
    for (const l of r.meta.labels ?? [])
      labels.set(l, (labels.get(l) ?? 0) + 1);
  const topLabels = [...labels].sort((a, b) => b[1] - a[1]).slice(0, 8);
  return (
    <>
      <PageHeader
        title="Insights"
        description="How work is moving: what is open, what is stuck, and what finished."
      />
      <div className="insights">
        <div className="stat-tiles">
          {stats.map(([name, value]) => (
            <div className="stat-tile" key={name}>
              <span className="eyebrow">{name}</span>
              <strong className="num">{value}</strong>
            </div>
          ))}
        </div>
        <section className="insight-panel flow">
          <div className="insight-head">
            <h2 className="eyebrow">Flow · last {weeks} weeks</h2>
            <span className="legend">
              <span className="swatch created" aria-hidden />
              Created
              <span className="swatch done" aria-hidden />
              Done
            </span>
          </div>
          <FlowChart data={data} />
        </section>
        <section className="insight-panel">
          <h2 className="eyebrow">By column</h2>
          <table className="insight-table">
            <thead>
              <tr>
                <th>Column</th>
                <th className="num-col">Count</th>
                <th>Oldest</th>
              </tr>
            </thead>
            <tbody>
              {ctx.columns.map((c) => {
                const rows = tickets.filter((r) => r.meta.status === c.id);
                const oldest = rows.reduce<string | null>(
                  (min, r) =>
                    !min || r.meta.createdAt < min ? r.meta.createdAt : min,
                  null,
                );
                return (
                  <tr key={c.id} data-stage={c.role}>
                    <td>
                      <StageIcon role={c.role} />
                      {c.name}
                    </td>
                    <td className="num-col num">{rows.length}</td>
                    <td className="muted">
                      {oldest ? ago(oldest).replace("just now", "new") : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        <section className="insight-panel">
          <h2 className="eyebrow">Top labels · open</h2>
          {topLabels.length ? (
            <ul className="label-ranking">
              {topLabels.map(([name, count]) => (
                <li key={name}>
                  <Label name={name} />
                  <span className="count">{count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="help">No labels on open tickets yet.</p>
          )}
        </section>
      </div>
    </>
  );
}
