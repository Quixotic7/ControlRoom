// Pure project-view logic: filtering, grouping, sorting, and attention.
// No React or DOM here, so it can be unit tested directly.
import type {
  Column,
  Attachment,
  GroupBy,
  ProjectState,
  ProjectView,
  RecordFile,
  SortBy,
} from "../src/types";

export const priorities = ["Urgent", "High", "Normal", "Low"];
export const priorityOf = (r: RecordFile) => r.meta.priority ?? 2;
export const priorityName = (r: RecordFile) =>
  priorities[priorityOf(r)] ?? "Normal";

export const defaultViews: ProjectView[] = [
  {
    id: "board",
    name: "Board",
    layout: "board",
    filter: "",
    groupBy: "parent",
    sort: "priority",
  },
  {
    id: "table",
    name: "Table",
    layout: "table",
    filter: "",
    groupBy: "none",
    sort: "number",
  },
  {
    id: "priority-planning",
    name: "Priority planning",
    layout: "table",
    filter: "",
    groupBy: "priority",
    sort: "priority",
  },
];
// Projects created before Priority planning saved their own view list. Keep
// that list intact, but surface the new built-in preset alongside it instead
// of making an existing project recreate its views to discover planning.
export const viewsOf = (state: ProjectState) => {
  const views = state.config.views?.length ? state.config.views : defaultViews;
  const planning = defaultViews.find(
    (view) => view.id === "priority-planning",
  )!;
  return views.some((view) => view.id === planning.id)
    ? views
    : [...views, planning];
};

export const groupByOptions: Record<GroupBy, string> = {
  none: "No grouping",
  parent: "Parent goal",
  status: "Status",
  priority: "Priority",
  owner: "Owner",
  label: "Label",
};
export const sortOptions: Record<SortBy, string> = {
  manual: "Manual order",
  priority: "Priority, then rank",
  number: "Ticket number",
  updated: "Recently updated",
  title: "Title",
};

// ---------------------------------------------------------------- filtering

export type FilterTerm = { key: string; values: string[]; negate: boolean };
export type Filter = { text: string[]; terms: FilterTerm[] };
export type ApprovalFilter = "all" | "approved" | "not-approved" | "custom";
export const filterKeys = [
  "status",
  "label",
  "owner",
  "priority",
  "parent",
  "is",
  "has",
  "no",
];

