import { createHash } from "node:crypto";
import type { ProjectState } from "./types.js";

/** A compact read receipt for chat refreshes; no claims or record writes. */
export function boardSnapshot(state: ProjectState) {
  const digest = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  return {
    canonical: state.canonical,
    branch: state.branch,
    branchChanged: state.branchChanged,
    revision: state.revision,
    workflow: state.config.columns,
    errors: state.errors,
    tickets: state.records
      .filter((record) => record.meta.kind === "ticket")
      .map(({ meta, revision }) => {
        const comments = state.comments
          .filter((comment) => comment.ticket === meta.id)
          .sort((a, b) => a.id.localeCompare(b.id));
        return {
          id: meta.id,
          number: meta.number,
          title: meta.title,
          status: meta.status,
          archived: !!meta.archived,
          parent: meta.parent,
          scopeApproved: !!meta.scopeApproved,
          priority: meta.priority,
          owner: meta.owner,
          blocked: meta.blocked,
          question: meta.question,
          build: meta.build,
          media: meta.media,
          updatedAt: meta.updatedAt,
          revision,
          conversationRevision: digest(
            comments.map((comment) => [comment.id, comment.revision]),
          ),
          commentCount: comments.length,
          openQuestions: comments
            .filter(
              (comment) => comment.kind === "question" && !comment.resolved,
            )
            .map((comment) => comment.id),
          claims: state.claims.filter((claim) => claim.ticket === meta.id),
        };
      })
      .sort(
        (a, b) =>
          (a.number ?? Infinity) - (b.number ?? Infinity) ||
          a.id.localeCompare(b.id),
      ),
  };
}
