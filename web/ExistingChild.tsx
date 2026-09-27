import { useRef, useState } from "react";
import type { ProjectState, RecordFile } from "../src/types";
import { ParentInput } from "./ParentInput";
import { actor, api, recordId } from "./api";

export function ExistingChild({
  state,
  parentId,
  draftParent,
  saveParent,
  onSaved,
}: {
  state: ProjectState;
  parentId?: string;
  draftParent?: string;
  saveParent: () => Promise<RecordFile | false>;
  onSaved: () => Promise<void>;
}) {
  const [chosen, setChosen] = useState<RecordFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const excluded = new Set<string>(parentId ? [parentId] : []);
  let id = draftParent;
  while (id && !excluded.has(id)) {
    excluded.add(id);
    id = state.records.find((r) => r.meta.id === id)?.meta.parent ?? undefined;
  }
  const candidates = state.records.filter(
    (r) =>
      r.meta.kind === "ticket" &&
      !excluded.has(r.meta.id) &&
      !(parentId && r.meta.parent === parentId),
  );
  return (
    <div className="existing-child" inert={busy}>
      <ParentInput
        records={candidates}
        columns={state.config.columns}
        value={chosen?.meta.id ?? null}
        label="Attach existing ticket"
        emptyLabel="Search by title or #number"
        clearLabel="Clear existing ticket"
        onChange={(id) => {
          setChosen(state.records.find((r) => r.meta.id === id) ?? null);
          setError("");
        }}
      />
      {chosen && (
        <>
          <p className="help">
            {chosen.meta.parent
              ? `${recordId(chosen)} will move from ${state.records.find((r) => r.meta.id === chosen.meta.parent)?.meta.title ?? "its current parent"} to this parent.`
              : `${recordId(chosen)} will become a child of this ticket.`}
          </p>
          <button
            className="button"
            onClick={async () => {
              if (pending.current) return;
              pending.current = true;
              setBusy(true);
              setError("");
              try {
                const parent = await saveParent();
                if (!parent)
                  throw new Error(
                    "Save the parent successfully before attaching this ticket.",
                  );
                await api(`/records/${chosen.meta.id}`, "PATCH", {
                  revision: chosen.revision,
                  patch: { parent: parent.meta.id },
                  actor,
                });
                setChosen(null);
                await onSaved();
              } catch (e) {
                setError(String(e));
              } finally {
                pending.current = false;
                setBusy(false);
              }
            }}
          >
            {chosen.meta.parent ? "Move under this parent" : "Attach as child"}
          </button>
        </>
      )}
      {error && (
        <p className="banner error" role="alert">
          {error} Select the ticket again to load its latest revision.
        </p>
      )}
    </div>
  );
}
