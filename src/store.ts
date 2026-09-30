import {
  questionsSchema,
  questionText,
  choiceAnswersSchema,
} from "./questionnaire.js";
import type { AgentReviewReceipt, Assignment } from "./orchestration-types.js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import YAML from "yaml";
import { z } from "zod";
import { decisionProtocol } from "./decision-protocol.js";
import {
  atomic,
  branch,
  canonicalProject,
  dataDirectory,
  hash,
  markdown,
  mkdir,
  now,
  parseMd,
  patchMd,
  Problem,
  read,
  safe,
  uid,
  walk,
} from "./files.js";
import type {
  Actor,
  Attachment,
  Claim,
  Column,
  Config,
  Kind,
  Meta,
  ProjectState,
  RecordFile,
  Comment,
  Verification,
  MergeConflictField,
  MergeResolution,
} from "./types.js";

const actorSchema = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(["human", "agent"]),
});
const strings = z.array(z.string().max(1000));
const viewSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/),
  name: z.string().trim().min(1).max(60),
  layout: z.enum(["board", "table"]),
  filter: z.string().max(500),
  groupBy: z.enum(["none", "parent", "status", "priority", "owner", "label"]),
  sort: z.enum(["manual", "priority", "number", "updated", "title"]),
});
const configSchema = z
  .object({
    schema: z.literal(1),
    projectId: z.string().regex(/^project-[a-f0-9]+$/),
    name: z.string().trim().min(1).max(200),
    columns: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9_-]+$/),
          name: z.string().trim().min(1).max(80),
          role: z.enum(["backlog", "selected", "progress", "review", "done"]),
        }),
      )
      .min(5)
      .max(20),
    views: z.array(viewSchema).min(1).max(30).optional(),
    shortcut: z.object({
      mode: z.enum(["double-alt", "hotkey"]).optional(),
      key: z.number().int().min(0).max(127),
      modifiers: z.number().int().min(0).max(65535),
      label: z.string(),
    }),
  })
  .passthrough();
const metaSchema = z
  .object({
    schema: z.literal(1),
    id: z.string().regex(/^[A-Za-z0-9_-]+$/),
    kind: z.enum(["ticket", "decision", "rule"]),
    number: z.number().int().nonnegative().optional(),
    title: z.string().trim().min(1).max(300),
    status: z.string().min(1),
    author: actorSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
    parent: z.string().nullable().optional(),
    labels: strings.optional(),
    priority: z.number().finite().optional(),
    order: z.number().finite().optional(),
    owner: z.string().optional(),
    scopeApproved: z.boolean().optional(),
    scopeApprovedAt: z.string().datetime().optional(),
    scopeApprovedBy: actorSchema.optional(),
    blocked: z.string().optional(),
    dependencies: strings.optional(),
    related: strings.optional(),
    duplicateOf: z.string().optional(),
    mergedFrom: strings.optional(),
    duplicateMerge: z
      .object({
        requestId: z.string(),
        fingerprint: z.string(),
        survivor: z.string(),
        source: z.string(),
        at: z.string(),
        actor: actorSchema,
        resolutions: z.partialRecord(
          z.enum([
            "parent",
            "status",
            "owner",
            "priority",
            "acceptanceCriteria",
          ]),
          z.enum(["survivor", "source", "both"]),
        ),
        affected: strings,
      })
      .optional(),
    decisions: strings.optional(),
    rules: strings.optional(),
    attachments: strings.optional(),
    handoff: z.string().optional(),
    evidence: z.string().optional(),
    reviewInstructions: z.string().max(10000).optional(),
    manualReviewRequired: z.boolean().optional(),
    humanReviewRequired: z.boolean().optional(),
    reviewVerificationAt: z.string().optional(),
    question: z.string().optional(),
    progressStartedAt: z.string().datetime().optional(),
    progress: z
      .object({
        note: z.string().trim().min(1).max(5000),
        percent: z.number().min(0).max(100).optional(),
        at: z.string().datetime(),
        actor: actorSchema,
      })
      .optional(),
    exceptions: z.string().optional(),
    scope: strings.optional(),
    strength: z.enum(["required", "recommended"]).optional(),
    category: z.string().optional(),
    supersedes: z.string().optional(),
    references: strings.optional(),
    worktree: z.string().optional(),
    branch: z.string().max(300).optional(),
    pr: z.string().max(500).optional(),
    commits: strings.optional(),
    verification: z
      .object({
        command: z.string().max(2000),
        exitCode: z.number().int(),
        output: z.string().max(20000),
        at: z.string(),
        cwd: z.string().optional(),
      })
      .optional(),
    reviewedRules: z.record(z.string(), z.string()).optional(),
    archived: z.boolean().optional(),
  })
  .passthrough();
