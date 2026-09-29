import type { RecordFile } from "../src/types";

export type BulkChanges = {
  status?: string;
  priority?: number;
  owner?: string;
  parent?: string | null;
  addLabels: string[];
  removeLabels: string[];
};

// Undefined means the selected tickets do not share a value. Null and empty
// strings are real shared values (no parent and no owner, respectively).
export function commonValue<T>(values: T[]): T | undefined {
  if (!values.length) return undefined;
  const first = values[0];
  return values.every((value) => Object.is(value, first)) ? first : undefined;
}

export function reconcileSelection(
  selected: ReadonlySet<string>,
  visible: ReadonlySet<string>,
) {
  return new Set([...selected].filter((id) => visible.has(id)));
}

export function bulkPatch(record: RecordFile, changes: BulkChanges) {
  const patch: Record<string, unknown> = {};
  if (changes.status !== undefined && record.meta.status !== changes.status)
    patch.status = changes.status;
  if (
    changes.priority !== undefined &&
    (record.meta.priority ?? 2) !== changes.priority
  )
    patch.priority = changes.priority;
  if (
    changes.owner !== undefined &&
    (record.meta.owner ?? "") !== changes.owner
  )
    patch.owner = changes.owner;
  if (
    changes.parent !== undefined &&
    (record.meta.parent ?? null) !== changes.parent
  )
    patch.parent = changes.parent;

  if (changes.addLabels.length || changes.removeLabels.length) {
    const remove = new Set(changes.removeLabels);
    const labels = [...(record.meta.labels ?? [])];
    for (const label of changes.addLabels)
      if (!labels.includes(label)) labels.push(label);
    const next = labels.filter((label) => !remove.has(label));
    if (JSON.stringify(next) !== JSON.stringify(record.meta.labels ?? []))
      patch.labels = next;
  }
  return patch;
}
