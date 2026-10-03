import { useEffect, useState } from "react";
import type { RecordFile, ReviewBuild } from "../src/types";
import { actor, api, isRemoteBrowser } from "./api";

type BuildStatus = {
  build?: ReviewBuild;
  revision?: string;
  resolvedPath?: string;
  available: boolean;
  reason?: string;
};

export const reviewBuild = (record: RecordFile): ReviewBuild | undefined => {
  const value = record.meta.build;
  return value && typeof value === "object" && "path" in value
    ? (value as ReviewBuild)
    : undefined;
};

export const buildLabel = (build: ReviewBuild) =>
  build.label?.trim() ||
  build.path.split(/[\\/]/).filter(Boolean).at(-1) ||
  build.path;

export const buildSha = (build: ReviewBuild) =>
  build.sha ? build.sha.slice(0, 8) : undefined;

export function BuildRow({ record }: { record: RecordFile }) {
  const build = reviewBuild(record);
  const [status, setStatus] = useState<BuildStatus>();
  const [pending, setPending] = useState<"launch" | "reveal">();
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = async () => {
    setRefreshing(true);
    try {
      setStatus(await api<BuildStatus>(`/records/${record.meta.id}/build`));
    } catch (error) {
      setStatus({
        available: false,
        reason: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!build) return;
    let active = true;
    setStatus(undefined);
    setMessage("");
    void api<BuildStatus>(`/records/${record.meta.id}/build`)
      .then((next) => active && setStatus(next))
      .catch(
        (error) =>
          active &&
          setStatus({
            available: false,
            reason: error instanceof Error ? error.message : String(error),
          }),
      );
    return () => {
      active = false;
    };
  }, [record.meta.id, record.revision, build?.path, build?.at]);

  if (!build) return null;
  const currentBuild = status?.build ?? build;
  const stale = !!status?.revision && status.revision !== record.revision;
  const hostReason = isRemoteBrowser()
    ? "Build actions are available only from the local host."
    : undefined;
  const disabled =
    !!hostReason ||
    stale ||
    !status?.available ||
    !status.resolvedPath ||
    !!pending;
  const reason =
    hostReason ??
    (stale
      ? "Build metadata changed; reload this ticket before launching or revealing it."
      : status?.reason);
  const run = async (action: "launch" | "reveal") => {
    setPending(action);
    setMessage("");
    try {
      await api(`/records/${record.meta.id}/build/${action}`, "POST", {
        revision: record.revision,
        actor,
      });
      setMessage(
        action === "launch" ? "Build launched." : "Build revealed in Finder.",
      );
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(undefined);
    }
  };
  return (
    <section className="build-row" aria-label="Review build">
      <div className="build-row-heading">
        <strong>Build</strong>
        <span className="tag">{buildLabel(currentBuild)}</span>
        {buildSha(currentBuild) && (
          <code title={currentBuild.sha}>{buildSha(currentBuild)}</code>
        )}
      </div>
      <code className="build-path">
        {status?.resolvedPath ?? currentBuild.path}
      </code>
      <div className="inline-actions">
        <button
          className="button small"
          disabled={disabled}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void run("launch");
          }}
        >
          {pending === "launch" ? "Launching…" : "Launch"}
        </button>
        <button
          className="button subtle small"
          type="button"
          disabled={!!pending || refreshing}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void refresh();
          }}
        >
          {refreshing ? "Refreshing…" : "Refresh availability"}
        </button>
        <button
          className="button small"
          disabled={disabled}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void run("reveal");
          }}
        >
          {pending === "reveal" ? "Revealing…" : "Reveal"}
        </button>
      </div>
      <small
        className={message ? "build-message" : "muted"}
        role={message ? "status" : undefined}
      >
        {message ||
          reason ||
          (status
            ? status.available
              ? "Build is ready."
              : "Build is unavailable."
            : "Checking build availability…")}
      </small>
    </section>
  );
}
