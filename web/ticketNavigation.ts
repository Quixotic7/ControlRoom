import type { MouseEvent } from "react";

export const ticketUrl = (id: string) => `#ticket=${encodeURIComponent(id)}`;
export const ticketPageUrl = (id: string) => `?ticketOnly=1${ticketUrl(id)}`;
export const ticketFromUrl = () =>
  location.hash.match(/^#ticket=([\w-]+)$/)?.[1] ?? null;
// Preserve the board's button/keyboard behavior and add browser-tab gestures.
export function ticketNavigation(id: string, open: (id: string) => void) {
  const newTab = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.open(ticketPageUrl(id), "_blank", "noopener");
  };
  return {
    onClick: (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) newTab(e);
      else open(id);
    },
    onAuxClick: (e: MouseEvent) => {
      if (e.button === 1) newTab(e);
    },
  };
}