// Splits on whitespace outside double quotes: label:"needs design" -> one token.
function tokens(query: string) {
  return query.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
}
const unquote = (s: string) => s.replace(/"/g, "");

// GitHub-style filter syntax: `key:value`, `key:a,b` (either), `-key:value`
// (exclude), and free text. Unknown keys are treated as free text.
export function parseFilter(query: string): Filter {
  const filter: Filter = { text: [], terms: [] };
  for (const token of tokens(query)) {
    const match = token.match(/^(-?)([a-z]+):(.+)$/i);
    const key = match?.[2].toLowerCase();
    if (match && key && filterKeys.includes(key)) {
      const values = match[3]
        .split(",")
        .map((v) => unquote(v).trim().toLowerCase())
        .filter(Boolean);
      if (values.length)
        filter.terms.push({ key, values, negate: match[1] === "-" });
    } else {
      const text = unquote(token).toLowerCase();
      if (text) filter.text.push(text);
    }
  }
  return filter;
}

// The compact approval control shares the query with the regular filter input.
// Its edits only remove or add `is:approved`, retaining every other constraint.
const approvalValues = (token: string) => {
  const match = token.match(/^(-?)(is):(.+)$/i);
  if (!match) return null;
  const values = match[3]
    .split(",")
    .map((value) => unquote(value).trim().toLowerCase())
    .filter(Boolean);
  return values.includes("approved")
    ? { negate: match[1] === "-", values }
    : null;
};

export function approvalFilterOf(query: string): ApprovalFilter {
  const approvals = tokens(query)
    .map(approvalValues)
    .filter((term): term is { negate: boolean; values: string[] } => !!term);
  if (!approvals.length) return "all";
  if (approvals.every((term) => !term.negate && term.values.length === 1))
    return "approved";
  if (approvals.every((term) => term.negate && term.values.length === 1))
    return "not-approved";
  return "custom";
}

export function withApprovalFilter(query: string, approval: ApprovalFilter) {
  const retained = tokens(query).flatMap((token) => {
    const match = token.match(/^(-?)(is):(.+)$/i);
    const values = approvalValues(token);
    if (!match || !values) return [token];
    const remaining = match[3]
      .split(",")
      .filter((value) => unquote(value).trim().toLowerCase() !== "approved");
    return remaining.length
      ? [`${match[1]}${match[2]}:${remaining.join(",")}`]
      : [];
  });
  if (approval === "approved") retained.push("is:approved");
  if (approval === "not-approved") retained.push("-is:approved");
  return retained.join(" ");
}

export type Context = {
  attachments: Map<string, Attachment>;
  columns: Column[];
  byId: Map<string, RecordFile>;
  // Every direct child, including archived and filtered-out records.
  children: Map<string, RecordFile[]>;
  claimed: Set<string>;
  hasChildren: Set<string>;
};
export function context(state: ProjectState): Context {
  const byId = new Map(state.records.map((r) => [r.meta.id, r]));
  const children = new Map<string, RecordFile[]>();
  for (const record of state.records)
    if (record.meta.kind === "ticket" && record.meta.parent) {
      const direct = children.get(record.meta.parent) ?? [];
      direct.push(record);
      children.set(record.meta.parent, direct);
    }
  const now = new Date().toISOString();
  return {
    attachments: new Map(state.attachments.map((a) => [a.id, a])),
    columns: state.config.columns,
    byId,
    children,
    claimed: new Set(
      state.claims.filter((c) => c.expiresAt > now).map((c) => c.ticket),
    ),
    hasChildren: new Set(
      state.records.map((r) => r.meta.parent).filter(Boolean) as string[],
    ),
  };
}
const roleOf = (r: RecordFile, ctx: Context) =>
  ctx.columns.find((c) => c.id === r.meta.status)?.role;

function termMatches(r: RecordFile, key: string, value: string, ctx: Context) {
  const m = r.meta;
  switch (key) {
    case "status": {
      const column = ctx.columns.find((c) => c.id === m.status);
      return (
        m.status.toLowerCase() === value ||
        column?.name.toLowerCase() === value ||
        column?.role === value
      );
    }
    case "label":
      return (m.labels ?? []).some((l) => l.toLowerCase() === value);
    case "owner":
      return (m.owner ?? "").toLowerCase() === value;
    case "priority":
      return (
        priorityName(r).toLowerCase() === value ||
        String(priorityOf(r)) === value
      );
    case "parent": {
      const parent = m.parent ? ctx.byId.get(m.parent) : undefined;
      if (!parent) return false;
      const n = value.replace(/^#/, "");
      return (
        parent.meta.id.toLowerCase() === value ||
        String(parent.meta.number) === n ||
        parent.meta.title.toLowerCase().includes(value)
      );
    }
    case "is":
      if (value === "blocked") return !!m.blocked?.trim();
      if (value === "claimed") return ctx.claimed.has(m.id);
      if (value === "approved") return !!m.scopeApproved;
      if (value === "open") return roleOf(r, ctx) !== "done";
      if (value === "closed" || value === "done")
        return roleOf(r, ctx) === "done";
      if (value === "parent") return ctx.hasChildren.has(m.id);
      if (value === "archived") return !!m.archived;
      return false;
    case "has":
    case "no": {
      const present =
        value === "label" || value === "labels"
          ? !!m.labels?.length
          : value === "owner"
            ? !!m.owner?.trim()
            : value === "parent"
              ? !!m.parent
              : value === "attachment" || value === "attachments"
                ? !!m.attachments?.length
                : false;
      return key === "has" ? present : !present;
    }
  }
  return false;
}

// Archived tickets stay out of a view unless it asks for them with
// `is:archived`; the term itself then keeps everything else out.
export const showsArchived = (filter: Filter) =>
  filter.terms.some(
    (t) => t.key === "is" && !t.negate && t.values.includes("archived"),
  );

export function matches(r: RecordFile, filter: Filter, ctx: Context) {
  const haystack =
    `${r.meta.title} ${r.body} ${r.meta.id} #${r.meta.number} ${(r.meta.labels ?? []).join(" ")} ${r.meta.owner ?? ""}`.toLowerCase();
  if (!filter.text.every((t) => haystack.includes(t))) return false;
  return filter.terms.every((term) => {
    const any = term.values.some((v) => termMatches(r, term.key, v, ctx));
    return term.negate ? !any : any;
  });
}

// ------------------------------------------------------------ sort and group

const orderOf = (r: RecordFile) => r.meta.order ?? Date.parse(r.meta.createdAt);
export function sortTickets(list: RecordFile[], sort: SortBy) {
  const byOrder = (a: RecordFile, b: RecordFile) => orderOf(a) - orderOf(b);
  const compare: Record<SortBy, (a: RecordFile, b: RecordFile) => number> = {
    manual: byOrder,
    priority: (a, b) => priorityOf(a) - priorityOf(b) || byOrder(a, b),
    number: (a, b) => (a.meta.number ?? 0) - (b.meta.number ?? 0),
    updated: (a, b) => b.meta.updatedAt.localeCompare(a.meta.updatedAt),
    title: (a, b) => a.meta.title.localeCompare(b.meta.title),
  };
  return [...list].sort(compare[sort]);
}

export type Group = {
  key: string;
  title: string;
  // The goal ticket itself when grouping by parent.
  record?: RecordFile;
  items: RecordFile[];
  // Values new tickets created in this group should receive.
  defaults: {
    parent?: string | null;
    priority?: number;
    owner?: string;
    labels?: string[];
    status?: string;
  };
};

// The top-level goal a ticket belongs to: its root ancestor, or itself when
// it has children of its own.
export function rootGoal(r: RecordFile, ctx: Context): string | null {
  let current = r;
  const seen = new Set<string>();
  while (current.meta.parent && !seen.has(current.meta.id)) {
    seen.add(current.meta.id);
    const parent = ctx.byId.get(current.meta.parent);
    if (!parent) break;
    current = parent;
  }
  if (current.meta.id !== r.meta.id) return current.meta.id;
  return ctx.hasChildren.has(r.meta.id) ? r.meta.id : null;
}

// Depth-first so child tickets follow their parent within a column.
function nestChildren(items: RecordFile[]) {
  const ids = new Set(items.map((r) => r.meta.id));
  const result: RecordFile[] = [],
    seen = new Set<string>();
  const visit = (r: RecordFile) => {
    if (seen.has(r.meta.id)) return;
    seen.add(r.meta.id);
    result.push(r);
    items.filter((c) => c.meta.parent === r.meta.id).forEach(visit);
  };
  items.filter((r) => !r.meta.parent || !ids.has(r.meta.parent)).forEach(visit);
  items.forEach(visit);
  return result;
}

export function groupTickets(
  list: RecordFile[],
  groupBy: GroupBy,
  ctx: Context,
): Group[] {
  if (groupBy === "none")
    return [{ key: "all", title: "All tickets", items: list, defaults: {} }];
  const groups = new Map<string, Group>();
  const add = (
    key: string,
    make: () => Omit<Group, "items">,
    r: RecordFile,
  ) => {
    if (!groups.has(key)) groups.set(key, { ...make(), items: [] });
    groups.get(key)!.items.push(r);
  };
  for (const r of list) {
    if (groupBy === "parent") {
      const goal = rootGoal(r, ctx);
      // The goal itself heads its group rather than appearing inside it.
      if (goal === r.meta.id) {
        if (!groups.has(goal))
          groups.set(goal, {
            key: goal,
            title: r.meta.title,
            record: r,
            items: [],
            defaults: { parent: goal },
          });
        continue;
      }
      if (goal) {
        const record = ctx.byId.get(goal)!;
        add(
          goal,
          () => ({
            key: goal,
            title: record.meta.title,
            record,
            defaults: { parent: goal },
          }),
          r,
        );
      } else
        add(
          "none",
          () => ({
            key: "none",
            title: "No parent goal",
            defaults: { parent: null },
          }),
          r,
        );
    } else if (groupBy === "status") {
      const column = ctx.columns.find((c) => c.id === r.meta.status);
      add(
        r.meta.status,
        () => ({
          key: r.meta.status,
          title: column?.name ?? r.meta.status,
          defaults: { status: r.meta.status },
        }),
        r,
      );
    } else if (groupBy === "priority") {
      const p = priorityOf(r);
      add(
        `p${p}`,
        () => ({
          key: `p${p}`,
          title: priorities[p] ?? "Normal",
          defaults: { priority: p },
        }),
        r,
      );
    } else if (groupBy === "owner") {
      const owner = r.meta.owner?.trim();
      add(
        owner ? `owner:${owner}` : "none",
        () =>
          owner
            ? { key: `owner:${owner}`, title: owner, defaults: { owner } }
            : { key: "none", title: "No owner", defaults: {} },
        r,
      );
    } else {
      const labels = r.meta.labels?.length ? r.meta.labels : [null];
      for (const label of labels)
        add(
          label ? `label:${label}` : "none",
          () =>
            label
              ? {
                  key: `label:${label}`,
                  title: label,
                  defaults: { labels: [label] },
                }
              : { key: "none", title: "No labels", defaults: {} },
          r,
        );
    }
  }
  const result = [...groups.values()];
  if (groupBy === "parent") {
    for (const g of result) g.items = nestChildren(g.items);
    if (!groups.has("none"))
      result.push({
        key: "none",
        title: "No parent goal",
        items: [],
        defaults: { parent: null },
      });
  }
  // Stable, meaningful group order; "none" groups always last.
  const rank = (g: Group) =>
    g.key === "none"
      ? Infinity
      : groupBy === "status"
        ? ctx.columns.findIndex((c) => c.id === g.key)
        : groupBy === "priority"
          ? Number(g.key.slice(1))
          : groupBy === "parent"
            ? (g.record?.meta.number ?? 0)
            : 0;
  return result.sort(
    (a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title),
  );
}

// ------------------------------------------------------------ attention

// True when guidance already linked to this ticket changed. Broadly-scoped new
// rules remain visible in context without turning every open ticket into an
// alert; submitting review links the applicable revisions for future changes.
export function ruleChanged(
  ticket: RecordFile,
  state: ProjectState,
  ctx: Context,
) {
  const reviewed = ticket.meta.reviewedRules ?? {};
  if (
    Object.entries(reviewed).some(
      ([id, revision]) => ctx.byId.get(id)?.revision !== revision,
    )
  )
    return true;
  const active = state.records.filter(
    (r) => r.meta.kind === "rule" && r.meta.status === "active",
  );
  const replaced = new Set(
    active.map((r) => r.meta.supersedes).filter(Boolean),
  );
  const linked = new Set([
    ...Object.keys(reviewed),
    ...(ticket.meta.rules ?? []),
  ]);
  const followsLinkedRule = (rule: RecordFile) => {
    const seen = new Set<string>();
    let current: RecordFile | undefined = rule;
    while (current && !seen.has(current.meta.id)) {
      if (linked.has(current.meta.id)) return true;
      seen.add(current.meta.id);
      current = current.meta.supersedes
        ? ctx.byId.get(current.meta.supersedes)
        : undefined;
    }
    return false;
  };
  return active.some(
    (rule) =>
      !replaced.has(rule.meta.id) &&
      followsLinkedRule(rule) &&
      reviewed[rule.meta.id] !== rule.revision,
  );
}

export type AttentionReason = "blocked" | "review" | "question" | "rules";
export function attentionReason(
  r: RecordFile,
  state: ProjectState,
  ctx: Context,
): AttentionReason | null {
  const role = roleOf(r, ctx);
  // Completion ends active attention; retain historical blockers/questions
  // on the record, so reopening work can surface them again.
  if (role === "done" || r.meta.archived) return null;
  if (r.meta.blocked?.trim()) return "blocked";
  if (role === "review") return "review";
  if (
    state.comments.some(
      (c) =>
        c.ticket === r.meta.id &&
        c.kind === "question" &&
        (!c.resolved || state.managedQuestions?.[c.id]?.canAct),
    )
  )
    return "question";
  if (ruleChanged(r, state, ctx)) return "rules";
  return null;
}
