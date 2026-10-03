import fs from "node:fs";
import path from "node:path";

export type LocalReviewMedia = { path: string; caption?: string };
const maxBytes = 10 * 1024 * 1024;

// Prefer a literal existing filename, including colons. The explicit attach
// --caption option and MCP's separate fields also support ambiguous filenames.
export function parseReviewMedia(value: string, cwd: string): LocalReviewMedia {
  if (fs.existsSync(path.resolve(cwd, value))) return { path: value };
  const match = /^(.*?\.(?:png|wav|m4a|aac)):(.*)$/is.exec(value);
  return match ? { path: match[1], caption: match[2] } : { path: value };
}

export function readReviewMedia(files: LocalReviewMedia[], cwd: string) {
  if (files.length > 8)
    throw new Error("At most 8 review media files per ticket");
  return files.map((file) => {
    if (!file.path?.trim()) throw new Error("Provide a review media file path");
    const resolved = path.resolve(cwd, file.path);
    if (!/\.(png|wav|m4a|aac)$/i.test(resolved))
      throw new Error("Review media must be PNG, WAV, M4A or AAC files");
    if (
      file.caption !== undefined &&
      (typeof file.caption !== "string" || file.caption.length > 2000)
    )
      throw new Error("Media captions must contain at most 2000 characters");
    const stat = fs.statSync(resolved);
    if (!stat.isFile())
      throw new Error(`Review media is not a file: ${file.path}`);
    if (stat.size > maxBytes)
      throw new Error(`Review media exceeds 10 MB: ${file.path}`);
    // Check again after the read: a concurrently growing file must not escape
    // the upload bound merely because its earlier stat was smaller.
    const bytes = fs.readFileSync(resolved);
    if (bytes.length > maxBytes)
      throw new Error(`Review media exceeds 10 MB: ${file.path}`);
    return {
      name: path.basename(resolved),
      data: bytes.toString("base64"),
      ...(file.caption === undefined ? {} : { caption: file.caption }),
    };
  });
}
