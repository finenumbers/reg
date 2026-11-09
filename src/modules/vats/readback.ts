function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

/** The named field must equal the sent value. Every other field must be unchanged. */
export function readbackAccepts(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  field: "client" | "language",
  nextValue: string,
): boolean {
  if (after[field] !== nextValue) return false;
  const left = { ...before };
  const right = { ...after };
  delete left[field];
  delete right[field];
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}
