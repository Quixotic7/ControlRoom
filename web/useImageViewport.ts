import { useEffect, useRef, useState } from "react";

type View = { zoom: number; x: number; y: number };
export function zoomAt(view: View, zoom: number, x: number, y: number): View {
  zoom = Math.max(0.01, Math.min(8, zoom));
  const ratio = zoom / view.zoom;
  return { zoom, x: x - (x - view.x) * ratio, y: y - (y - view.y) * ratio };
}
export function useImageViewport(width: number, height: number) {
  const stage = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const [space, setSpace] = useState(false);
  const fitting = useRef(true);
  const pan = useRef<{ x: number; y: number; view: View } | null>(null);
  function fit() {
    const el = stage.current;
    if (!el) return;
    const zoom = Math.max(
      0.01,
      Math.min(
        1,
        (el.clientWidth - 32) / width,
        (el.clientHeight - 32) / height,
      ),
    );
    setView({
      zoom,
      x: (el.clientWidth - width * zoom) / 2,
      y: (el.clientHeight - height * zoom) / 2,
    });
    fitting.current = true;
  }
  function zoomTo(zoom: number) {
    const el = stage.current;
    if (!el) return;
    fitting.current = false;
    setView((v) => zoomAt(v, zoom, el.clientWidth / 2, el.clientHeight / 2));
  }
  useEffect(() => {
    fit();
    const observer = new ResizeObserver(() => {
      if (fitting.current) fit();
    });
    if (stage.current) observer.observe(stage.current);
    return () => observer.disconnect();
  }, [width, height]);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      fitting.current = false;
      const b = el.getBoundingClientRect();
      const delta =
        e.deltaY *
        (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1);
      setView((v) =>
        zoomAt(
          v,
          v.zoom * Math.exp(-delta * 0.002),
          e.clientX - b.left,
          e.clientY - b.top,
        ),
      );
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement)?.closest(
          "input,textarea,select,[contenteditable=true]",
        ) ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        setSpace(true);
      }
      if (["+", "="].includes(e.key)) {
        e.preventDefault();
        zoomTo(view.zoom * 1.25);
      }
      if (e.key === "-") {
        e.preventDefault();
        zoomTo(view.zoom / 1.25);
      }
      if (e.key === "0") {
        e.preventDefault();
        fit();
      }
      if (e.key === "1") {
        e.preventDefault();
        zoomTo(1);
      }
    };
    const release = () => {
      setSpace(false);
      pan.current = null;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpace(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
    };
  });
  return {
    stage,
    view,
    fit,
    zoomTo,
    space,
    down(e: React.PointerEvent, hand: boolean) {
      if (!(e.button === 1 || (e.button === 0 && (hand || space)))) return;
      e.preventDefault();
      e.stopPropagation();
      stage.current?.focus();
      stage.current?.setPointerCapture(e.pointerId);
      fitting.current = false;
      pan.current = { x: e.clientX, y: e.clientY, view };
    },
    move(e: React.PointerEvent) {
      const p = pan.current;
      if (!p) return;
      e.preventDefault();
      e.stopPropagation();
      setView({
        ...p.view,
        x: p.view.x + e.clientX - p.x,
        y: p.view.y + e.clientY - p.y,
      });
    },
    up() {
      pan.current = null;
    },
  };
}
