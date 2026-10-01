import { applyTheme } from "./themes";
import { Agents } from "./Agents";
import { ticketFromUrl, ticketUrl } from "./ticketNavigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Kind, RecordFile } from "../src/types";
import { api, uploadImage } from "./api";
import { AnnotationEditor } from "./AnnotationEditor";
import { CaptureControl } from "./CaptureControl";
import { Imports } from "./Imports";
import { Insights } from "./Insights";
import { Feed } from "./Feed";
import {
  attentionReason,
  context,
  viewsOf,
  type AttentionReason,
} from "./model";
import { AttentionPage, KnowledgePage, PageHeader } from "./Pages";
import { ProjectPage } from "./ProjectPage";
import { Playbook } from "./Playbook";
import { RecordDetail } from "./RecordDetail";
import { ReviewQueue } from "./ReviewQueue";
import type { ReviewActionDraft } from "./ReviewActions";
import { Screenshots } from "./Screenshots";
import { Settings } from "./Settings";
import { Shortcuts } from "./Shortcuts";
import { Logo, PlusIcon } from "./Icons";
import { pages, themes, TopNav, type Page, type Theme } from "./TopNav";
import { useProjectState } from "./useProjectState";

const stored = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Preferences also persist in the project's runtime state. */
  }
};
// Earlier versions stored "board" or "list" as the page.
function fromPreference(value: unknown): { page?: Page; viewId?: string } {
  if (value === "board") return { page: "project", viewId: "board" };
  if (value === "list") return { page: "project", viewId: "table" };
  return pages.includes(value as Page) ? { page: value as Page } : {};
}

type AppHistoryState = {
  controlRoom: true;
  index: number;
  page: Page;
  viewId: string;
  selected: string | null;
  focusComment?: string;
  closeIndex?: number;
};

function locationPage() {
  const value = new URLSearchParams(location.search).get("page");
  return pages.includes(value as Page) ? (value as Page) : undefined;
}

function locationView() {
  return new URLSearchParams(location.search).get("view") ?? undefined;
}

function appUrl(state: Pick<AppHistoryState, "page" | "viewId" | "selected">) {
  const url = new URL(location.href);
  if (url.searchParams.get("ticketOnly") !== "1") {
    url.searchParams.set("page", state.page);
    if (state.page === "project") url.searchParams.set("view", state.viewId);
    else url.searchParams.delete("view");
  }
  url.hash = state.selected ? ticketUrl(state.selected) : "";
  return `${url.pathname}${url.search}${url.hash}`;
}