export const defaultColumns: Column[] = [
  { id: "backlog", name: "Backlog", role: "backlog" },
  { id: "selected", name: "Selected For Development", role: "selected" },
  { id: "progress", name: "In Progress", role: "progress" },
  { id: "review", name: "Review", role: "review" },
  { id: "done", name: "Done", role: "done" },
];
const folder = { ticket: "tickets", decision: "decisions", rule: "rules" };
export class Store {
  root: string;
  dir: string;
  private queue: Promise<unknown> = Promise.resolve();
  // Parsed files keyed by path, validated against the file's stat on every
  // read, so the disk stays authoritative while unchanged files cost nothing.
  private cache = new Map<
    string,
    { key: string; value: RecordFile | Comment | Attachment }
  >();
  private cached<T extends RecordFile | Comment | Attachment>(
    file: string,
    parse: (text: string) => T,
  ): T {
    const st = fs.statSync(file);
    const key = `${st.mtimeMs}:${st.size}:${st.ino}`;
    const hit = this.cache.get(file);
    if (hit && hit.key === key) return hit.value as T;
    const value = parse(read(file));
    this.cache.set(file, { key, value });
    return value;
  }
  constructor(project: string, exact = false) {
    this.root = canonicalProject(project, !exact);
    this.dir = dataDirectory(this.root);
  }
  initialize(name = path.basename(this.root)) {
    mkdir(this.dir);
    for (const d of [
      "records/tickets",
      "records/decisions",
      "records/rules",
      "records/comments",
      "records/history",
      "records/attachments",
      "staging",
      "assets",
      ".local",
    ])
      mkdir(safe(this.dir, d));
    this.recoverRecordTransaction();
    if (!fs.existsSync(this.file("config.yml")))
      atomic(
        this.file("config.yml"),
        YAML.stringify({
          schema: 1,
          projectId: uid("project"),
          name,
          columns: defaultColumns,
          shortcut: {
            mode: "double-alt",
            key: 1,
            modifiers: 6400,
            label: "Double-tap Option / Alt",
          },
        }),
      );
    if (!fs.existsSync(this.file(".gitignore")))
      atomic(this.file(".gitignore"), "assets/\n.local/\n*.tmp\n");
    if (!fs.existsSync(this.file("README.md")))
      atomic(
        this.file("README.md"),
        "# Project records\n\nMarkdown and annotation JSON are authoritative. Images live in the ignored assets directory. Use Control Room's export to back up both. All Git worktrees connect to this main checkout. Use the CLI for coordinated edits. Direct edits are detected but cannot participate in application locking.\n",
      );
    if (!fs.existsSync(this.file(".local/branch.json")))
      atomic(
        this.file(".local/branch.json"),
        JSON.stringify({ branch: branch(this.root) }),
      );
    if (!fs.existsSync(this.file(".local/token")))
      atomic(
        this.file(".local/token"),
        crypto.randomBytes(32).toString("hex"),
        0o600,
      );
    return this;
  }
  file(relative: string) {
    return safe(this.dir, relative);
  }
  config(): Config {
    const c = configSchema.parse(YAML.parse(read(this.file("config.yml"))));
    if (
      new Set(c.columns.map((v) => v.id)).size !== c.columns.length ||
      ["backlog", "selected", "progress", "review", "done"].some(
        (role) => !c.columns.some((col) => col.role === role),
      )
    )
      throw new Problem(
        422,
        "Configuration requires unique columns and each workflow role",
      );
    return c as Config;
  }
  token() {
    return read(this.file(".local/token")).trim();
  }
  branchState() {
    const current = branch(this.root);
    const acknowledged = JSON.parse(
      read(this.file(".local/branch.json")),
    ).branch;
    return {
      branch: current,
      acknowledgedBranch: acknowledged,
      branchChanged: current !== acknowledged,
    };
  }
  async write<T>(
    fn: () => T | Promise<T>,
    allowBranchChange = false,
  ): Promise<T> {
    const run = this.queue.then(async () => {
      if (!allowBranchChange && this.branchState().branchChanged)
        throw new Problem(
          409,
          "Canonical checkout changed branches. Review the files and reconcile in Settings before writing.",
        );
      this.recoverRecordTransaction();
      return fn();
    });
    this.queue = run.catch(() => {});
    return run;
  }
  load(relative: string): RecordFile {
    return this.cached(this.file(relative), (text) => {
      const { meta, body } = parseMd(text);
      const m = metaSchema.parse(meta) as Meta;
      if (path.basename(relative, ".md") !== m.id)
        throw new Problem(422, "Record ID must match its filename");
      if (!relative.startsWith(`records/${folder[m.kind]}/`))
        throw new Problem(422, "Record kind does not match its folder");
      return { meta: m, body, revision: hash(text), path: relative };
    });
  }
  private loadComment(file: string): Comment {
    return this.cached(file, (text) => {
      const p = parseMd(text);
      actorSchema.parse(p.meta.actor);
      if (p.meta.questions)
        p.meta.questions = questionsSchema.parse(p.meta.questions);
      return { ...p.meta, body: p.body, revision: hash(text) } as Comment;
    });
  }
  get(id: string): RecordFile {
    if (/^#?\d+$/.test(id)) {
      const numbered = this.list().find(
        (r) =>
          r.meta.kind === "ticket" &&
          r.meta.number === Number(id.replace("#", "")),
      );
      if (numbered) return numbered;
    }
    if (!/^[A-Za-z0-9_-]+$/.test(id))
      throw new Problem(400, "Invalid record ID");
    for (const dir of Object.values(folder)) {
      const p = `records/${dir}/${id}.md`;
      if (fs.existsSync(this.file(p))) return this.load(p);
    }
    throw new Problem(404, `Record ${id} not found`);
  }
  list(): RecordFile[] {
    return Object.values(folder).flatMap((d) =>
      walk(this.file(`records/${d}`), ".md")
        .map((f) => {
          try {
            return this.load(path.relative(this.dir, f));
          } catch {
            return null;
          }
        })
        .filter((v): v is RecordFile => !!v),
    );
  }
  comments(): Comment[] {
    return walk(this.file("records/comments"), ".md")
      .map((f) => this.loadComment(f))
      .sort((a, b) => a.at.localeCompare(b.at));
  }
  attachments(): Attachment[] {
    return walk(this.file("records/attachments"), ".json").map((f) =>
      this.attachment(path.basename(f, ".json")),
    );
  }
  attachment(id: string): Attachment {
    const a = this.cached(
      this.file(`records/attachments/${id}.json`),
      (text) => ({ ...JSON.parse(text), revision: hash(text) }) as Attachment,
    );
    return {
      ...a,
      missing: !fs.existsSync(this.file(`assets/${id}/base.png`)),
    };
  }
  private attachmentReference(id: string): Attachment {
    if (/^image-[\w-]+$/.test(id)) {
      const file = this.file(`records/attachments/${id}.json`);
      if (fs.existsSync(file)) return this.attachment(id);
    }
    return {
      id,
      name: "Screenshot reference unavailable",
      hash: "",
      width: 0,
      height: 0,
      mime: "image/png",
      annotations: [],
      revision: "",
      missing: true,
      referenceMissing: true,
      createdAt: "",
    };
  }
  claims(): Claim[] {
    const p = this.file(".local/claims.json");
    return fs.existsSync(p) ? JSON.parse(read(p)) : [];
  }
  state(): ProjectState {
    const errors: { path: string; message: string }[] = [];
    const records: RecordFile[] = [];
    for (const d of Object.values(folder))
      for (const f of walk(this.file(`records/${d}`), ".md")) {
        try {
          records.push(this.load(path.relative(this.dir, f)));
        } catch (e) {
          errors.push({ path: path.relative(this.dir, f), message: String(e) });
        }
      }
    const comments: Comment[] = [];
    for (const f of walk(this.file("records/comments"), ".md")) {
      try {
        comments.push(this.loadComment(f));
      } catch (e) {
        errors.push({ path: path.relative(this.dir, f), message: String(e) });
      }
    }
    const attachments: Attachment[] = [];
    for (const f of walk(this.file("records/attachments"), ".json")) {
      try {
        attachments.push(this.attachment(path.basename(f, ".json")));
      } catch (e) {
        errors.push({ path: path.relative(this.dir, f), message: String(e) });
      }
    }
    const state = {
      config: this.config(),
      configRevision: hash(read(this.file("config.yml"))),
      records,
      comments,
      attachments,
      claims: this.claims(),
      errors,
      canonical: this.root,
      ...this.branchState(),
    };
    // Every part already carries a content hash, so the state revision is a
    // hash of hashes rather than of the serialized state.
    const revision = hash(
      [
        state.configRevision,
        ...records.map((r) => r.path + r.revision),
        ...comments.map((c) => c.id + c.revision),
        ...attachments.map((a) => a.id + a.revision + (a.missing ? "!" : "")),
        JSON.stringify(state.claims),
        JSON.stringify(errors),
        state.branch,
        state.acknowledgedBranch,
      ].join("\n"),
    );
    return { ...state, revision };
  }
  private validate(meta: Meta, records = this.list()) {
    metaSchema.parse(meta);
    if (meta.kind === "ticket") {
      if (!this.config().columns.some((c) => c.id === meta.status))
        throw new Problem(422, "Unknown ticket status");
      const seen = new Set([meta.id]);
      let p = meta.parent;
      while (p) {
        if (seen.has(p))
          throw new Problem(422, "Parent tickets cannot form a cycle");
        seen.add(p);
        const parent = records.find((r) => r.meta.id === p);
        if (!parent || parent.meta.kind !== "ticket")
          throw new Problem(422, "Parent ticket does not exist");
        p = parent.meta.parent;
      }
      for (const id of meta.dependencies ?? [])
        if (
          id === meta.id ||
          !records.some((r) => r.meta.id === id && r.meta.kind === "ticket")
        )
          throw new Problem(422, `Invalid dependency: ${id}`);
      for (const id of meta.related ?? [])
        if (
          id === meta.id ||
          !records.some((r) => r.meta.id === id && r.meta.kind === "ticket")
        )
          throw new Problem(422, `Invalid related ticket: ${id}`);
      if (
        meta.duplicateOf &&
        (meta.duplicateOf === meta.id ||
          !records.some(
            (r) => r.meta.id === meta.duplicateOf && r.meta.kind === "ticket",
          ))
      )
        throw new Problem(
          422,
          `Invalid duplicate survivor: ${meta.duplicateOf}`,
        );
      for (const id of meta.mergedFrom ?? [])
        if (
          id === meta.id ||
          !records.some((r) => r.meta.id === id && r.meta.kind === "ticket")
        )
          throw new Problem(422, `Invalid merged source: ${id}`);
    } else if (
      !(
        meta.kind === "decision"
          ? ["proposed", "accepted", "rejected", "superseded"]
          : ["proposed", "active", "deprecated"]
      ).includes(meta.status)
    )
      throw new Problem(422, "Unknown lifecycle status");
    if (meta.supersedes) {
      const seen = new Set([meta.id]);
      let p: string | undefined = meta.supersedes;
      while (p) {
        if (seen.has(p))
          throw new Problem(422, "Predecessors cannot form a cycle");
        seen.add(p);
        const old = records.find((r) => r.meta.id === p);
        if (!old || old.meta.kind !== meta.kind)
          throw new Problem(422, "Invalid predecessor");
        p = old.meta.supersedes;
      }
    }
    for (const id of meta.rules ?? [])
      if (!records.some((r) => r.meta.id === id && r.meta.kind === "rule"))
        throw new Problem(422, `Unknown rule ${id}`);
    for (const id of meta.decisions ?? [])
      if (!records.some((r) => r.meta.id === id && r.meta.kind === "decision"))
        throw new Problem(422, `Unknown decision ${id}`);
  }
  // Normalize only supplied link fields so unrelated Markdown stays untouched.
  // Store canonical IDs, even when callers use the public ticket number.
  private ticketLinks(input: Record<string, unknown>) {
    const patch = { ...input };
    const resolve = (value: unknown, field: string): string => {
      if (
        typeof value !== "string" &&
        !(
          typeof value === "number" &&
          Number.isSafeInteger(value) &&
          value >= 0
        )
      )
        throw new Problem(
          422,
          "Ticket references must be IDs or nonnegative ticket numbers",
        );
      let record: RecordFile;
      try {
        record = this.get(String(value));
      } catch {
        throw new Problem(422, `Invalid ${field}: ${String(value)}`);
      }
      if (record.meta.kind !== "ticket")
        throw new Problem(422, "Link must refer to a ticket");
      return record.meta.id;
    };
    if (patch.parent !== undefined && patch.parent !== null)
      patch.parent = resolve(patch.parent, "parent");
    if (patch.dependencies !== undefined) {
      if (!Array.isArray(patch.dependencies))
        throw new Problem(422, "Dependencies must be a list");
      patch.dependencies = patch.dependencies.map((value) =>
        resolve(value, "dependency"),
      );
    }
    if (patch.related !== undefined) {
      if (!Array.isArray(patch.related))
        throw new Problem(422, "Related tickets must be a list");
      patch.related = [
        ...new Set(
          patch.related.map((value) => resolve(value, "related ticket")),
        ),
      ];
    }
    return patch;
  }

  private recoverRecordTransaction() {
    const journal = this.file(".local/record-transaction.json");
    if (!fs.existsSync(journal)) return;
    if (this.branchState().branchChanged)
      throw new Problem(
        409,
        "Reconcile the canonical branch before recovering a record transaction",
      );
    const tx = z
      .object({
        files: z
          .array(
            z.object({
              path: z
                .string()
                .regex(
                  /^records\/(?:tickets\/[A-Za-z0-9_-]+\.md|history\.jsonl)$/,
                ),
              before: z.string(),
              after: z.string(),
            }),
          )
          .min(1),
      })
      .parse(JSON.parse(read(journal)));
    const states = tx.files.map((entry) => {
      const current = fs.existsSync(this.file(entry.path))
        ? read(this.file(entry.path))
        : "";
      return current === entry.after
        ? "after"
        : current === entry.before
          ? "before"
          : "unknown";
    });
    if (states.every((state) => state === "after")) {
      fs.unlinkSync(journal);
      return;
    }
    if (states.some((state) => state === "unknown"))
      throw new Problem(
        409,
        "A record transaction was interrupted and a file changed independently. Inspect .controlroom/.local/record-transaction.json before continuing.",
      );
    for (const entry of tx.files) atomic(this.file(entry.path), entry.before);
    fs.unlinkSync(journal);
  }

  private recordText(old: RecordFile, meta: Meta, body = old.body) {
    const parsed = parseMd(read(this.file(old.path)));
    for (const key of Object.keys(parsed.meta))
      if (!(key in meta)) parsed.doc.delete(key);
    for (const [key, value] of Object.entries(meta)) parsed.doc.set(key, value);
    return `---\n${parsed.doc.toString()}---\n${body}`;
  }

