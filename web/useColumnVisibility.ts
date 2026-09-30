import { useEffect, useState } from "react";

// Personal browser preference, scoped by durable project and saved-view IDs.
// It never changes shared filters, records, or workflow configuration.
export function useColumnVisibility(project: string, view: string) {
  const key = `controlroom:hidden-columns:${project}:${view}`;
  const read = () => {
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? "[]");
      return Array.isArray(value)
        ? value.filter((id): id is string => typeof id === "string")
        : [];
    } catch {
      return [];
    }
  };
  const [value, setValue] = useState(() => ({ key, ids: read() }));
  const [error, setError] = useState("");
  const ids = value.key === key ? value.ids : read();
  useEffect(() => {
    setValue({ key, ids: read() });
    setError("");
    const update = (event: StorageEvent) => {
      if (event.key === key || event.key === null)
        setValue({ key, ids: read() });
    };
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, [key]);
  function save(next: string[]) {
    setValue({ key, ids: next });
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setError("");
    } catch {
      setError(
        "Column visibility changed for this session, but browser storage could not save it.",
      );
    }
  }
  return {
    hidden: new Set(ids),
    error,
    toggle: (id: string) =>
      save(ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id]),
  };
}
