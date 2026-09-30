import { useState } from "react";
import type { Attachment } from "../src/types";

export function ImageThumbnail({ image }: { image: Attachment }) {
  const [fallback, setFallback] = useState(false);
  const [failed, setFailed] = useState(false);
  if (image.permanentlyDeletedAt)
    return (
      <span className="screenshot-missing">
        Screenshot permanently deleted · written annotations preserved
      </span>
    );
  if (image.missing || failed)
    return (
      <span className="screenshot-missing">
        Image unavailable locally · annotations preserved
      </span>
    );
  return (
    <img
      src={`/api/images/${image.id}/${fallback ? "base" : "preview"}?v=${image.revision}`}
      alt={image.name}
      loading="lazy"
      draggable={false}
      onError={() => (fallback ? setFailed(true) : setFallback(true))}
    />
  );
}