  private commitRecordTransaction(
    changes: { old: RecordFile; meta: Meta; body?: string; action: string }[],
    actor: Actor,
  ) {
    const current = this.list();
    const replacements = new Map(
      changes.map((change) => [change.old.meta.id, change.meta]),
    );
    const planned = current.map((record) => ({
      ...record,
      meta: replacements.get(record.meta.id) ?? record.meta,
    }));
    for (const change of changes) {
      if (this.get(change.old.meta.id).revision !== change.old.revision)
        throw new Problem(
          409,
          "An affected ticket changed. Reload the preview and retry.",
          {
            current: this.get(change.old.meta.id),
          },
        );
      const assignment = change.old.meta.assignment;
      if (
        actor.kind === "agent" &&
        assignment &&
        assignment.state !== "released" &&
        assignment.worker !== actor.name
      )
        throw new Problem(
          409,
          `Assigned to ${assignment.worker}; request reassignment instead of overwriting their work`,
        );
      if (
        actor.kind === "agent" &&
        this.claims().some(
          (claim) =>
            claim.ticket === change.old.meta.id &&
            claim.expiresAt > now() &&
            claim.actor.name !== actor.name,
        )
      )
        throw new Problem(
          409,
          "An affected ticket has another agent's live claim",
        );
      this.validate(change.meta, planned);
      // A redirected dependency must not introduce an indirect cycle.
      const visit = (id: string, seen: Set<string>) => {
        if (id === change.meta.id)
          throw new Problem(
            422,
            "Dependencies cannot form a cycle after merging",
          );
        if (seen.has(id)) return;
        seen.add(id);
        for (const dependency of planned.find((record) => record.meta.id === id)
          ?.meta.dependencies ?? [])
          visit(dependency, seen);
      };
      for (const id of change.meta.dependencies ?? []) visit(id, new Set());
      this.authority(actor, change.meta, change.old);
      if (
        actor.kind === "agent" &&
        ["selected", "progress", "review"].includes(
          this.config().columns.find(
            (column) => column.id === change.meta.status,
          )?.role ?? "",
        )
      ) {
        let candidate: Meta | undefined = change.meta;
        const scopeSeen = new Set<string>();
        while (
          candidate &&
          !candidate.scopeApproved &&
          !scopeSeen.has(candidate.id)
        ) {
          scopeSeen.add(candidate.id);
          candidate = planned.find(
            (record) => record.meta.id === candidate!.parent,
          )?.meta;
        }
        if (!candidate?.scopeApproved)
          throw new Problem(
            403,
            "Merge would leave active work outside approved scope",
          );
      }
    }
    const files = changes.map((change) => {
      const before = read(this.file(change.old.path));
      return {
        path: change.old.path,
        before,
        after: this.recordText(change.old, change.meta, change.body),
      };
    });
    // Audit entries participate in the same recoverable transaction. A crash
    // must not leave committed relationships without their attribution.
    const historyPath = "records/history.jsonl";
    const historyBefore = fs.existsSync(this.file(historyPath))
      ? read(this.file(historyPath))
      : "";
    const events =
      changes
        .map((change) =>
          JSON.stringify({
            id: uid("event"),
            record: change.old.meta.id,
            actor,
            action: change.action,
            at: now(),
            before: { meta: change.old.meta, body: change.old.body },
            after: { meta: change.meta, body: change.body ?? change.old.body },
          }),
        )
        .join("\n") + "\n";
    files.push({
      path: historyPath,
      before: historyBefore,
      after: historyBefore + events,
    });
    const journal = this.file(".local/record-transaction.json");
    atomic(journal, JSON.stringify({ schema: 1, at: now(), files }, null, 2));
    const written: typeof files = [];
    try {
      for (const file of files) {
        atomic(this.file(file.path), file.after);
        written.push(file);
      }
      fs.unlinkSync(journal);
    } catch (error) {
      const recoveryErrors: string[] = [];
      for (const file of written.reverse())
        try {
          atomic(this.file(file.path), file.before);
        } catch (rollback) {
          recoveryErrors.push(`${file.path}: ${String(rollback)}`);
        }
      if (!recoveryErrors.length && fs.existsSync(journal))
        fs.unlinkSync(journal);
      throw new Problem(
        500,
        recoveryErrors.length
          ? "The transaction partially failed and automatic recovery was incomplete. Stop editing and inspect the recovery details."
          : "The transaction failed; all written records were restored and no merge was retained.",
        { cause: String(error), recoveryErrors },
      );
    }
    return changes.map((change) => this.get(change.old.meta.id));
  }
  scope(record: RecordFile): RecordFile | undefined {
    const seen = new Set<string>();
    let r: RecordFile | undefined = record;
    while (r && !seen.has(r.meta.id)) {
      seen.add(r.meta.id);
      if (r.meta.scopeApproved) return r;
      r = r.meta.parent ? this.get(r.meta.parent) : undefined;
    }
    return undefined;
  }
  private authority(
    actor: Actor,
    next: Meta,
    old?: RecordFile,
    managed = false,
  ) {
    actorSchema.parse(actor);
    if (actor.kind !== "agent" || next.kind !== "ticket") return;
    if (
      (next.scopeApproved !== old?.meta.scopeApproved && next.scopeApproved) ||
      ["scopeApprovedAt", "scopeApprovedBy"].some(
        (key) => JSON.stringify(next[key]) !== JSON.stringify(old?.meta[key]),
      )
    )
      throw new Problem(403, "Only a human can approve task scope");
    const role = this.config().columns.find((c) => c.id === next.status)?.role;
    if (!managed && role === "done" && old?.meta.status !== next.status)
      throw new Problem(
        403,
        "Agents submit work to Review; a human accepts Done",
      );
    if (
      ["selected", "progress", "review"].includes(role ?? "") &&
      !this.scope({ meta: next, body: "", revision: "", path: "" })
    )
      throw new Problem(
        403,
        "Agent work requires an approved parent scope or an explicitly approved ticket",
      );
  }
  // Appended to one JSON Lines file, so a busy board does not scatter
  // thousands of event files through Git. Older per-event files still load.
  private history(
    id: string,
    actor: Actor,
    action: string,
    before: unknown,
    after: unknown,
  ) {
    const line = JSON.stringify({
      id: uid("event"),
      record: id,
      actor,
      action,
      at: now(),
      before,
      after,
    });
    fs.appendFileSync(this.file("records/history.jsonl"), line + "\n");
  }
  // Called only inside the service's serialized writer. The counter travels in backups and Git.
  reserveTicketNumber(): number {
    const file = this.file("records/ticket-sequence.json");
    const stored = fs.existsSync(file) ? JSON.parse(read(file)).next : 0;
    if (!Number.isSafeInteger(stored) || stored < 0)
      throw new Problem(422, "Invalid ticket sequence");
    const next = Math.max(
      stored,
      ...this.list()
        .filter((r) => r.meta.kind === "ticket")
        .map((r) => (r.meta.number ?? -1) + 1),
    );
    atomic(file, JSON.stringify({ next: next + 1 }));
    return next;
  }
  migrateTicketNumbers() {
    return this.write(() => {
      const records = this.list()
        .filter((r) => r.meta.kind === "ticket")
        .sort(
          (a, b) =>
            a.meta.createdAt.localeCompare(b.meta.createdAt) ||
            a.meta.id.localeCompare(b.meta.id),
        );
      for (const r of records)
        if (r.meta.number === undefined) {
          atomic(
            this.file(r.path),
            patchMd(read(this.file(r.path)), {
              number: this.reserveTicketNumber(),
            }),
          );
        }
    });
  }
  private createNow(
    kind: Kind,
    input: Record<string, unknown>,
    body: string,
    actor: Actor,
  ): RecordFile {
    if (input.assignment || input.agentReview)
      throw new Problem(
        403,
        "Managed assignments and review receipts are service-owned",
      );
    if (
      kind === "ticket" &&
      ["related", "duplicateOf", "mergedFrom", "duplicateMerge"].some(
        (key) => key in input,
      )
    )
      throw new Problem(
        422,
        "Create ticket relationships through the relationship and merge actions",
      );
    if (actor.kind === "agent" && input.humanReviewRequired)
      throw new Problem(403, "Human review policy is set by a human");
    if (!["ticket", "decision", "rule"].includes(kind))
      throw new Problem(400, "Unknown record type");
    const stamp = now(),
      id = uid(kind === "ticket" ? "WB" : kind === "decision" ? "DEC" : "UI");
    const meta = {
      ...(kind === "ticket" ? this.ticketLinks(input) : input),
      schema: 1,
      id,
      kind,
      title: input.title,
      status:
        input.status ??
        (kind === "ticket"
          ? this.config().columns.find((c) => c.role === "backlog")!.id
          : "proposed"),
      createdAt: stamp,
      updatedAt: stamp,
      author: actor,
    } as Meta;
    if (kind === "ticket" && meta.progress)
      meta.progress = { ...meta.progress, at: stamp, actor };
    this.validate(meta);
    this.authority(actor, meta);
    if (kind === "ticket") meta.number = this.reserveTicketNumber();
    if (
      kind === "ticket" &&
      this.config().columns.find((c) => c.id === meta.status)?.role ===
        "progress"
    )
      meta.progressStartedAt = stamp;
    if (kind === "ticket" && meta.order === undefined) meta.order = Date.now();
    if (kind === "ticket")
      meta.reviewedRules = Object.fromEntries(
        this.applicableRules({ meta, body, revision: "", path: "" }).map(
          (r) => [r.meta.id, r.revision],
        ),
      );
    const rel = `records/${folder[kind]}/${id}.md`;
    atomic(this.file(rel), markdown(meta, body));
    this.history(id, actor, "created", null, { meta, body });
    return this.load(rel);
  }
  create(
    kind: Kind,
    input: Record<string, unknown>,
    body: string,
    actor: Actor,
  ) {
    return this.write(() => this.createNow(kind, input, body, actor));
  }
  private updateNow(
    id: string,
    revision: string,
    patch: Record<string, unknown>,
    body: string | undefined,
    actor: Actor,
    managed = false,
  ): RecordFile {
    const old = this.get(id);
    if (old.meta.duplicateOf && patch.archived === false)
      throw new Problem(
        422,
        "Archived duplicate sources cannot be unarchived; open their survivor instead",
      );
    if (
      !managed &&
      ["related", "duplicateOf", "mergedFrom", "duplicateMerge"].some(
        (key) => key in patch,
      )
    )
      throw new Problem(
        422,
        "Use the relationship or merge action so reciprocal links and revision checks stay consistent",
      );
    for (const key of ["assignment", "agentReview"])
      if (
        !managed &&
        key in patch &&
        JSON.stringify(patch[key]) !== JSON.stringify(old.meta[key])
      )
        throw new Problem(
          403,
          "Managed assignments and review receipts are service-owned",
        );
    if (
      actor.kind === "agent" &&
      "humanReviewRequired" in patch &&
      patch.humanReviewRequired !== old.meta.humanReviewRequired
    )
      throw new Problem(403, "Only a human can change mandatory human review");
    const assignment = old.meta.assignment as Assignment | undefined;
    if (
      !managed &&
      actor.kind === "agent" &&
      assignment &&
      assignment.state !== "released" &&
      assignment.worker !== actor.name
    )
      throw new Problem(
        409,
        `Assigned to ${assignment.worker}; request reassignment instead of overwriting their work`,
      );
    id = old.meta.id;
    if (old.revision !== revision)
      throw new Problem(
        409,
        "This record changed. Reload it before saving; your edit has not been applied.",
        { current: old },
      );
    for (const key of ["id", "number", "kind", "schema", "createdAt", "author"])
      if (
        key in patch &&
        JSON.stringify(patch[key]) !== JSON.stringify(old.meta[key])
      )
        throw new Problem(422, `Cannot change ${key}`);
    if (old.meta.kind === "ticket") patch = this.ticketLinks(patch);
    if (
      old.meta.kind === "ticket" &&
      actor.kind === "human" &&
      patch.scopeApproved === true &&
      !old.meta.scopeApproved
    )
      patch = {
        ...patch,
        scopeApprovedAt: now(),
        scopeApprovedBy: actor,
      };
    if (
      old.meta.kind === "ticket" &&
      this.config().columns.find(
        (c) => c.id === (patch.status ?? old.meta.status),
      )?.role === "review" &&
      this.config().columns.find((c) => c.id === old.meta.status)?.role !==
        "review"
    ) {
      // A previous passing run must not silently become this submission's evidence.
      patch = {
        ...patch,
        reviewVerificationAt:
          (patch.verification as Verification | undefined)?.at ?? "",
      };
    }
    if (old.meta.kind === "ticket") {
      const role = (status: string) =>
        this.config().columns.find((c) => c.id === status)?.role;
      if (
        role(String(patch.status ?? old.meta.status)) === "done" &&
        role(old.meta.status) !== "done"
      )
        patch = { ...patch, acceptedBy: actor };
      if (
        role(String(patch.status ?? old.meta.status)) === "progress" &&
        role(old.meta.status) !== "progress"
      )
        patch = { ...patch, progressStartedAt: now() };
      // The service stamps reports; identity labels are attribution, not process supervision.
      if (patch.progress)
        patch = {
          ...patch,
          progress: { ...(patch.progress as object), at: now(), actor },
        };
    }
    const meta = { ...old.meta, ...patch, updatedAt: now() } as Meta;
    this.validate(meta);
    this.authority(actor, meta, old, managed);
    if (
      meta.kind === "ticket" &&
      actor.kind === "agent" &&
      this.config().columns.find((c) => c.id === meta.status)?.role ===
        "review" &&
      old.meta.status !== meta.status &&
      (!meta.handoff?.trim() || !meta.evidence?.trim())
    )
      throw new Problem(
        422,
        "Review requires a handoff and verification evidence",
      );
    const oldText = read(this.file(old.path));
    if (hash(oldText) !== revision)
      throw new Problem(409, "File changed during save");
    atomic(
      this.file(old.path),
      patchMd(oldText, { ...patch, updatedAt: meta.updatedAt }, body),
    );
    this.history(
      id,
      actor,
      "updated",
      { meta: old.meta, body: old.body },
      { meta, body: body ?? old.body },
    );
    if (
      meta.kind === "ticket" &&
      actor.kind === "agent" &&
      this.config().columns.find((c) => c.id === meta.status)?.role ===
        "review" &&
      this.config().columns.find((c) => c.id === old.meta.status)?.role !==
        "review"
    )
      this.commentNow(id, this.reviewSummary(meta), actor, "review");
    return this.load(old.path);
  }
  update(
    id: string,
    revision: string,
    patch: Record<string, unknown>,
    body: string | undefined,
    actor: Actor,
  ) {
    return this.write(() => this.updateNow(id, revision, patch, body, actor));
  }

