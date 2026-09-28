import type { Actor, RecordFile } from "../src/types";
export const actor: Actor = { name: "You", kind: "human" };
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: any,
  ) {
    super(message);
  }
}
export class ConnectionError extends Error {
  constructor(public method: string) {
    super(
      method === "GET"
        ? "Couldn't reach Control Room's local service. Check that it is running, then try again."
        : "Couldn't confirm the change with Control Room's local service. It may have completed; check the current result before trying again.",
    );
  }
  override toString() {
    return this.message;
  }
}
export async function api<T = any>(
  url: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const body = data === undefined ? undefined : JSON.stringify(data);
  // A read can safely recover from a dropped local connection. Never replay
  // writes: the server may have committed them before the response was lost.
  const attempts = method === "GET" ? 3 : 1;
  let res!: Response, text!: string;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = method === "GET" ? new AbortController() : undefined;
    const timer = controller
      ? setTimeout(() => controller.abort(), 8000)
      : undefined;
    try {
      res = await fetch("/api" + url, {
        method,
        keepalive: url === "/preferences",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller?.signal,
      });
      text = await res.text();
      break;
    } catch (e) {
      if (!(e instanceof TypeError) && !(e instanceof DOMException)) throw e;
      if (attempt + 1 === attempts) throw new ConnectionError(method);
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  let result: any;
  try {
    result = JSON.parse(text);
  } catch {
    // Keep the HTTP status visible when a proxy or crash page is not JSON.
    throw new ApiError(
      res.status,
      res.ok ? "Invalid server response" : `Request failed (${res.status})`,
    );
  }
  if (res.status === 401 && isRemoteBrowser())
    window.dispatchEvent(new Event("controlroom:auth-required"));
  if (!res.ok)
    throw new ApiError(
      res.status,
      result?.error ?? `Request failed (${res.status})`,
      result?.detail,
    );
  return result;
}
export const split = (s: string) =>
  s
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
export const shortId = (s: string) =>
  s.slice(0, s.indexOf("-") + 1) +
  s.split("-").slice(1).join("-").slice(0, 6).toUpperCase();
export const recordId = (r: RecordFile) =>
  r.meta.kind === "ticket" && r.meta.number !== undefined
    ? `#${r.meta.number}`
    : shortId(r.meta.id);
export const ago = (s: string) => {
  const n = Math.max(0, Math.floor((Date.now() - Date.parse(s)) / 60000));
  return n < 1
    ? "just now"
    : n < 60
      ? `${n}m ago`
      : n < 1440
        ? `${Math.floor(n / 60)}h ago`
        : `${Math.floor(n / 1440)}d ago`;
};
export async function uploadImage(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file");
  const image = new Image();
  const url = URL.createObjectURL(file);
  try {
    image.src = url;
    await image.decode();
    if (image.width * image.height > 60_000_000)
      throw new Error("Image is too large");
    const c = document.createElement("canvas");
    c.width = image.naturalWidth;
    c.height = image.naturalHeight;
    c.getContext("2d")!.drawImage(image, 0, 0);
    return await api("/images", "POST", {
      name: file.name,
      data: c.toDataURL("image/png"),
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function isRemoteBrowser() {
  return typeof location !== "undefined" && location.hostname !== "127.0.0.1";
}
