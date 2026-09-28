// Ordinary Markdown is the source of truth. Only checklist lines in this
// named section are owned; other prose and acceptance criteria stay untouched.
export function microtasks(body: string) {
  const lines = body.split("\n");
  let fence = "";
  const outside: boolean[] = [];
  const headings = lines.map((line) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker[0];
      else if (fence === marker[0]) fence = "";
      outside.push(false);
      return false;
    }
    outside.push(!fence);
    return !fence && /^#{1,2} /.test(line);
  });
  const start = lines.findIndex(
    (line, i) => headings[i] && /^## Microtasks\s*$/.test(line),
  );
  let end = start < 0 ? lines.length : start + 1;
  if (start >= 0) while (end < lines.length && !headings[end]) end++;
  const items: { line: number; text: string; done: boolean }[] = [];
  if (start >= 0)
    for (let i = start + 1; i < end; i++) {
      const m = /^- \[([ xX])\] (.*)$/.exec(lines[i]);
      if (m && outside[i])
        items.push({ line: i, text: m[2], done: m[1] !== " " });
    }
  return { lines, start, end, items };
}
export function editMicrotask(
  body: string,
  action: "add" | "rename" | "toggle" | "remove" | "up" | "down",
  index = 0,
  text = "",
) {
  const { lines, start, end, items } = microtasks(body);
  const clean = text.replace(/[\r\n]+/g, " ").trim();
  if (action === "add") {
    if (!clean) return body;
    if (start < 0)
      return (
        body +
        (body.endsWith("\n") ? "\n" : "\n\n") +
        `## Microtasks\n\n- [ ] ${clean}\n`
      );
    lines.splice(end, 0, `- [ ] ${clean}`);
  } else {
    const item = items[index];
    if (!item) return body;
    if (action === "remove") lines.splice(item.line, 1);
    if (action === "rename")
      lines[item.line] =
        `- [${item.done ? "x" : " "}] ${text.replace(/[\r\n]+/g, " ")}`;
    if (action === "toggle")
      lines[item.line] = `- [${item.done ? " " : "x"}] ${item.text}`;
    if (action === "up" || action === "down") {
      const next = items[index + (action === "up" ? -1 : 1)];
      if (next)
        [lines[item.line], lines[next.line]] = [
          lines[next.line],
          lines[item.line],
        ];
    }
  }
  return lines.join("\n");
}
