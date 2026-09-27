import { ticketFromUrl, ticketUrl } from "./ticketNavigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Kind, RecordFile } from "../src/types";
import { api, uploadImage } from "./api";
import { AnnotationEditor } from "./AnnotationEditor";
import { CaptureControl } from "./CaptureControl";
import { Imports } from "./Imports";
import { Insights } from "./Insights";
import {
  attentionReason,
  context,
  viewsOf,
  type AttentionReason,
} from "./model";
import { AttentionPage, KnowledgePage, PageHeader } from "./Pages";
import { ProjectPage } from "./ProjectPage";
import { RecordDetail } from "./RecordDetail";
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

export function App() {
  const [createdRecord, setCreatedRecord] = useState<RecordFile | null>(null);
  const [standalone, setStandalone] = useState(
    () => new URLSearchParams(location.search).get("ticketOnly") === "1",
  );
  const [conversationOrder, setConversationOrder] = useState<
    "oldest" | "newest"
  >("oldest");
  const [page, setPage] = useState<Page>(
    () => fromPreference(stored("wb-page")).page ?? "project",
  );
  const [viewId, setViewId] = useState(() => stored("wb-view-id") ?? "board");
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
    [knowledgeRead, setKnowledgeRead] = useState(0);
  const { state, reload, loadError } = useProjectState();
  function setSelected(id: string | null) {
    setSelectedState(id);
    history.replaceState(
      null,
      "",
      location.pathname + location.search + (id ? ticketUrl(id) : ""),
    );
  }
  useEffect(() => {
    const change = () => {
      if (!location.hash.startsWith("#image=")) {
        setSelectedState(ticketFromUrl());
        setCreating(null);
      }
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);

  useEffect(() => {
    let active = true;
    api("/preferences")
      .then((p) => {
        if (!active) return;
        const legacy = fromPreference(p.page ?? p.view);
        if (legacy.page) setPage(legacy.page);
        if (typeof p.viewId === "string") setViewId(p.viewId);
        else if (legacy.viewId) setViewId(legacy.viewId);
        if (["compact", "comfortable"].includes(p.density))
          setDensity(p.density);
        if (themes.includes(p.theme)) setTheme(p.theme);
        if (
          p.conversationOrder === "oldest" ||
          p.conversationOrder === "newest"
        )
          setConversationOrder(p.conversationOrder);
        if (!standalone && !ticketFromUrl() && !location.hash && p.selected)
          setSelected(p.selected);
        setKnowledgeRead(p.knowledgeRead ?? 0);
      })
      .catch(() => {})
      .finally(() => active && setPrefsReady(true));
    return () => {
      active = false;
    };
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
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
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
  const views = viewsOf(state);
  const currentViewId = views.some((v) => v.id === viewId)
    ? viewId
    : views[0].id;
  const go = (p: Page) => {
    setPage(p);
    setSelected(null);
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
          attentionCount={attention.length + changedDocs.length}
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
              />
            )}
            {page === "attention" && (
              <AttentionPage
                items={attention}
                changedDocs={changedDocs}
                onOpen={setSelected}
                onMarkSeen={() => setKnowledgeRead(Date.now())}
              />
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
                />
              </>
            )}
          </>
        )}
      </main>
      {(active || creating) && (
        <RecordDetail
          key={active?.meta.id ?? `new-${creating}`}
          record={active ?? undefined}
          kind={creating ?? active!.meta.kind}
          state={state}
          standalone={standalone}
          conversationOrder={conversationOrder}
          onConversationOrder={setConversationOrder}
          onClose={() => {
            if (standalone) {
              setStandalone(false);
              setPage("project");
              history.replaceState(null, "", location.pathname);
            }
            setSelected(null);
            setCreating(null);
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
            history.replaceState(null, "", location.pathname);
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