  relate(id: string, input: unknown, actor: Actor) {
    return this.write(() => {
      actorSchema.parse(actor);
      const data = z
        .object({
          other: z.union([z.string(), z.number().int().nonnegative()]),
          revision: z.string().min(1),
          otherRevision: z.string().min(1),
          action: z.enum(["add", "remove"]),
        })
        .parse(input);
      const left = this.get(id),
        right = this.get(String(data.other));
      if (left.meta.kind !== "ticket" || right.meta.kind !== "ticket")
        throw new Problem(422, "Related links connect tickets only");
      if (left.meta.id === right.meta.id)
        throw new Problem(422, "A ticket cannot relate to itself");
      const leftHas = (left.meta.related ?? []).includes(right.meta.id),
        rightHas = (right.meta.related ?? []).includes(left.meta.id);
      if (
        (data.action === "add" && leftHas && rightHas) ||
        (data.action === "remove" && !leftHas && !rightHas)
      )
        return { ticket: left, related: right, changed: false };
      if (
        left.revision !== data.revision ||
        right.revision !== data.otherRevision
      )
        throw new Problem(
          409,
          "A related ticket changed. Reload both tickets and retry.",
          {
            records: [left, right],
          },
        );
      const apply = (record: RecordFile, other: string) => {
        const links = new Set(record.meta.related ?? []);
        if (data.action === "add") links.add(other);
        else links.delete(other);
        return {
          ...record.meta,
          related: [...links].sort(),
          updatedAt: now(),
        } as Meta;
      };
      const [savedLeft, savedRight] = this.commitRecordTransaction(
        [
          {
            old: left,
            meta: apply(left, right.meta.id),
            action: `related ticket ${data.action === "add" ? "added" : "removed"}`,
          },
          {
            old: right,
            meta: apply(right, left.meta.id),
            action: `related ticket ${data.action === "add" ? "added" : "removed"}`,
          },
        ],
        actor,
      );
      return { ticket: savedLeft, related: savedRight, changed: true };
    });
  }

  private acceptanceCriteria(body: string) {
    const match = body.match(
      /(?:^|\n)#{1,6}\s+Acceptance criteria\s*\n([\s\S]*?)(?=\n#{1,6}\s|$)/i,
    );
    return (match?.[1] ?? "").trim();
  }

