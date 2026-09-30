import fs from "node:fs";
import { z } from "zod";
import { atomic, hash, now, Problem, read, uid } from "./files.js";
import type { Actor, Annotation, Attachment } from "./types.js";
import type { Store } from "./store.js";

export type PermanentDeleteCandidate = { id: string; revision: string };
export type PermanentDeleteResult = {
  deleted: { id: string; name: string }[];
  failed: { id: string; name: string; error: string }[];
};

const coord = z.number().finite().min(0).max(1);
const annotationSchema = z.object({
  id: z.string().regex(/^[\w-]+$/),
  type: z.enum(["pin", "box", "arrow", "draw", "text"]),
  x: coord,
  y: coord,
  x2: coord.optional(),
  y2: coord.optional(),
  points: z
    .array(z.tuple([coord, coord]))
    .max(10000)
    .optional(),
  text: z.string().max(10000),
  resolved: z.boolean(),
  actor: z
    .object({ name: z.string(), kind: z.enum(["human", "agent"]) })
    .optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});
function png(data: string) {
  const raw = data.replace(/^data:image\/png;base64,/, "");
  if (raw.length > 40_000_000)
    throw new Problem(413, "Image is too large (maximum 30 MB)");
  const bytes = Buffer.from(raw, "base64");
  if (
    bytes.length < 24 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Problem(422, "Images must be normalized PNG files");
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (
    !width ||
    !height ||
    width > 16000 ||
    height > 16000 ||
    width * height > 60_000_000
  )
    throw new Problem(422, "Image dimensions exceed the supported size");
  return { bytes, width, height };
}
export function addImage(store: Store, name: string, data: string) {
  return store.write(() => {
    const { bytes, width, height } = png(data);
    const id = uid("image");
    const a = {
      id,
      name: name.slice(0, 300),
      hash: hash(bytes),
      width,
      height,
      mime: "image/png",
      annotations: [],
      createdAt: now(),
    };
    atomic(store.file(`assets/${id}/base.png`), bytes);
    atomic(
      store.file(`records/attachments/${id}.json`),
      JSON.stringify(a, null, 2),
    );
    return store.attachment(id);
  });
}
export function trashImage(
  store: Store,
  id: string,
  revision: string,
  trashed: boolean,
  actor: Actor,
) {
  return store.write(() => {
    const a = store.attachment(id);
    if (a.permanentlyDeletedAt)
      throw new Problem(409, "Screenshot was permanently deleted.");
    if (a.revision !== revision)
      throw new Problem(
        409,
        "Screenshot changed. Reload before deleting or restoring.",
      );
    z.boolean().parse(trashed);
    const { revision: _, missing: __, ...result } = a;
    if (trashed) {
      result.trashedAt = now();
      result.trashedBy = actor;
    } else {
      delete result.trashedAt;
      delete result.trashedBy;
    }
    atomic(
      store.file(`records/attachments/${id}.json`),
      JSON.stringify(result, null, 2),
    );
    return store.attachment(id);
  });
}

// Pixels are local/ignored while attachment JSON and written instructions are
// durable/Git-tracked. Permanent deletion therefore keeps a tombstone in the
// existing attachment record instead of rewriting every ticket/comment link.
// That makes old prose safe to render and lets backups consistently contain
// either the original pixels (made before deletion) or the tombstone (after).
export function deleteImagesPermanently(
  store: Store,
  candidates: PermanentDeleteCandidate[],
  actor: Actor,
): Promise<PermanentDeleteResult> {
  return store.write(() => {
    const input = z
      .array(
        z.object({
          id: z.string().regex(/^image-[\w-]+$/),
          revision: z.string().min(1).max(200),
        }),
      )
      .min(1)
      .max(10000)
      .parse(candidates);
    if (new Set(input.map((candidate) => candidate.id)).size !== input.length)
      throw new Problem(422, "Each screenshot may be deleted only once");

    const result: PermanentDeleteResult = { deleted: [], failed: [] };
    for (const candidate of input) {
      let attachment: Attachment;
      let assetsRemoved = false;
      try {
        attachment = store.attachment(candidate.id);
      } catch {
        result.failed.push({
          id: candidate.id,
          name: candidate.id,
          error: "Screenshot record is unavailable.",
        });
        continue;
      }
      const fail = (error: string) =>
        result.failed.push({
          id: attachment.id,
          name: attachment.name,
          error,
        });
      if (attachment.permanentlyDeletedAt) {
        fail("Screenshot was already permanently deleted.");
        continue;
      }
      if (!attachment.trashedAt) {
        fail("Screenshot is no longer in Trash.");
        continue;
      }
      if (attachment.revision !== candidate.revision) {
        fail("Screenshot changed after the confirmation preview opened.");
        continue;
      }

      try {
        // Remove every local derivative under the attachment's asset folder.
        // Missing files are an already-reclaimed state and are safe to record.
        const assetDirectory = store.file(`assets/${attachment.id}`);
        if (fs.existsSync(assetDirectory))
          fs.rmSync(assetDirectory, { recursive: true });
        assetsRemoved = true;
        const {
          revision: _,
          missing: __,
          referenceMissing: ___,
          ...record
        } = attachment;
        atomic(
          store.file(`records/attachments/${attachment.id}.json`),
          JSON.stringify(
            {
              ...record,
              permanentlyDeletedAt: now(),
              permanentlyDeletedBy: actor,
            },
            null,
            2,
          ),
        );
        result.deleted.push({ id: attachment.id, name: attachment.name });
      } catch (error) {
        fail(
          assetsRemoved
            ? `Local image files were removed, but recording permanent deletion failed. Written annotations remain. Inspect this item and confirm again to finish its deletion record: ${String(error)}`
            : `Local deletion failed and may have removed some files. Inspect this item before confirming again: ${String(error)}`,
        );
      }
    }
    return result;
  });
}
export function saveAnnotations(
  store: Store,
  id: string,
  revision: string,
  annotations: Annotation[],
  preview: string | undefined,
  actor: Actor,
) {
  return store.write(() => {
    const a = store.attachment(id);
    if (a.revision !== revision)
      throw new Problem(409, "Annotations changed. Reload before saving.");
    if (a.permanentlyDeletedAt)
      throw new Problem(409, "Screenshot was permanently deleted.");
    if (a.trashedAt)
      throw new Problem(
        409,
        "Screenshot is in Trash. Restore it before editing.",
      );
    const validated = z.array(annotationSchema).max(500).parse(annotations);
    if (new Set(validated.map((v) => v.id)).size !== validated.length)
      throw new Problem(422, "Annotation IDs must be unique");
    for (const v of validated) {
      if (
        ["box", "arrow"].includes(v.type) &&
        (v.x2 === undefined || v.y2 === undefined)
      )
        throw new Problem(422, "Region and arrow endpoints are required");
      if (v.type === "draw" && !v.points?.length)
        throw new Problem(422, "Drawing needs points");
    }
    let rendered: Buffer | undefined;
    if (preview) {
      const p = png(preview);
      if (p.width !== a.width || p.height !== a.height)
        throw new Problem(
          422,
          "Preview dimensions must match the source image",
        );
      rendered = p.bytes;
    }
    const { revision: _, missing: __, ...base } = a;
    const result = {
      ...base,
      annotations: validated,
      updatedAt: now(),
      updatedBy: actor,
    };
    atomic(
      store.file(`records/attachments/${id}.json`),
      JSON.stringify(result, null, 2),
    );
    if (rendered) atomic(store.file(`assets/${id}/preview.png`), rendered);
    else {
      const p = store.file(`assets/${id}/preview.png`);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    atomic(
      store.file(`records/attachments/${id}.md`),
      `# ${a.name}\n\nImage: ${id} (${a.width} × ${a.height}), SHA-256 ${a.hash}\n\n` +
        validated
          .map(
            (n, i) =>
              `## A${i + 1} — ${n.id}${n.resolved ? " (resolved)" : ""}\n\n${n.text || "(No written instruction)"}\n\nType: ${n.type}; normalized region: (${n.x}, ${n.y})${n.x2 !== undefined ? ` → (${n.x2}, ${n.y2})` : ""}.\n`,
          )
          .join("\n"),
    );
    return store.attachment(id);
  });
}
export function imageContext(store: Store, a: Attachment) {
  const validId = /^image-[\w-]+$/.test(a.id);
  return {
    ...a,
    basePath:
      !validId || a.missing || a.permanentlyDeletedAt
        ? null
        : store.file(`assets/${a.id}/base.png`),
    previewPath:
      validId &&
      !a.permanentlyDeletedAt &&
      fs.existsSync(store.file(`assets/${a.id}/preview.png`))
        ? store.file(`assets/${a.id}/preview.png`)
        : null,
    instructionsPath:
      validId && fs.existsSync(store.file(`records/attachments/${a.id}.md`))
        ? store.file(`records/attachments/${a.id}.md`)
        : null,
  };
}
