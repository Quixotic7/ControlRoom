import React from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { uploadImage } from "./api";

// Pasted screenshots are written into Markdown as a thumbnail that links to
// the annotation editor, so the record stays a readable Markdown file:
//   [![Screenshot](/api/images/ID/base)](#image=ID)
const imageLink = /^#image=([\w-]+)$/;
const baseImage = /^\/api\/images\/([\w-]+)\/base$/;
export const imageMarkdown = (id: string, name = "Screenshot") =>
  `[![${name.replace(/[[\]]/g, "")}](/api/images/${id}/base)](#image=${id})`;

// Renders record Markdown; image links open the annotation editor in place.
export function RecordMarkdown({
  children,
  openImage,
  gfm = true,
}: {
  children: string;
  openImage?: (id: string) => void;
  gfm?: boolean;
}) {
  return (
    <Markdown
      remarkPlugins={gfm ? [remarkGfm] : []}
      skipHtml
      components={{
        a: ({ href, children: inner }) => {
          const id = href?.match(imageLink)?.[1];
          if (id && openImage)
            return (
              <button
                type="button"
                className="inline-image"
                title="Open to annotate"
                onClick={() => openImage(id)}
              >
                {inner}
              </button>
            );
          return (
            <a href={href} target="_blank" rel="noreferrer">
              {inner}
            </a>
          );
        },
        img: ({ src, alt }) => {
          const id = typeof src === "string" ? src.match(baseImage)?.[1] : null;
          // Prefer the annotated preview; fall back to the base image.
          if (id)
            return (
              <img
                src={`/api/images/${id}/preview`}
                alt={alt ?? "Screenshot"}
                loading="lazy"
                onError={(e) => {
                  const img = e.currentTarget;
                  if (!img.src.endsWith("/base")) img.src = src as string;
                }}
              />
            );
          return <img src={src} alt={alt ?? ""} loading="lazy" />;
        },
      }}
    >
      {children}
    </Markdown>
  );
}

// Handles an image pasted into a Markdown textarea: inserts a placeholder at
// the caret, uploads the image, then swaps in the thumbnail link. Returns the
// new attachment id, or null when the clipboard held no image.
export async function pasteImage(
  e: React.ClipboardEvent<HTMLTextAreaElement>,
  update: (transform: (text: string) => string) => void,
): Promise<string | null> {
  const file = Array.from(e.clipboardData.files).find((f) =>
    f.type.startsWith("image/"),
  );
  if (!file) return null;
  e.preventDefault();
  e.stopPropagation(); // The app-wide paste handler would open the editor.
  const area = e.currentTarget;
  const placeholder = `![Uploading ${file.name || "image"}…]()`;
  const at = area.selectionStart,
    end = area.selectionEnd;
  // Give the thumbnail its own paragraph unless the caret is on a blank line.
  update((text) => {
    const before = text.slice(0, at),
      after = text.slice(end);
    const lead = before && !/\n\s*$/.test(before) ? "\n\n" : "";
    const trail = after && !/^\s*\n/.test(after) ? "\n\n" : "";
    return before + lead + placeholder + trail + after;
  });
  try {
    const a = await uploadImage(file);
    const link = imageMarkdown(a.id, a.name ?? file.name);
    update((text) => text.replace(placeholder, link));
    return a.id;
  } catch (err) {
    update((text) => text.replace(placeholder, ""));
    throw err;
  }
}
