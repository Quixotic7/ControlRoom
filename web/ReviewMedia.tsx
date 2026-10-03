import { useEffect, useState } from "react";
import type { ReviewMediaContext } from "../src/types";
import { api } from "./api";

export function ReviewMedia({
  ticket,
  revision,
  openImage,
}: {
  ticket: string;
  revision: string;
  openImage: (id: string) => void;
}) {
  const [media, setMedia] = useState<ReviewMediaContext[] | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [failed, setFailed] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let active = true;
    setFailed(new Set());
    void api<{ media?: ReviewMediaContext[] }>(`/records/${ticket}/context`)
      .then((context) => {
        if (!active) return;
        setMedia(context.media ?? []);
        setError("");
      })
      .catch(() => {
        if (!active) return;
        setMedia([]);
        setError("Review media could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [ticket, revision, reload]);

  if (error)
    return (
      <section className="review-media" aria-label="Review media">
        <h4>Review media</h4>
        <p className="review-media-missing">
          {error}{" "}
          <button onClick={() => setReload((value) => value + 1)}>Retry</button>
        </p>
      </section>
    );
  if (!media?.length) return null;
  const groups = Array.from(
    media.reduce((all, item) => {
      const group = all.get(item.source.id) ?? {
        source: item.source,
        items: [] as ReviewMediaContext[],
      };
      group.items.push(item);
      all.set(item.source.id, group);
      return all;
    }, new Map<string, { source: ReviewMediaContext["source"]; items: ReviewMediaContext[] }>()),
  ).map(([, group]) => group);

  return (
    <section className="review-media" aria-label="Review media">
      <h4>Review media</h4>
      {groups.map(({ source, items }) => (
        <section className="review-media-source" key={source.id}>
          <p className="muted">
            {source.id === ticket
              ? "Attached to this ticket"
              : source.number === undefined
                ? `From merged source: ${source.title}`
                : `From merged #${source.number}: ${source.title}`}
          </p>
          <div className="review-media-images">
            {items
              .filter((item) => item.kind === "image")
              .map((item) =>
                item.missing || failed.has(item.id) ? (
                  <span className="review-media-missing" key={item.id}>
                    Image unavailable locally · {item.name}
                    {item.caption && <small>{item.caption}</small>}
                  </span>
                ) : (
                  <figure key={item.id}>
                    <button
                      className="review-media-image"
                      onClick={() => openImage(item.id)}
                      aria-label={`Open review image ${item.name}`}
                    >
                      <img
                        src={`/api/images/${item.id}/base`}
                        alt={item.name}
                        onError={() =>
                          setFailed((value) => new Set(value).add(item.id))
                        }
                      />
                    </button>
                    <figcaption>{item.caption || item.name}</figcaption>
                  </figure>
                ),
              )}
          </div>
          <div className="review-media-audio">
            {items
              .filter((item) => item.kind === "audio")
              .map((item) =>
                item.missing || failed.has(item.id) ? (
                  <span className="review-media-missing" key={item.id}>
                    Audio unavailable locally · {item.name}
                    {item.caption && <small>{item.caption}</small>}
                  </span>
                ) : (
                  <div className="review-audio" key={item.id}>
                    <strong>{item.name}</strong>
                    {item.caption && <span>{item.caption}</span>}
                    <audio
                      controls
                      preload="metadata"
                      aria-label={`Review audio ${item.name}`}
                      src={`/api/media/${item.id}/base`}
                      onError={() =>
                        setFailed((value) => new Set(value).add(item.id))
                      }
                    />
                  </div>
                ),
              )}
          </div>
        </section>
      ))}
    </section>
  );
}