export function App() {
  const explicitLocation = useRef(!!(locationPage() || locationView()));
  const [createdRecord, setCreatedRecord] = useState<RecordFile | null>(null);
  const [standalone, setStandalone] = useState(
    () => new URLSearchParams(location.search).get("ticketOnly") === "1",
  );
  const [conversationOrder, setConversationOrder] = useState<
    "oldest" | "newest"
  >("oldest");
  const [page, setPage] = useState<Page>(
    () => locationPage() ?? fromPreference(stored("wb-page")).page ?? "project",
  );
  const [viewId, setViewIdState] = useState(
    () => locationView() ?? stored("wb-view-id") ?? "board",
  );
  const [density, setDensity] = useState(
    () => stored("wb-density") ?? "comfortable",
  );
  const [theme, setTheme] = useState<Theme>(() => {
    const t = stored("wb-theme");
    return themes.includes(t as Theme) ? (t as Theme) : "system";
  });
  const [selected, setSelectedState] = useState<string | null>(ticketFromUrl),
    [creating, setCreating] = useState<Kind | null>(null),
    [image, setImage] = useState<string | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [shortcuts, setShortcuts] = useState(false),
    [prefsReady, setPrefsReady] = useState(false),
    [knowledgeRead, setKnowledgeRead] = useState(0),
    [focusComment, setFocusComment] = useState<string | undefined>();
  const [reviewDrafts, setReviewDrafts] = useState<
    Record<string, ReviewActionDraft>
  >({});
  // A review pass is a sequence, not a "most recently edited" list. Keep the
  // IDs encountered when the reviewer opens the queue so saving an item (which
  // updates `updatedAt`) cannot make Next/Previous jump or revisit an item.
  const [reviewQueue, setReviewQueue] = useState<string[] | null>(null);
  const leaveGuard = useRef<null | (() => Promise<boolean>)>(null);
  const historyLocation = useRef<AppHistoryState | null>(null);
  const restoringHistoryIndex = useRef<number | null>(null);
  const handlingPop = useRef(false);
  const popGeneration = useRef(0);
  const queuedPop = useRef<AppHistoryState | null>(null);
  const unguardedPopIndex = useRef<number | null>(null);
  const { state, reload, loadError } = useProjectState();

  useEffect(() => {
    let active = true;
    api("/preferences")
      .then((p) => {
        if (!active) return;
        const legacy = fromPreference(p.page ?? p.view);
        if (!locationPage() && legacy.page) setPage(legacy.page);
        if (!locationView()) {
          if (typeof p.viewId === "string") setViewIdState(p.viewId);
          else if (legacy.viewId) setViewIdState(legacy.viewId);
        }
        if (["compact", "comfortable"].includes(p.density))
          setDensity(p.density);
        if (themes.includes(p.theme)) setTheme(p.theme);
        if (
          p.conversationOrder === "oldest" ||
          p.conversationOrder === "newest"
        )
          setConversationOrder(p.conversationOrder);
        if (
          !explicitLocation.current &&
          !standalone &&
          !ticketFromUrl() &&
          !location.hash &&
          p.selected
        )
          setSelectedState(p.selected);
        setKnowledgeRead(p.knowledgeRead ?? 0);
      })
      .catch(() => {})
      .finally(() => active && setPrefsReady(true));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!prefsReady || historyLocation.current) return;
    const existing = history.state as AppHistoryState | null;
    const initial: AppHistoryState = {
      controlRoom: true,
      index: existing?.controlRoom ? existing.index : 0,
      page,
      viewId,
      selected,
      focusComment,
    };
    history.replaceState(
      initial,
      "",
      location.hash.startsWith("#image=")
        ? `${location.pathname}${location.search}${location.hash}`
        : appUrl(initial),
    );
    historyLocation.current = initial;
  }, [prefsReady, page, viewId, selected, focusComment]);

  function applyLocation(next: AppHistoryState) {
    setPage(next.page);
    setViewIdState(next.viewId);
    setSelectedState(next.selected);
    setFocusComment(next.focusComment);
    setCreating(null);
  }

  function ensureHistoryLocation() {
    if (historyLocation.current) return historyLocation.current;
    const existing = history.state as AppHistoryState | null;
    const current: AppHistoryState = {
      controlRoom: true,
      index: existing?.controlRoom ? existing.index : 0,
      page,
      viewId,
      selected,
      focusComment,
    };
    history.replaceState(current, "", appUrl(current));
    historyLocation.current = current;
    return current;
  }

  async function pushLocation(
    patch: Partial<
      Pick<AppHistoryState, "page" | "viewId" | "selected" | "focusComment">
    >,
    skipGuard = false,
  ) {
    const current = ensureHistoryLocation();
    if (handlingPop.current) return false;
    const next: AppHistoryState = {
      ...current,
      ...patch,
      controlRoom: true,
      index: current.index + 1,
    };
    if (patch.selected !== undefined) {
      next.closeIndex = patch.selected
        ? (current.closeIndex ?? (current.selected ? undefined : current.index))
        : undefined;
    }
    if (
      next.page === current.page &&
      next.viewId === current.viewId &&
      next.selected === current.selected &&
      next.focusComment === current.focusComment
    )
      return true;
    if (!skipGuard && leaveGuard.current && !(await leaveGuard.current()))
      return false;
    history.pushState(next, "", appUrl(next));
    historyLocation.current = next;
    applyLocation(next);
    return true;
  }

  function setSelected(id: string | null, comment?: string, saved = false) {
    void pushLocation({ selected: id, focusComment: comment }, saved);
  }

  function setViewId(id: string) {
    void pushLocation({ page: "project", viewId: id, selected: null });
  }

  useEffect(() => {
    const pop = async (event: PopStateEvent) => {
      const popped = event.state as AppHistoryState | null;
      if (restoringHistoryIndex.current !== null) {
        const isCompensation =
          popped?.controlRoom && popped.index === restoringHistoryIndex.current;
        restoringHistoryIndex.current = null;
        if (isCompensation) return;
      }
      const current = historyLocation.current;
      const target = popped;
      if (!current || !target?.controlRoom) return;
      if (unguardedPopIndex.current === target.index) {
        unguardedPopIndex.current = null;
        historyLocation.current = target;
        applyLocation(target);
        return;
      }
      unguardedPopIndex.current = null;
      const generation = ++popGeneration.current;
      if (handlingPop.current) {
        queuedPop.current = target;
        return;
      }
      handlingPop.current = true;
      const allowed = !leaveGuard.current || (await leaveGuard.current());
      if (generation !== popGeneration.current) {
        const queued = queuedPop.current;
        queuedPop.current = null;
        if (queued && allowed) {
          historyLocation.current = queued;
          applyLocation(queued);
        } else if (queued) {
          restoringHistoryIndex.current = current.index;
          history.go(current.index - queued.index);
        }
        handlingPop.current = false;
        return;
      }
      if (allowed) {
        historyLocation.current = target;
        applyLocation(target);
      } else {
        restoringHistoryIndex.current = current.index;
        history.go(current.index - target.index);
      }
      handlingPop.current = false;
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);

  useEffect(() => {
    const hash = () => {
      if (location.hash.startsWith("#image=")) return;
      const current = historyLocation.current;
      if (!current || history.state?.controlRoom) return;
      const target: AppHistoryState = {
        ...current,
        index: current.index + 1,
        selected: ticketFromUrl(),
        focusComment: undefined,
      };
      history.replaceState(target, "", appUrl(target));
      void (async () => {
        if (leaveGuard.current && !(await leaveGuard.current())) {
          restoringHistoryIndex.current = current.index;
          history.back();
          return;
        }
        historyLocation.current = target;
        applyLocation(target);
      })();
    };
    window.addEventListener("hashchange", hash);
    return () => window.removeEventListener("hashchange", hash);
  }, []);
  useEffect(() => {
    if (!prefsReady) return;
    remember("wb-page", page);
    remember("wb-view-id", viewId);
    remember("wb-density", density);
    remember("wb-theme", theme);
    api("/preferences", "PATCH", {
      page,
      viewId,
      density,
      theme,
      selected,
      knowledgeRead,
      conversationOrder,
    }).catch(() => {});
  }, [
    page,
    viewId,
    density,
    theme,
    selected,
    knowledgeRead,
    conversationOrder,
    prefsReady,
  ]);
  // "System" follows prefers-color-scheme; an explicit choice overrides it.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const change = () => {
      const match = location.hash.match(/^#image=([\w-]+)$/);
      if (match) setImage(match[1]);
    };
    change();
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const upload = useRef(async (_file: File) => {});
  upload.current = async (file: File) => {
    // Opening another image would replace the editor and its unsaved marks.
    if (document.querySelector(".annotation-dialog[open]")) return;
    setError("");
    try {
      const a = await uploadImage(file);
      await reload();
      setImage(a.id);
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? []).find((f) =>
        f.type.startsWith("image/"),
      );
      if (file) {
        e.preventDefault();
        void upload.current(file);
      }
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (document.querySelector("dialog[open]") || e.repeat) return;
      const typing = (e.target as HTMLElement)?.closest(
        "input, textarea, select, [contenteditable=true]",
      );
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        document
          .querySelector<HTMLInputElement>(".filter-input input")
          ?.focus();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") {
        e.preventDefault();
        setShortcuts(true);
      } else if (e.key === "n") {
        e.preventDefault();
        setCreating("ticket");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const ctx = useMemo(() => (state ? context(state) : null), [state]);
  const attention = useMemo(() => {
    if (!state || !ctx) return [];
    return state.records
      .filter((r) => r.meta.kind === "ticket" && !r.meta.archived)
      .map((r) => [r, attentionReason(r, state, ctx)] as const)
      .filter((x): x is [(typeof x)[0], AttentionReason] => !!x[1]);
  }, [state, ctx]);
  const reviewRecords = useMemo(
    () =>
      (state?.records ?? [])
        .filter(
          (record) =>
            record.meta.kind === "ticket" &&
            !record.meta.archived &&
            state?.config.columns.find(
              (column) => column.id === record.meta.status,
            )?.role === "review",
        )
        .sort(
          (a, b) =>
            (a.meta.number ?? Number.MAX_SAFE_INTEGER) -
              (b.meta.number ?? Number.MAX_SAFE_INTEGER) ||
            a.meta.id.localeCompare(b.meta.id),
        ),
    [state],
  );
  const availableReviewIds = reviewRecords.map((record) => record.meta.id);
  const availableReviewKey = availableReviewIds.join("\u0000");
  useEffect(() => {
    if (page !== "review") {
      setReviewQueue(null);
      return;
    }
    // Retain the current pass in its original order. Items that leave review
    // disappear; newly submitted items join at the end for a later pass.
    setReviewQueue((previous) => {
      const available = new Set(availableReviewIds);
      const retained = (previous ?? []).filter((id) => available.has(id));
      const retainedIds = new Set(retained);
      return [
        ...retained,
        ...availableReviewIds.filter((id) => !retainedIds.has(id)),
      ];
    });
  }, [page, availableReviewKey]);

  if (!state || !ctx || !prefsReady)
    return (
      <main className="loading">
        <div className="brandmark">
          <Logo size={40} />
        </div>
        <h1>Opening your workspace</h1>
        {loadError ? (
          <p role="alert">{loadError}</p>
        ) : (
          <p>Reading project records…</p>
        )}
      </main>
    );
  const changedDocs = state.records.filter(
    (r) =>
      r.meta.kind !== "ticket" && Date.parse(r.meta.updatedAt) > knowledgeRead,
  );
  const active = selected
    ? (state.records.find((r) => r.meta.id === selected) ??
      (createdRecord?.meta.id === selected ? createdRecord : null))
    : null;
  const reviewQueueIds =
    page === "review"
      ? (reviewQueue ?? availableReviewIds)
      : availableReviewIds;
  const recordsById = new Map(
    reviewRecords.map((record) => [record.meta.id, record]),
  );
  const queuedReviewRecords = reviewQueueIds.flatMap((id) => {
    const record = recordsById.get(id);
    return record ? [record] : [];
  });
  const reviewPosition = active ? reviewQueueIds.indexOf(active.meta.id) : -1;
  const views = viewsOf(state);
  const currentViewId = views.some((v) => v.id === viewId)
    ? viewId
    : views[0].id;
  const go = (p: Page) => {
    void pushLocation({ page: p, selected: null, focusComment: undefined });
  };
  return (
    <div
      className={`app-shell ${density}${standalone ? " ticket-page" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          const file = Array.from(e.dataTransfer.files).find((f) =>
            f.type.startsWith("image/"),
          );
          if (file) void upload.current(file);
        }
      }}
    >
      {!standalone && (
        <TopNav
          name={state.config.name}
          branch={state.branch}
          page={page}
          attentionCount={
            attention.length +
            changedDocs.length +
            (state.agentConfigProposals?.length ?? 0)
          }
          reviewCount={reviewRecords.length}
          density={density}
          theme={theme}
          setPage={go}
          setDensity={setDensity}
          setTheme={setTheme}
          onCreate={setCreating}
          onUpload={(file) => void upload.current(file)}
          onShortcuts={() => setShortcuts(true)}
        />
      )}
      <main className="main-content">
        {loadError && (
          <div className="banner error" role="alert">
            <span>
              {loadError} Your displayed work is retained. Retrying
              automatically…
            </span>
            <button className="button" onClick={() => void reload()}>
              Reconnect now
            </button>
          </div>
        )}
        {error && (
          <div className="banner error" role="alert">
            <span>{error}</span>
            <button onClick={() => setError("")} aria-label="Dismiss error">
              ×
            </button>
          </div>
        )}
        {notice && (
          <div className="banner">
            <span>{notice}</span>
            <button onClick={() => setNotice("")} aria-label="Dismiss notice">
              ×
            </button>
          </div>
        )}
        {state.branchChanged && (
          <div className="banner error">
            The canonical checkout changed from {state.acknowledgedBranch} to{" "}
            {state.branch}. Writes are paused.
            <button className="button" onClick={() => go("settings")}>
              Review in Settings
            </button>
          </div>
        )}
        {state.errors.length > 0 && (
          <div className="banner error" role="alert">
            <div>
              <strong>
                {state.errors.length} record problems need attention
              </strong>
              {state.errors.map((e) => (
                <p key={e.path}>
                  {e.path}: {e.message}
                </p>
              ))}
            </div>
          </div>
        )}
        {standalone && !active && (
          <section className="list-panel">
            <h1>Ticket unavailable</h1>
            <p>This ticket could not be found in this project.</p>
            <a href="/">Control Room · Back to board</a>
          </section>
        )}
        {!standalone && (
          <>
            {page === "project" && (
              <ProjectPage
                state={state}
                ctx={ctx}
                viewId={currentViewId}
                setViewId={setViewId}
                onOpen={setSelected}
                onNewTicket={() => setCreating("ticket")}
                reload={reload}
                onError={setError}
                onNotice={setNotice}
                onCustomizeStatuses={() => go("settings")}
              />
            )}
            {page === "attention" && (
              <AttentionPage
                comments={state.comments}
                managedQuestions={state.managedQuestions}
                proposals={state.agentConfigProposals}
                onOpenAgents={() => go("agents")}
                items={attention}
                changedDocs={changedDocs}
                onOpen={setSelected}
                onMarkSeen={() => setKnowledgeRead(Date.now())}
              />
            )}
            {page === "feed" && (
              <Feed
                revision={state.revision}
                onOpen={(id, comment) => {
                  setSelected(id, comment);
                }}
              />
            )}
            {page === "review" && (
              <ReviewQueue records={queuedReviewRecords} open={setSelected} />
            )}
            {(page === "decisions" || page === "rulebook") && (
              <KnowledgePage
                key={page}
                kind={page === "decisions" ? "decision" : "rule"}
                state={state}
                onOpen={setSelected}
                onCreate={() =>
                  setCreating(page === "decisions" ? "decision" : "rule")
                }
                onImport={() => go("imports")}
              />
            )}
            {page === "screenshots" && (
              <>
                <CaptureControl>
                  <label className="button primary file-button">
                    <PlusIcon />
                    Add screenshot
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        if (e.target.files?.[0])
                          void upload.current(e.target.files[0]);
                      }}
                    />
                  </label>
                </CaptureControl>
                <Screenshots state={state} open={setImage} reload={reload} />
              </>
            )}
            {page === "insights" && <Insights state={state} ctx={ctx} />}
            {page === "agents" && (
              <Agents state={state} onOpen={setSelected} reload={reload} />
            )}
            {page === "playbook" && (
              <Playbook project={state.config.name} branch={state.branch} />
            )}
            {page === "imports" && (
              <>
                <PageHeader
                  title="Import project knowledge"
                  description="Turn existing notes into connected, reviewable project knowledge."
                />
                <Imports reload={reload} onError={setError} />
              </>
            )}
            {page === "settings" && (
              <>
                <PageHeader
                  title="Settings & backups"
                  description="Your project, its shared records, and local tools."
                />
                <Settings
                  state={state}
                  reload={reload}
                  onError={setError}
                  openImage={setImage}
                  onMoveTickets={() => {
                    void pushLocation({
                      page: "project",
                      viewId:
                        views.find((view) => view.layout === "board")?.id ??
                        views[0].id,
                      selected: null,
                    });
                  }}
                />
              </>
            )}
          </>
        )}
      </main>
      {(active || creating) && (
        <RecordDetail
          key={
            active
              ? `${active.meta.id}-${focusComment ?? "record"}`
              : `new-${creating}`
          }
          record={active ?? undefined}
          kind={creating ?? active!.meta.kind}
          state={state}
          standalone={standalone}
          reviewQueue={
            page === "review" && reviewPosition >= 0
              ? {
                  position: reviewPosition,
                  total: reviewQueueIds.length,
                  previous:
                    reviewPosition > 0
                      ? () => setSelected(reviewQueueIds[reviewPosition - 1])
                      : undefined,
                  next:
                    reviewPosition < reviewQueueIds.length - 1
                      ? () => setSelected(reviewQueueIds[reviewPosition + 1])
                      : undefined,
                }
              : undefined
          }
          reviewDraft={active ? reviewDrafts[active.meta.id] : undefined}
          onReviewDraft={(draft) => {
            if (!active) return;
            setReviewDrafts((drafts) => ({
              ...drafts,
              [active.meta.id]: draft,
            }));
          }}
          onReviewDone={
            page === "review" && reviewPosition >= 0
              ? (id) => {
                  setReviewDrafts((drafts) => {
                    const { [id]: _removed, ...rest } = drafts;
                    return rest;
                  });
                  const index = reviewQueueIds.indexOf(id);
                  const stillInReview = new Set(availableReviewIds);
                  setSelected(
                    reviewQueueIds
                      .slice(index + 1)
                      .find((candidate) => stillInReview.has(candidate)) ??
                      reviewQueueIds
                        .slice(0, index)
                        .reverse()
                        .find((candidate) => stillInReview.has(candidate)) ??
                      null,
                    undefined,
                    true,
                  );
                }
              : undefined
          }
          conversationOrder={conversationOrder}
          initialComment={focusComment}
          onConversationOrder={setConversationOrder}
          registerLeaveGuard={(guard) => {
            leaveGuard.current = guard;
          }}
          onClose={() => {
            if (creating) {
              setCreating(null);
              return;
            }
            if (standalone) {
              setStandalone(false);
              const next = {
                ...(historyLocation.current ?? {
                  controlRoom: true as const,
                  index: 0,
                  viewId,
                }),
                page: "project" as const,
                selected: null,
              };
              const url = new URL(location.href);
              url.searchParams.delete("ticketOnly");
              url.searchParams.set("page", "project");
              url.searchParams.set("view", next.viewId);
              url.hash = "";
              history.replaceState(next, "", `${url.pathname}${url.search}`);
              historyLocation.current = next;
              applyLocation(next);
            } else if (historyLocation.current?.closeIndex !== undefined) {
              unguardedPopIndex.current = historyLocation.current.closeIndex;
              history.go(
                historyLocation.current.closeIndex -
                  historyLocation.current.index,
              );
            } else {
              // RecordDetail has already saved, discarded, or verified a clean
              // draft before calling onClose. Do not invoke its guard again
              // while the save promise is still unwinding.
              void pushLocation(
                { selected: null, focusComment: undefined },
                true,
              );
            }
          }}
          onSaved={async () => {
            await reload();
            // The editor owns save/close behavior; refreshing never reopens it.
          }}
          onError={setError}
          openRecord={setSelected}
          openImage={setImage}
        />
      )}
      {image && (
        <AnnotationEditor
          // A new image gets a fresh editor: no marks or undo history carry over.
          key={image}
          id={image}
          state={state}
          onClose={() => {
            setImage(null);
            const current = historyLocation.current;
            if (current) history.replaceState(current, "", appUrl(current));
          }}
          reload={reload}
          onError={setError}
          onCreated={(record) => {
            setCreatedRecord(record);
            setImage(null);
            setCreating(null);
            setSelected(record.meta.id);
            void reload();
          }}
        />
      )}
      {shortcuts && (
        <Shortcuts
          capture={
            state.config.shortcut.mode === "hotkey"
              ? state.config.shortcut.label
              : "Double-tap Option / Alt"
          }
          onClose={() => setShortcuts(false)}
        />
      )}
    </div>
  );
}
