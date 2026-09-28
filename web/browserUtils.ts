// randomUUID and the async Clipboard API require a secure context. A LAN HTTP
// origin can still use cryptographic random bytes and user-initiated copy.
export function randomUUID(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const active = document.activeElement as HTMLElement | null;
  const field = document.createElement("textarea");
  field.value = text;
  field.style.position = "fixed";
  field.style.opacity = "0";
  (document.querySelector("dialog[open]") ?? document.body).append(field);
  field.select();
  try {
    if (!document.execCommand("copy"))
      throw new Error(
        "Copy is unavailable here. Select the displayed text and copy it manually.",
      );
  } finally {
    field.remove();
    active?.focus();
  }
}