  private mergeSources(ticket: RecordFile) {
    const found: RecordFile[] = [];
    const seen = new Set<string>([ticket.meta.id]);
    const visit = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      const record = this.get(id);
      if (record.meta.kind !== "ticket") return;
      found.push(record);
      for (const nested of record.meta.mergedFrom ?? []) visit(nested);
    };
    for (const id of ticket.meta.mergedFrom ?? []) visit(id);
    return found;
  }

  mergePreview(survivorId: string, sourceId: string) {
    const survivor = this.get(String(survivorId)),
      source = this.get(String(sourceId));
    if (survivor.meta.kind !== "ticket" || source.meta.kind !== "ticket")
      throw new Problem(422, "Only tickets can be merged");
    if (survivor.meta.id === source.meta.id)
      throw new Problem(422, "A ticket cannot be merged into itself");
    if (survivor.meta.duplicateOf)
      throw new Problem(
        422,
        "Choose the canonical survivor, not an archived duplicate",
      );
    if (source.meta.duplicateOf && source.meta.duplicateOf !== survivor.meta.id)
      throw new Problem(
        422,
        "The source is already a duplicate of another ticket",
      );
    const records = this.list().filter((r) => r.meta.kind === "ticket");
    const incoming = records.filter(
      (record) =>
        record.meta.parent === source.meta.id ||
        (record.meta.dependencies ?? []).includes(source.meta.id),
    );
    const affected = [
      survivor,
      source,
      ...incoming.filter(
        (record) =>
          record.meta.id !== survivor.meta.id &&
          record.meta.id !== source.meta.id,
      ),
    ];
    const uniqueAffected = [
      ...new Map(affected.map((r) => [r.meta.id, r])).values(),
    ];
    const conflicts: Partial<
      Record<MergeConflictField, { survivor: unknown; source: unknown }>
    > = {};
    for (const field of ["parent", "status", "owner", "priority"] as const) {
      const a = survivor.meta[field] ?? null,
        b = source.meta[field] ?? null;
      if (JSON.stringify(a) !== JSON.stringify(b))
        conflicts[field] = { survivor: a, source: b };
    }
    const survivorCriteria = this.acceptanceCriteria(survivor.body),
      sourceCriteria = this.acceptanceCriteria(source.body);
    if (
      survivorCriteria &&
      sourceCriteria &&
      survivorCriteria !== sourceCriteria
    )
      conflicts.acceptanceCriteria = {
        survivor: survivorCriteria,
        source: sourceCriteria,
      };
    const sourceComments = this.comments().filter(
      (comment) => comment.ticket === source.meta.id,
    );
    const imageIds = new Set(
      sourceComments.flatMap((comment) =>
        [
          ...comment.body.matchAll(
            /(?:#image=|\/api\/images\/)(image-[\w-]+)/g,
          ),
        ].map((match) => match[1]),
      ),
    );
    return {
      survivor,
      source,
      alreadyMerged: source.meta.duplicateOf === survivor.meta.id,
      conflicts,
      content: {
        description: !!source.body.trim(),
        comments: sourceComments.length,
        attachments: new Set([...(source.meta.attachments ?? []), ...imageIds])
          .size,
        decisions: source.meta.decisions ?? [],
        rules: source.meta.rules ?? [],
      },
      incoming: incoming.map((record) => ({
        id: record.meta.id,
        number: record.meta.number,
        title: record.meta.title,
        parent: record.meta.parent === source.meta.id,
        dependency: (record.meta.dependencies ?? []).includes(source.meta.id),
      })),
      affected: Object.fromEntries(
        uniqueAffected.map((record) => [record.meta.id, record.revision]),
      ),
    };
  }

  merge(survivorId: string, input: unknown, actor: Actor) {
    return this.write(() => {
      actorSchema.parse(actor);
      const data = z
        .object({
          source: z.union([z.string(), z.number().int().nonnegative()]),
          requestId: z.string().min(8).max(200),
          revisions: z.record(z.string(), z.string()),
          resolutions: z
            .partialRecord(
              z.enum([
                "parent",
                "status",
                "owner",
                "priority",
                "acceptanceCriteria",
              ]),
              z.enum(["survivor", "source", "both"]),
            )
            .default({}),
        })
        .parse(input);
      const preview = this.mergePreview(survivorId, String(data.source));
      const survivor = preview.survivor,
        source = preview.source;
      const fingerprint = hash(
        JSON.stringify({
          survivor: survivor.meta.id,
          source: source.meta.id,
          resolutions: data.resolutions,
        }),
      );
      if (source.meta.duplicateMerge?.requestId === data.requestId) {
        if (source.meta.duplicateMerge.fingerprint !== fingerprint)
          throw new Problem(
            409,
            "This merge request ID was already used with different choices",
          );
        return { survivor, source, changed: false, recovered: true };
      }
      if (preview.alreadyMerged)
        return { survivor, source, changed: false, recovered: true };
      const conflictKeys = Object.keys(
        preview.conflicts,
      ) as MergeConflictField[];
      const missing = conflictKeys.filter((field) => !data.resolutions[field]);
      if (missing.length)
        throw new Problem(
          422,
          `Resolve merge conflicts before applying: ${missing.join(", ")}`,
          preview,
        );
      if (
        Object.entries(data.resolutions).some(
          ([field, resolution]) =>
            resolution === "both" && field !== "acceptanceCriteria",
        )
      )
        throw new Problem(
          422,
          '"both" is only valid for acceptance criteria conflicts',
        );
      for (const [id, revision] of Object.entries(preview.affected))
        if (data.revisions[id] !== revision)
          throw new Problem(
            409,
            `Missing or stale revision for affected ticket ${id}`,
            preview,
          );
      if (Object.keys(data.revisions).some((id) => !(id in preview.affected)))
        throw new Problem(
          409,
          "The affected ticket set changed. Reload the preview.",
          preview,
        );

      const stamp = now();
      const survivorMeta: Meta = {
        ...survivor.meta,
        mergedFrom: [
          ...new Set([...(survivor.meta.mergedFrom ?? []), source.meta.id]),
        ],
        updatedAt: stamp,
      };
      for (const field of ["parent", "status", "owner", "priority"] as const)
        if (data.resolutions[field] === "source") {
          const value = source.meta[field];
          if (value === undefined) delete survivorMeta[field];
          else (survivorMeta as any)[field] = value;
        }
      const role = (status: string) =>
        this.config().columns.find((column) => column.id === status)?.role;
      if (
        role(survivorMeta.status) === "done" &&
        role(survivor.meta.status) !== "done"
      )
        throw new Problem(
          422,
          "Merging cannot accept work into Done; keep the survivor status and review it separately",
        );
      if (
        role(survivorMeta.status) === "review" &&
        role(survivor.meta.status) !== "review"
      )
        survivorMeta.reviewVerificationAt = "";
      if (
        role(survivorMeta.status) === "progress" &&
        role(survivor.meta.status) !== "progress"
      )
        survivorMeta.progressStartedAt = stamp;
      let survivorBody = survivor.body;
      const sourceCriteria = this.acceptanceCriteria(source.body);
      if (
        sourceCriteria &&
        ["source", "both"].includes(data.resolutions.acceptanceCriteria ?? "")
      ) {
        if (data.resolutions.acceptanceCriteria === "source")
          survivorBody = this.acceptanceCriteria(survivor.body)
            ? survivor.body.replace(
                /((?:^|\n)#{1,6}\s+Acceptance criteria\s*\n)[\s\S]*?(?=\n#{1,6}\s|$)/i,
                `$1${sourceCriteria}\n`,
              )
            : `${survivor.body.trimEnd()}\n\n## Acceptance criteria\n\n${sourceCriteria}\n`;
        else
          survivorBody = `${survivor.body.trimEnd()}\n\n## Preserved acceptance criteria from #${source.meta.number ?? source.meta.id}\n\n${sourceCriteria}\n`;
      }
      const receipt = {
        requestId: data.requestId,
        fingerprint,
        survivor: survivor.meta.id,
        source: source.meta.id,
        at: stamp,
        actor,
        resolutions: data.resolutions as Partial<
          Record<MergeConflictField, MergeResolution>
        >,
        affected: Object.keys(preview.affected),
      };
      const sourceMeta: Meta = {
        ...source.meta,
        archived: true,
        duplicateOf: survivor.meta.id,
        duplicateMerge: receipt,
        updatedAt: stamp,
      };
      survivorMeta.duplicateMerge = receipt;

      const changes: {
        old: RecordFile;
        meta: Meta;
        body?: string;
        action: string;
      }[] = [
        {
          old: survivor,
          meta: survivorMeta,
          body: survivorBody,
          action: "duplicate merged into survivor",
        },
        {
          old: source,
          meta: sourceMeta,
          action: "marked as archived duplicate",
        },
      ];
      for (const item of preview.incoming) {
        const old = this.get(item.id);
        if (old.meta.id === survivor.meta.id || old.meta.id === source.meta.id)
          continue;
        const meta: Meta = { ...old.meta, updatedAt: stamp };
        if (item.parent) meta.parent = survivor.meta.id;
        if (item.dependency)
          meta.dependencies = [
            ...new Set(
              (meta.dependencies ?? []).map((dependency) =>
                dependency === source.meta.id ? survivor.meta.id : dependency,
              ),
            ),
          ].filter((dependency) => dependency !== meta.id);
        changes.push({
          old,
          meta,
          action: "incoming duplicate link redirected",
        });
      }
      if (survivorMeta.parent === source.meta.id)
        throw new Problem(
          422,
          "The survivor is a child of the source. Choose the source parent in the merge conflicts or reparent it first.",
          preview,
        );
      if ((survivorMeta.dependencies ?? []).includes(source.meta.id))
        survivorMeta.dependencies = survivorMeta.dependencies!.filter(
          (dependency) => dependency !== source.meta.id,
        );
      const saved = this.commitRecordTransaction(changes, actor);
      return {
        survivor: saved.find((record) => record.meta.id === survivor.meta.id),
        source: saved.find((record) => record.meta.id === source.meta.id),
        changed: true,
        recovered: false,
      };
    });
  }
  // Internal controller entry point; never exposed as a generic HTTP/CLI patch.
  // All admission checks run again inside the board's serialized writer.
  managedUpdate(
    id: string,
    revision: string,
    patch: Record<string, unknown>,
    actor: Actor,
    guard: () => void,
    receipt?: AgentReviewReceipt,
  ) {
    return this.write(() => {
      guard();
      const old = this.get(id);
      if (!this.scope(old))
        throw new Problem(403, "Approved scope was revoked");
      if (receipt) {
        const config = this.config().orchestration as
          | {
              enabled?: boolean;
              reviewer?: { name: string };
              humanPolicy?: string;
            }
          | undefined;
        const assignment = old.meta.assignment as Assignment | undefined;
        if (
          !config?.enabled ||
          actor.kind !== "agent" ||
          config.reviewer?.name !== actor.name ||
          receipt.reviewer !== actor.name
        )
          throw new Problem(403, "Reviewer authority was revoked");
        if (
          receipt.worker === receipt.reviewer ||
          assignment?.worker !== receipt.worker ||
          assignment?.runId !== receipt.submission ||
          assignment.state !== "submitted"
        )
          throw new Problem(
            403,
            "An independent reviewer and current submission are required",
          );
        if (
          this.config().columns.find((c) => c.id === old.meta.status)?.role !==
          "review"
        )
          throw new Problem(409, "Submission is no longer in Review");
        if (
          receipt.outcome === "accept" &&
          (old.meta.humanReviewRequired ||
            config.humanPolicy === "all" ||
            (config.humanPolicy === "parents" &&
              this.list().some((r) => r.meta.parent === id)))
        )
          throw new Problem(403, "This ticket requires human acceptance");
        patch = { ...patch, agentReview: receipt };
      }
      return this.updateNow(id, revision, patch, undefined, actor, true);
    });
  }
  // Internal controller entry point for an explicit stopped-run takeover.
  // Runtime/process checks are supplied by Orchestrator and rerun inside the
  // same serialized writer as the revision and assignment identity checks.
  takeoverManagedAssignment(
    id: string,
    revision: string,
    expected: { runId: string; worker: string; worktree?: string },
    actor: Actor,
    guard: () => void,
  ) {
    return this.write(() => {
      guard();
      const old = this.get(id);
      const config = this.config().orchestration as
        | { enabled?: boolean; reviewer?: { name?: string } }
        | undefined;
      if (
        actor.kind !== "human" &&
        (!config?.enabled || config.reviewer?.name !== actor.name)
      )
        throw new Problem(
          403,
          "Only the designated orchestrator or a human can take over a stopped run",
        );
      if (old.revision !== revision)
        throw new Problem(
          409,
          "This record changed. Reload it before taking over the assignment.",
          { current: old },
        );
      const role = this.config().columns.find(
        (c) => c.id === old.meta.status,
      )?.role;
      if (old.meta.archived || role === "done" || role === "review")
        throw new Problem(
          409,
          "Reopen the ticket for development before taking over",
        );
      const assignment = old.meta.assignment as Assignment | undefined;
      const reopenedSubmission =
        assignment?.state === "submitted" &&
        (role === "selected" || role === "progress");
      if (
        !assignment ||
        assignment.runId !== expected.runId ||
        assignment.worker !== expected.worker ||
        (!reopenedSubmission &&
          !["assigned", "acknowledged"].includes(assignment.state))
      )
        throw new Problem(
          409,
          "Managed assignment changed; reload the run before taking it over",
        );
      if (!this.scope(old))
        throw new Problem(403, "Approved scope was revoked");

      const claims = this.claims();
      const obsolete = (claim: Claim) =>
        claim.ticket === old.meta.id &&
        claim.actor.kind === "agent" &&
        claim.actor.name === expected.worker &&
        !!expected.worktree &&
        claim.worktree === expected.worktree;
      const conflicting = claims.find(
        (claim) =>
          claim.ticket === old.meta.id &&
          claim.expiresAt > now() &&
          !obsolete(claim),
      );
      if (conflicting)
        throw new Problem(
          409,
          `Ticket has a different live claim by ${conflicting.actor.name}`,
          conflicting,
        );

      const saved = this.updateNow(
        old.meta.id,
        revision,
        {
          owner: actor.name,
          assignment: {
            ...assignment,
            worker: actor.name,
            assignedBy: actor.name,
            assignedAt: now(),
            state: "acknowledged",
            mode: "takeover",
          } satisfies Assignment,
        },
        undefined,
        actor,
        true,
      );
      const retained = claims.filter((claim) => !obsolete(claim));
      if (retained.length !== claims.length)
        atomic(
          this.file(".local/claims.json"),
          JSON.stringify(retained, null, 2),
        );
      return saved;
    });
  }
  placement(id: string, revision: string, input: unknown, actor: Actor) {
    return this.write(() => {
      const data = z
        .object({
          expected: z
            .array(z.object({ id: z.string(), revision: z.string() }))
            .max(10000),
          patch: z.object({
            status: z.string(),
            order: z.number().finite(),
            priority: z.number().int().min(0).max(3).optional(),
          }),
        })
        .parse(input);
      for (const r of data.expected)
        if (this.get(r.id).revision !== r.revision)
          throw new Problem(
            409,
            "Ticket order changed. Reload and retry your move.",
          );
      return this.updateNow(id, revision, data.patch, undefined, actor);
    });
  }
  comment(
    ticket: string,
    body: string,
    actor: Actor,
    kind: Comment["kind"] = "comment",
  ) {
    return this.write(() => this.commentNow(ticket, body, actor, kind));
  }
  // Keep the receipt in the Markdown record so a lost response can be retried
  // after a restart. Feedback uses a deterministic ID and is written only once.
  private reviewOutcomeNow(id: string, input: unknown, actor: Actor) {
    actorSchema.parse(actor);
    if (actor.kind !== "human")
      throw new Problem(403, "Only a human can accept or request changes");
    const action = z
      .object({
        requestId: z.string().uuid(),
        revision: z.string().min(1),
        outcome: z.enum(["accept", "changes"]),
        target: z.string().min(1),
        feedback: z.string().trim().max(10000).default(""),
        patch: z.record(z.string(), z.unknown()).default({}),
        body: z.string().optional(),
      })
      .parse(input);
    const fingerprint = hash(JSON.stringify({ action, actor }));
    let current = this.get(id);
    const receipt = current.meta.reviewOutcome as
      | { requestId: string; fingerprint: string }
      | undefined;
    if (receipt?.requestId === action.requestId) {
      if (receipt.fingerprint !== fingerprint)
        throw new Problem(
          409,
          "This review request was already used with different content",
        );
    } else {
      if (current.revision !== action.revision)
        throw new Problem(
          409,
          "This record changed. Review the current version before deciding.",
          { current },
        );
      const columns = this.config().columns;
      if (
        current.meta.kind !== "ticket" ||
        columns.find((c) => c.id === current.meta.status)?.role !== "review"
      )
        throw new Problem(
          422,
          "Only a ticket in Review can receive a review outcome",
        );
      const role = action.outcome === "accept" ? "done" : "progress";
      if (columns.find((c) => c.id === action.target)?.role !== role)
        throw new Problem(422, `Choose a destination with the ${role} role`);
      current = this.updateNow(
        id,
        action.revision,
        {
          ...action.patch,
          status: action.target,
          reviewOutcome: { requestId: action.requestId, fingerprint },
        },
        action.body,
        actor,
      );
    }
    const commentId = `comment-review-${hash(current.meta.id + action.requestId)}`;
    if (!fs.existsSync(this.file(`records/comments/${commentId}.md`))) {
      const title =
        action.outcome === "accept"
          ? "Accepted into Done"
          : "Changes requested";
      this.commentNow(
        current.meta.id,
        `## ${title}\n\n${action.feedback || "Review outcome recorded."}\n`,
        actor,
        "review",
        commentId,
      );
    }
    return current;
  }
  reviewOutcome(id: string, input: unknown, actor: Actor) {
    return this.write(() => this.reviewOutcomeNow(id, input, actor));
  }
  approvalActions(input: unknown, actor: Actor) {
    return this.write(() => {
      actorSchema.parse(actor);
      if (actor.kind !== "human")
        throw new Problem(
          403,
          "Only a human can approve scope or accept work into Done",
        );
      const action = z
        .object({
          action: z.enum(["approve-scope", "accept-review"]),
          target: z.string().min(1).optional(),
          items: z
            .array(
              z.object({
                id: z.string().min(1),
                revision: z.string().min(1),
                requestId: z.string().uuid().optional(),
              }),
            )
            .min(1)
            .max(1000),
        })
        .parse(input);
      if (action.action === "accept-review") {
        if (!action.target) throw new Problem(422, "Choose a Done destination");
        if (
          this.config().columns.find((column) => column.id === action.target)
            ?.role !== "done"
        )
          throw new Problem(422, "Choose a destination with the done role");
      }
      const results = action.items.map((item) => {
        try {
          const current = this.get(item.id);
          if (current.revision !== item.revision)
            throw new Problem(
              409,
              "This record changed. Review the current version before deciding.",
              { current },
            );
          if (action.action === "approve-scope") {
            if (current.meta.kind !== "ticket")
              throw new Problem(422, "Only tickets can have approved scope");
            if (current.meta.scopeApproved)
              throw new Problem(422, "Scope is already explicitly approved");
            const inherited = this.scope(current);
            if (inherited)
              throw new Problem(
                422,
                `Scope is inherited from #${inherited.meta.number ?? inherited.meta.id}`,
              );
            const record = this.updateNow(
              current.meta.id,
              current.revision,
              {
                scopeApproved: true,
                scopeApprovedAt: now(),
                scopeApprovedBy: actor,
              },
              undefined,
              actor,
            );
            return {
              id: record.meta.id,
              outcome: "succeeded" as const,
              record,
            };
          }
          const role = this.config().columns.find(
            (column) => column.id === current.meta.status,
          )?.role;
          if (current.meta.kind !== "ticket" || role !== "review")
            throw new Problem(
              422,
              "Only a ticket in Review can be accepted into Done",
            );
          const record = this.reviewOutcomeNow(
            current.meta.id,
            {
              requestId: item.requestId ?? crypto.randomUUID(),
              revision: current.revision,
              outcome: "accept",
              target: action.target,
              feedback: "Accepted from the board or table.",
            },
            actor,
          );
          return {
            id: record.meta.id,
            outcome: "succeeded" as const,
            record,
          };
        } catch (error) {
          const problem =
            error instanceof Problem
              ? error
              : new Problem(500, "Unexpected approval action failure");
          return {
            id: item.id,
            outcome:
              problem.status === 422
                ? ("ineligible" as const)
                : ("failed" as const),
            status: problem.status,
            error: problem.message,
            detail: problem.detail,
          };
        }
      });
      return { action: action.action, results };
    });
  }
  private reviewSummary(meta: Meta) {
    const parts = [
      "## Work completed",
      "",
      meta.handoff!.trim(),
      "",
      "## What to review",
      "",
      meta.reviewInstructions?.trim() ||
        "Check the result against this ticket’s acceptance criteria and inspect the verification evidence below. Move the ticket to Done if accepted, or reply with Review feedback describing any changes needed.",
      "",
      "## Verification",
      "",
      meta.evidence!.trim(),
    ];
    if (meta.verification)
      parts.push(
        "",
        `${meta.reviewVerificationAt === meta.verification.at ? "Recorded run" : "Earlier run (not linked to this submission)"}: ${meta.verification.command} — exit ${meta.verification.exitCode} (${meta.verification.at}).`,
      );
    if (meta.pr) parts.push("", `Pull request: ${meta.pr}`);
    if (meta.branch) parts.push("", `Branch: ${meta.branch}`);
    if (meta.exceptions?.trim())
      parts.push(
        "",
        "## Exceptions and limitations",
        "",
        meta.exceptions.trim(),
      );
    return parts.join("\n") + "\n";
  }
  private commentNow(
    ticket: string,
    body: string,
    actor: Actor,
    kind: Comment["kind"],
    commentId?: string,
  ) {
    ticket = this.get(ticket).meta.id;
    actorSchema.parse(actor);
    if (!body.trim()) throw new Problem(422, "Comment cannot be empty");
    if (!["comment", "question", "handoff", "review"].includes(kind))
      throw new Problem(422, "Unknown comment type");
    const meta = {
      id: commentId ?? uid("comment"),
      ticket,
      actor,
      kind,
      at: now(),
      resolved: false,
    };
    atomic(this.file(`records/comments/${meta.id}.md`), markdown(meta, body));
    return meta;
  }
  questionnaire(
    ticket: string,
    input: unknown,
    actor: Actor,
    replacing?: { id: string; revision: string },
  ) {
    return this.write(() => {
      actorSchema.parse(actor);
      const questions = questionsSchema.parse(input),
        record = this.get(ticket);
      if (record.meta.kind !== "ticket")
        throw new Problem(422, "Questionnaires belong to tickets");
      const id = replacing?.id ?? uid("comment");
      if (!/^[A-Za-z0-9_-]+$/.test(id))
        throw new Problem(400, "Invalid questionnaire ID");
      const p = this.file(`records/comments/${id}.md`);
      let original: Comment | undefined;
      if (replacing) {
        original = this.loadComment(p);
        if (original.ticket !== record.meta.id || !original.questions)
          throw new Problem(422, "Not this ticket's questionnaire");
        if (original.revision !== replacing.revision)
          throw new Problem(
            409,
            "Questionnaire changed. Reload before editing.",
          );
      }
      const body =
          questionText(questions) +
          (original
            ? "\n\n## Previous questionnaire and answers\n\n" + original.body
            : ""),
        stamp = now();
      const meta = {
        id,
        ticket: record.meta.id,
        actor: original?.actor ?? actor,
        at: original?.at ?? stamp,
        kind: "question",
        resolved: false,
        questions,
        answers: original?.answers ?? [],
        editedAt: stamp,
        editedBy: actor,
      };
      if (original)
        this.history(
          record.meta.id,
          actor,
          "questionnaire replaced",
          original,
          { ...meta, body },
        );
      atomic(p, original ? patchMd(read(p), meta, body) : markdown(meta, body));
      return this.loadComment(p);
    });
  }
  answerQuestionnaire(
    id: string,
    revision: string,
    input: unknown,
    actor: Actor,
    choiceInput?: unknown,
  ) {
    return this.write(() => {
      actorSchema.parse(actor);
      if (actor.kind !== "human")
        throw new Problem(403, "Questionnaire answers require a human");
      if (!/^[A-Za-z0-9_-]+$/.test(id))
        throw new Problem(400, "Invalid questionnaire ID");
      const p = this.file(`records/comments/${id}.md`),
        original = this.loadComment(p);
      if (original.revision !== revision)
        throw new Problem(
          409,
          "Questionnaire or answers changed. Reload and reconcile your draft.",
        );
      const questions = questionsSchema.parse(original.questions);
      const values = z
        .record(z.string(), z.string().trim().max(10000))
        .parse(input);
      if (Object.keys(values).some((k) => !questions.some((q) => q.id === k)))
        throw new Problem(422, "Unknown question ID");
      const choiceAnswers =
        choiceInput === undefined
          ? undefined
          : choiceAnswersSchema.parse(choiceInput);
      for (const [id, answer] of Object.entries(choiceAnswers ?? {})) {
        const q = questions.find((q) => q.id === id);
        if (!q || q.type !== "choice")
          throw new Problem(422, "Unknown choice question ID");
        if (
          answer.selected.some((value) => !q.choices!.includes(value)) ||
          new Set(answer.selected).size !== answer.selected.length ||
          (!q.multiple && answer.selected.length > 1)
        )
          throw new Problem(422, "Choose valid options for this question");
        values[id] = [
          ...answer.selected,
          ...(answer.custom ? [answer.custom] : []),
        ].join("\n\n");
        if (values[id].length > 10000)
          throw new Problem(422, "Answer is too long");
      }
      if (questions.some((q) => q.required && !values[q.id]?.trim()))
        throw new Problem(
          422,
          "Answer all required questions before submitting",
        );
      if (!Object.values(values).some((v) => v.trim()))
        throw new Problem(422, "Supply an answer before submitting");
      const answer = {
        actor,
        at: now(),
        questions,
        values,
        ...(choiceAnswers ? { choiceAnswers } : {}),
      };
      const body =
        original.body +
        `\n\n## Answers from ${actor.name} at ${answer.at}\n\n` +
        questions
          .map(
            (q) =>
              `### ${q.id}: ${q.prompt}\n\n${values[q.id] || "(No answer supplied)"}`,
          )
          .join("\n\n");
      const patch = {
        answers: [...(original.answers ?? []), answer],
        resolved: true,
        resolvedBy: actor,
        resolvedAt: answer.at,
      };
      atomic(p, patchMd(read(p), patch, body));
      this.history(original.ticket, actor, "questionnaire answered", original, {
        ...patch,
        body,
      });
      return this.loadComment(p);
    });
  }
  resolveComment(
    id: string,
    revision: string,
    resolved: boolean,
    actor: Actor,
  ) {
    return this.write(() => {
      const p = this.file(`records/comments/${id}.md`),
        s = read(p);
      if (hash(s) !== revision) throw new Problem(409, "Comment changed");
      const before = parseMd(s).meta;
      atomic(p, patchMd(s, { resolved, resolvedBy: actor, resolvedAt: now() }));
      this.history(
        before.ticket,
        actor,
        resolved ? "resolved question" : "reopened question",
        before,
        { ...before, resolved },
      );
      return this.loadComment(p);
    });
  }
  claim(ticket: string, actor: Actor, worktree: string, release = false) {
    return this.write(() => {
      const r = this.get(ticket);
      const assignment = r.meta.assignment as Assignment | undefined;
      if (
        !release &&
        assignment &&
        assignment.state !== "released" &&
        assignment.worker !== actor.name
      )
        throw new Problem(409, `Assigned to ${assignment.worker}`);
      ticket = r.meta.id;
      if (r.meta.kind !== "ticket")
        throw new Problem(422, "Only tickets can be claimed");
      this.authority(
        actor,
        {
          ...r.meta,
          status: this.config().columns.find((c) => c.role === "progress")!.id,
        },
        r,
      );
      const claims = this.claims(),
        existing = claims.find((c) => c.ticket === ticket);
      if (
        existing &&
        existing.expiresAt > now() &&
        (existing.actor.name !== actor.name ||
          existing.actor.kind !== actor.kind ||
          existing.worktree !== worktree)
      )
        throw new Problem(
          409,
          `Claimed by ${existing.actor.name} in ${existing.worktree}`,
          existing,
        );
      const result = claims.filter((c) => c.ticket !== ticket);
      if (!release)
        result.push({
          ticket,
          actor,
          worktree,
          branch: fs.existsSync(worktree) ? branch(worktree) : undefined,
          reportedAt: now(),
          expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        });
      atomic(this.file(".local/claims.json"), JSON.stringify(result, null, 2));
      return result.find((c) => c.ticket === ticket) ?? null;
    });
  }
  applicableRules(ticket: RecordFile) {
    const scope = this.scope(ticket);
    const labels = new Set([
      ...(ticket.meta.labels ?? []),
      ...(scope?.meta.labels ?? []),
    ]);
    const records = this.list();
    const replaced = new Set(
      records
        .filter((r) => r.meta.kind === "rule" && r.meta.status === "active")
        .map((r) => r.meta.supersedes)
        .filter(Boolean),
    );
    return records.filter(
      (r) =>
        r.meta.kind === "rule" &&
        r.meta.status === "active" &&
        !replaced.has(r.meta.id) &&
        ((ticket.meta.rules ?? []).includes(r.meta.id) ||
          !r.meta.scope?.length ||
          r.meta.scope.includes("*") ||
          r.meta.scope.some((s) => labels.has(s))),
    );
  }
  context(id: string) {
    const ticket = this.get(id),
      mergedSources = this.mergeSources(ticket),
      provenance = [ticket, ...mergedSources],
      rules = [
        ...new Map(
          provenance
            .flatMap((record) => this.applicableRules(record))
            .map((record) => [record.meta.id, record]),
        ).values(),
      ],
      scope = this.scope(ticket);
    const provenanceIds = new Set(provenance.map((record) => record.meta.id));
    const comments = this.comments().filter((c) => provenanceIds.has(c.ticket));
    const conversationImages = new Set(
      comments.flatMap((c) =>
        [...c.body.matchAll(/(?:#image=|\/api\/images\/)(image-[\w-]+)/g)].map(
          (m) => m[1],
        ),
      ),
    );
    const attachmentIds = new Set([
      ...provenance.flatMap((record) => record.meta.attachments ?? []),
      ...this.attachments()
        .filter((a) => conversationImages.has(a.id))
        .map((a) => a.id),
    ]);
    return {
      ticket,
      workflow: this.config().columns,
      parent: ticket.meta.parent ? this.get(ticket.meta.parent) : null,
      duplicateSurvivor: ticket.meta.duplicateOf
        ? this.get(ticket.meta.duplicateOf)
        : null,
      mergedSources,
      related: (ticket.meta.related ?? []).map((related) => this.get(related)),
      approvedScope: scope ?? null,
      decisionProtocol,
      decisions: this.list().filter(
        (r) =>
          r.meta.kind === "decision" &&
          r.meta.status === "accepted" &&
          !this.list().some(
            (n) =>
              n.meta.kind === "decision" &&
              n.meta.status === "accepted" &&
              n.meta.supersedes === r.meta.id,
          ) &&
          provenance.some(
            (record) =>
              !r.meta.scope?.length ||
              r.meta.scope.includes("*") ||
              (record.meta.decisions ?? []).includes(r.meta.id) ||
              r.meta.scope.some((s) => (record.meta.labels ?? []).includes(s)),
          ),
      ),
      rules,
      ruleRevisions: Object.fromEntries(
        rules.map((r) => [r.meta.id, r.revision]),
      ),
      ruleMatching:
        "Explicit links, global rules, and labels on the ticket or approved parent. Review for missing rules.",
      dependencies: (ticket.meta.dependencies ?? []).map((d) => this.get(d)),
      comments,
      attachments: [...attachmentIds].map((a) => this.attachmentReference(a)),
      claim: this.claims().find((c) => c.ticket === ticket.meta.id) ?? null,
    };
  }
  review(
    id: string,
    revision: string,
    handoff: string,
    evidence: string,
    exceptions: string,
    actor: Actor,
    links: {
      branch?: string;
      pr?: string;
      commits?: string[];
      verification?: Verification;
      reviewInstructions?: string;
      manualReviewRequired?: boolean;
    } = {},
  ) {
    return this.write(() =>
      this.updateNow(
        id,
        revision,
        {
          status: this.config().columns.find((c) => c.role === "review")!.id,
          handoff,
          evidence,
          exceptions,
          reviewVerificationAt: links.verification?.at ?? "",
          reviewInstructions: links.reviewInstructions ?? "",
          manualReviewRequired: links.manualReviewRequired ?? true,
          ...Object.fromEntries(
            Object.entries(links).filter(([, v]) => v !== undefined),
          ),
          reviewedRules: this.context(id).ruleRevisions,
        },
        undefined,
        actor,
      ),
    );
  }
  // The ticket an agent should pick up next: unclaimed (or its own), not
  // blocked, inside an approved scope, Selected before Backlog, then by
  // priority and manual order.
  next(actor: Actor): RecordFile | null {
    const columns = this.config().columns;
    const role = (r: RecordFile) =>
      columns.find((c) => c.id === r.meta.status)?.role;
    const claims = this.claims();
    const stamp = now();
    const candidates = this.list().filter((r) => {
      const assignment = r.meta.assignment as Assignment | undefined;
      if (
        assignment &&
        assignment.state !== "released" &&
        assignment.worker !== actor.name
      )
        return false;
      if (r.meta.kind !== "ticket" || r.meta.archived || r.meta.blocked)
        return false;
      const stage = role(r);
      if (stage !== "selected" && stage !== "backlog") return false;
      if (!this.scope(r)) return false;
      const claim = claims.find(
        (c) => c.ticket === r.meta.id && c.expiresAt > stamp,
      );
      if (
        claim &&
        (claim.actor.name !== actor.name || claim.actor.kind !== actor.kind)
      )
        return false;
      // A parent goal is a container: pick its open children, not the goal.
      if (
        this.list().some(
          (c) => c.meta.parent === r.meta.id && role(c) !== "done",
        )
      )
        return false;
      return true;
    });
    candidates.sort(
      (a, b) =>
        (role(a) === "selected" ? 0 : 1) - (role(b) === "selected" ? 0 : 1) ||
        (a.meta.priority ?? 2) - (b.meta.priority ?? 2) ||
        (a.meta.order ?? 0) - (b.meta.order ?? 0),
    );
    return candidates[0] ?? null;
  }
  // A prompt-ready brief for an agent, with a rough token estimate. `brief`
  // trims decision and rule bodies to their first paragraph.
  contextMarkdown(id: string, brief = false) {
    const c = this.context(id);
    const t = c.ticket;
    const column = c.workflow.find((w) => w.id === t.meta.status);
    const number =
      t.meta.number === undefined ? t.meta.id : `#${t.meta.number}`;
    const priority = ["Urgent", "High", "Normal", "Low"][t.meta.priority ?? 2];
    // Brief mode keeps the first real paragraph, skipping bare headings.
    const trim = (body: string) =>
      brief
        ? (body
            .trim()
            .split(/\n\s*\n/)
            .map((p) => p.trim())
            .find((p) => p && !/^#{1,6}\s/.test(p)) ?? "")
        : body.trim();
    const ref = (r: RecordFile) =>
      r.meta.number === undefined ? r.meta.id : `#${r.meta.number}`;
    const lines: string[] = [
      `# ${number} ${t.meta.title}`,
      "",
      `Status: ${column?.name ?? t.meta.status} · Priority: ${priority}` +
        (t.meta.owner ? ` · Owner: ${t.meta.owner}` : "") +
        (t.meta.labels?.length ? ` · Labels: ${t.meta.labels.join(", ")}` : ""),
      `Record ID: ${t.meta.id} · Revision (use as --etag): ${t.revision}`,
    ];
    if (c.duplicateSurvivor)
      lines.push(
        `Duplicate: this archived ticket points to survivor ${ref(c.duplicateSurvivor)} ${c.duplicateSurvivor.meta.title}. Use the survivor for active work; this record remains available for provenance.`,
      );
    if (c.parent) lines.push(`Parent: ${ref(c.parent)} ${c.parent.meta.title}`);
    if (t.meta.assignment)
      lines.push(
        t.meta.assignment.mode === "takeover"
          ? `Explicit takeover: ${t.meta.assignment.worker} · ${t.meta.assignment.state} · stopped managed run ${t.meta.assignment.runId}. Work under your own identity and use the ordinary claim, progress and human-review workflow.`
          : `Managed assignment: ${t.meta.assignment.worker} · ${t.meta.assignment.state} · run ${t.meta.assignment.runId}. Follow the managed run prompt; the controller owns claims, verification and review writes.`,
      );
    if (t.meta.agentReview)
      lines.push(
        `Last orchestrator review: ${t.meta.agentReview.reviewer} reviewed ${t.meta.agentReview.worker}'s submission: ${t.meta.agentReview.outcome}. Code: ${t.meta.agentReview.code}. Integration: ${t.meta.agentReview.integration}. ${t.meta.agentReview.rationale}`,
      );
    lines.push(
      c.approvedScope
        ? `Approved scope: ${ref(c.approvedScope)} ${c.approvedScope.meta.title}`
        : "Approved scope: none. Selecting or implementing this ticket needs a human to approve its scope first.",
    );
    if (t.meta.progress)
      lines.push(
        `Last reported progress: ${t.meta.progress.note} (${t.meta.progress.percent === undefined ? "no estimate" : t.meta.progress.percent + "% estimate"}, ${t.meta.progress.at}, ${t.meta.progress.actor.name})`,
      );
    if (t.meta.progressStartedAt)
      lines.push(
        `Current In Progress session began: ${t.meta.progressStartedAt} (wall-clock, not active agent time)`,
      );
    if (t.meta.blocked) lines.push(`Blocked: ${t.meta.blocked}`);
    if (t.meta.branch) lines.push(`Branch: ${t.meta.branch}`);
    if (t.meta.pr) lines.push(`Pull request: ${t.meta.pr}`);
    if (c.claim)
      lines.push(
        `Claim: ${c.claim.actor.name} in ${c.claim.worktree} until ${c.claim.expiresAt}`,
      );
    lines.push("", "## Brief", "", t.body.trim() || "(No description.)");
    const ancestors = [c.approvedScope, c.parent];
    const included = new Set([t.meta.id]);
    for (const ancestor of ancestors) {
      if (!ancestor || included.has(ancestor.meta.id)) continue;
      included.add(ancestor.meta.id);
      lines.push(
        "",
        `## ${ancestor === c.approvedScope ? "Approved scope" : "Parent context"}: ${ref(ancestor)} ${ancestor.meta.title}`,
        "",
        `Record: ${ancestor.meta.id} · Author: ${ancestor.meta.author.name} (${ancestor.meta.author.kind}) · Revision: ${ancestor.revision}`,
        "",
        ancestor.body.trim() || "(No description.)",
      );
    }
    if (t.meta.handoff)
      lines.push("", "## Current handoff", "", t.meta.handoff.trim());
    if (t.meta.verification) {
      const v = t.meta.verification;
      lines.push(
        "",
        "## Last verification",
        "",
        `\`${v.command}\` exited ${v.exitCode} at ${v.at}`,
      );
    }
    if (c.dependencies.length) {
      lines.push("", "## Depends on", "");
      for (const d of c.dependencies)
        lines.push(
          `- ${ref(d)} ${d.meta.title} (${
            c.workflow.find((w) => w.id === d.meta.status)?.name ??
            d.meta.status
          })`,
        );
    }
    if (c.related.length) {
      lines.push(
        "",
        "## Related tickets (context only; not blocking dependencies)",
        "",
      );
      for (const related of c.related)
        lines.push(
          `- ${ref(related)} ${related.meta.title} (${
            c.workflow.find((w) => w.id === related.meta.status)?.name ??
            related.meta.status
          })${related.meta.duplicateOf ? " — archived duplicate" : ""}`,
        );
    }
    if (c.mergedSources.length) {
      lines.push("", "## Preserved duplicate sources", "");
      for (const source of c.mergedSources)
        lines.push(
          `### ${ref(source)} ${source.meta.title}`,
          "",
          `Original author: ${source.meta.author.name} (${source.meta.author.kind}) · Created: ${source.meta.createdAt} · Record: ${source.meta.id}`,
          "",
          source.body.trim() || "(No description.)",
          "",
        );
    }
    if (c.decisions.length) {
      lines.push("", "## Decisions that apply", "");
      for (const d of c.decisions)
        lines.push(`### ${d.meta.title}`, "", trim(d.body), "");
    }
    if (c.rules.length) {
      lines.push("", "## Rules that apply", "");
      for (const r of c.rules)
        lines.push(
          `### ${r.meta.title} (${r.meta.strength ?? "recommended"})`,
          "",
          trim(r.body),
          "",
        );
      lines.push(`Rule matching is advisory: ${c.ruleMatching}`);
    }
    if (c.comments.length) {
      const shown = brief ? c.comments.slice(-5) : c.comments;
      lines.push("", `## Conversation (${c.comments.length})`, "");
      for (const m of shown)
        lines.push(
          `- ${m.actor.name} (${m.kind}${m.resolved ? ", resolved" : ""}, ${m.at}, on ${m.ticket === t.meta.id ? ref(t) : ref(c.mergedSources.find((source) => source.meta.id === m.ticket)!)}): ${m.body.trim().replace(/\s+/g, " ")}`,
        );
    }
    if (c.attachments.length) {
      lines.push("", "## Screenshots", "");
      for (const a of c.attachments) {
        const notes = a.annotations.filter((n) => !n.resolved);
        lines.push(
          `- ${a.name} (${a.width}×${a.height}, ${notes.length} open notes)` +
            (a.permanentlyDeletedAt
              ? ` — permanently deleted ${a.permanentlyDeletedAt}; local image and preview removed, written annotations retained`
              : a.referenceMissing
                ? " — screenshot metadata and local image are unavailable"
                : a.missing
                  ? " — image not present in this checkout"
                  : `: ${this.file(`assets/${a.id}/base.png`)}`),
        );
        for (const n of notes)
          lines.push(`  - ${n.id}: ${n.text || "(no written instruction)"}`);
      }
    }
    lines.push(
      "",
      "## Protocol",
      "",
      decisionProtocol,
      "",
      `Claim before working: \`controlroom claim ${t.meta.number ?? t.meta.id}\`. Record discoveries with \`controlroom comment ${t.meta.number ?? t.meta.id} --body ...\` and questions with \`controlroom ask\`. Submit with \`controlroom review ${t.meta.number ?? t.meta.id} --etag ${t.revision} --handoff ... --review-notes "Human review steps and expected results" --evidence ... --run "test command"\`. Moving agent work into Review posts the handoff, review steps, and evidence to the conversation. A human accepts work into Done, or an explicitly enabled managed orchestrator records an independent review receipt. Ordinary worker commands cannot accept Done.`,
    );
    const markdown = lines.join("\n") + "\n";
    return { markdown, tokens: Math.ceil(markdown.length / 4) };
  }
  updateConfig(revision: string, patch: Partial<Config>, actor?: Actor) {
    return this.write(() => {
      if ("orchestration" in patch && actor?.kind !== "human")
        throw new Problem(
          403,
          "Only a human can configure orchestrator authority",
        );
      const p = this.file("config.yml"),
        s = read(p);
      if (hash(s) !== revision) throw new Problem(409, "Configuration changed");
      const c = {
        ...this.config(),
        ...patch,
        schema: 1,
        projectId: this.config().projectId,
      };
      configSchema.parse(c);
      if (!c.name.trim()) throw new Problem(422, "Project name is required");
      if (
        !c.columns.length ||
        new Set(c.columns.map((v) => v.id)).size !== c.columns.length
      )
        throw new Problem(422, "Column IDs must be unique");
      for (const role of ["backlog", "selected", "progress", "review", "done"])
        if (!c.columns.some((v) => v.role === role))
          throw new Problem(422, `Keep a column with the ${role} role`);
      for (const col of c.columns)
        if (!/^[a-z0-9_-]+$/.test(col.id) || !col.name.trim())
          throw new Problem(422, "Invalid column");
      if (c.views && new Set(c.views.map((v) => v.id)).size !== c.views.length)
        throw new Problem(422, "View IDs must be unique");
      for (const r of this.list())
        if (
          r.meta.kind === "ticket" &&
          !c.columns.some((v) => v.id === r.meta.status)
        )
          throw new Problem(
            422,
            `Move tickets out of ${r.meta.status} before removing it`,
          );
      const before = this.config().orchestration;
      atomic(p, YAML.stringify(c));
      if ("orchestration" in patch)
        this.history(
          "project",
          actor!,
          "orchestration configured",
          before,
          patch.orchestration,
        );
      return c;
    });
  }
  reconcile(expectedBranch: string) {
    return this.write(() => {
      const current = branch(this.root);
      if (current !== expectedBranch)
        throw new Problem(409, "Branch changed again");
      const errors = this.state().errors;
      if (errors.length)
        throw new Problem(
          422,
          "Fix invalid records before reconciling",
          errors,
        );
      atomic(
        this.file(".local/branch.json"),
        JSON.stringify({ branch: current }),
      );
    }, true);
  }
  historyFor(id: string) {
    id = this.get(id).meta.id;
    const legacy = walk(this.file("records/history"), ".md").map((f) => {
      const s = parseMd(read(f));
      return { ...s.meta, body: s.body };
    });
    const file = this.file("records/history.jsonl");
    const lines = fs.existsSync(file)
      ? read(file)
          .split("\n")
          .filter(Boolean)
          .map((l) => {
            const e = JSON.parse(l);
            return {
              ...e,
              body:
                "```json\n" +
                JSON.stringify({ before: e.before, after: e.after }, null, 2) +
                "\n```\n",
            };
          })
      : [];
    return [...legacy, ...lines]
      .filter((e) => e.record === id)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }
}
