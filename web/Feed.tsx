import { useEffect, useMemo, useRef, useState } from "react";
import type {
  FeedEntry,
  FeedEventType,
  FeedPage,
  FeedRecordReference,
} from "../src/types";
import { ago, api } from "./api";
import {
  ArrowUpIcon,
  BookIcon,
  CheckIcon,
  CommentIcon,
  DecisionIcon,
  ProjectIcon,
  QuestionIcon,
} from "./Icons";
import { PageHeader } from "./Pages";

const eventLabels: Record<FeedEventType, string> = {
  created: "Created",
  transition: "Status change",
  edit: "Edit",
  comment: "Comment",
  question: "Question",
  review: "Review",
  handoff: "Handoff",
  decision: "Decision",
  rule: "Rule",
  archive: "Archive",
};

function EventIcon({ type }: { type: FeedEventType }) {
  if (type === "comment" || type === "handoff") return <CommentIcon />;
  if (type === "question") return <QuestionIcon />;
  if (type === "review") return <CheckIcon />;
  if (type === "decision") return <DecisionIcon />;
  if (type === "rule") return <BookIcon />;
  return <ProjectIcon />;
}

const recordLabel = (record: FeedRecordReference) =>
  record.kind === "ticket" && record.number !== undefined
    ? `#${record.number} ${record.title}`
    : record.title;

function mergeFresh(fresh: FeedEntry[], current: FeedEntry[]) {
  const freshSources = new Set(fresh.flatMap((entry) => entry.sourceIds));
  return [
    ...fresh,
    ...current.filter(
      (entry) => !entry.sourceIds.some((id) => freshSources.has(id)),
    ),
  ].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
}

export function Feed({
  revision,
  onOpen,
}: {
  revision: string;
  onOpen: (record: string, comment?: string) => void;
}) {
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [facets, setFacets] = useState<FeedPage["facets"]>({
    actors: [],
    eventTypes: [],
    tickets: [],
  });
  const [actor, setActor] = useState("");
  const [eventType, setEventType] = useState("");
  const [ticket, setTicket] = useState("");
  const [cursor, setCursor] = useState<string>();
  const [hasMore, setHasMore] = useState(false);
  const [pending, setPending] = useState<FeedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const requestVersion = useRef(0);
  const filters = useMemo(
    () => ({ actor, eventType, ticket }),
    [actor, eventType, ticket],
  );
  const url = (nextCursor?: string) => {
    const query = new URLSearchParams({ limit: "30" });
    if (filters.actor) query.set("actor", filters.actor);
    if (filters.eventType) query.set("type", filters.eventType);
    if (filters.ticket) query.set("ticket", filters.ticket);
    if (nextCursor) query.set("cursor", nextCursor);
    return `/feed?${query}`;
  };

  // A filter change is a new result set, while a project revision is a live
  // refresh of the current one. Live entries wait behind an indicator unless
  // the reader is already at the top.
  useEffect(() => {
    const version = ++requestVersion.current;
    initialized.current = false;
    setLoading(true);
    setPending([]);
    api<FeedPage>(url())
      .then((page) => {
        if (version !== requestVersion.current) return;
        setEntries(page.entries);
        setFacets(page.facets);
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
        setError("");
        initialized.current = true;
      })
      .catch((e) => version === requestVersion.current && setError(String(e)))
      .finally(() => version === requestVersion.current && setLoading(false));
  }, [filters]);

  useEffect(() => {
    if (!initialized.current) return;
    const version = requestVersion.current;
    api<FeedPage>(url())
      .then((page) => {
        if (version !== requestVersion.current) return;
        setFacets(page.facets);
        const known = new Set(entries.flatMap((entry) => entry.sourceIds));
        const incoming = page.entries.filter((entry) =>
          entry.sourceIds.some((id) => !known.has(id)),
        );
        if (!incoming.length) return;
        if ((scroller.current?.scrollTop ?? 0) < 8) {
          setEntries((current) => mergeFresh(page.entries, current));
          scroller.current?.scrollTo({ top: 0 });
        } else {
          setPending((current) => mergeFresh(incoming, current));
        }
      })
      .catch((e) => setError(String(e)));
  }, [revision]);

  const showPending = () => {
    setEntries((current) => mergeFresh(pending, current));
    setPending([]);
    scroller.current?.scrollTo({ top: 0, behavior: "smooth" });
  };
  const loadOlder = async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const page = await api<FeedPage>(url(cursor));
      setEntries((current) => mergeFresh(current, page.entries));
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setFacets(page.facets);
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="feed-page">
      <PageHeader
        title="Feed"
        description="Newest-first activity across tickets and project knowledge."
      />
      <div className="feed-filters" aria-label="Feed filters">
        <label>
          Actor
          <select
            value={actor}
            onChange={(event) => setActor(event.target.value)}
          >
            <option value="">Everyone</option>
            {facets.actors.map((item) => (
              <option
                key={`${item.kind}:${item.name}`}
                value={`${item.kind}:${item.name}`}
              >
                {item.name} ({item.kind})
              </option>
            ))}
          </select>
        </label>
        <label>
          Event type
          <select
            value={eventType}
            onChange={(event) => setEventType(event.target.value)}
          >
            <option value="">All activity</option>
            {facets.eventTypes.map((type) => (
              <option key={type} value={type}>
                {eventLabels[type]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Related record
          <select
            value={ticket}
            onChange={(event) => setTicket(event.target.value)}
          >
            <option value="">All records</option>
            {facets.tickets.map((item) => (
              <option key={item.id} value={item.id}>
                {recordLabel(item)}
                {item.archived ? " (archived)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      <div className="feed-scroll" ref={scroller}>
        {pending.length > 0 && (
          <button className="feed-updates button primary" onClick={showPending}>
            <ArrowUpIcon />
            {pending.length} new {pending.length === 1 ? "update" : "updates"}
          </button>
        )}
        <div className="feed-list" aria-live="polite">
          {entries.map((entry) => (
            <button
              className="feed-entry"
              key={entry.id}
              data-event-type={entry.eventType}
              disabled={entry.record.missing}
              onClick={() => onOpen(entry.record.id, entry.commentId)}
              title={
                entry.record.missing
                  ? "The referenced record is unavailable"
                  : `Open ${recordLabel(entry.record)}`
              }
            >
              <span className="feed-icon" aria-hidden>
                <EventIcon type={entry.eventType} />
              </span>
              <span className="feed-entry-body">
                <span className="feed-entry-heading">
                  <strong>{entry.actor.name}</strong>
                  <span className="tag">{eventLabels[entry.eventType]}</span>
                  {entry.groupedCount && (
                    <span className="tag">{entry.groupedCount} edits</span>
                  )}
                  <time
                    dateTime={entry.at}
                    title={new Date(entry.at).toLocaleString()}
                  >
                    {ago(entry.at)}
                  </time>
                </span>
                <span className="feed-record">
                  {recordLabel(entry.record)}
                  {entry.record.archived && (
                    <span className="tag">Archived</span>
                  )}
                  {entry.record.missing && (
                    <span className="tag danger">Unavailable</span>
                  )}
                </span>
                <span className="feed-summary">{entry.summary}</span>
              </span>
            </button>
          ))}
          {!entries.length && !loading && (
            <p className="list-empty">No activity matches these filters.</p>
          )}
        </div>
        {hasMore && (
          <button
            className="button feed-more"
            disabled={loading}
            onClick={() => void loadOlder()}
          >
            {loading ? "Loading…" : "Load older activity"}
          </button>
        )}
      </div>
    </section>
  );
}
