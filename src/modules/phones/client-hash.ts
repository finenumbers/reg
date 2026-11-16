import { createHash } from "node:crypto";

/** «Описание» on a phone endpoint. Missing text is an empty description. */
export function phoneDescription(data: unknown): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  const value = (data as Record<string, unknown>)["Описание"];
  return typeof value === "string" ? value.trim() : "";
}

/** Stable hash of endpoint number and description. Order does not change it. */
export function phoneClientHash(
  rows: readonly { phone: string; description: string }[],
): string {
  const lines = new Set<string>();
  for (const row of rows) {
    const phone = row.phone.trim();
    if (!phone) continue;
    lines.add(`${phone}\t${row.description.trim()}`);
  }
  const body = [...lines].sort().join("\n");
  return createHash("sha256").update(body).digest("hex");
}
