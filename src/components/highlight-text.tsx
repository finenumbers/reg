"use client";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Highlight case-insensitive occurrences of `query` inside `text`. */
export function HighlightText({
  text,
  query,
}: {
  text: string;
  query?: string;
}) {
  const q = query?.trim();
  if (!q) {
    return <>{text}</>;
  }

  const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, "gi"));
  if (parts.length === 1) {
    return <>{text}</>;
  }

  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === q.toLowerCase() ? (
          <mark key={i} className="search-hit">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
