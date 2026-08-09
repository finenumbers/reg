/**
 * Parse groups[] from export.py JSON (phones / groups sync).
 */

import { stripAnsi } from "@/lib/strip-ansi";

export type ParsedRoutingGroup = {
  externalId: string;
  name: string;
};

export type ParsedGroupsPayload = {
  version: number;
  groups: ParsedRoutingGroup[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function cellStr(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  return "";
}

/**
 * Extract and validate groups catalog from export.py stdout JSON.
 * Fail-closed on missing/invalid groups array.
 */
export function parseGroupsStdout(stdout: string): ParsedGroupsPayload {
  const cleaned = stripAnsi(stdout).replace(/^\uFEFF/, "").trim();
  if (!cleaned) {
    throw new Error("Empty export.py stdout");
  }
  if (cleaned.includes("\uFFFD")) {
    throw new Error("export.py stdout contains invalid UTF-8 replacement characters");
  }

  let root: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(cleaned);
    const rec = asRecord(parsed);
    if (!rec) throw new Error("root must be object");
    root = rec;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new Error("export.py stdout is not valid JSON");
    }
    try {
      const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
      const rec = asRecord(parsed);
      if (!rec) throw new Error("root must be object");
      root = rec;
    } catch {
      throw new Error("export.py stdout is not valid JSON");
    }
  }

  if (!Array.isArray(root.groups)) {
    throw new Error("export.py JSON must include groups[]");
  }

  const groups: ParsedRoutingGroup[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();

  for (let i = 0; i < root.groups.length; i++) {
    const item = asRecord(root.groups[i]);
    if (!item) {
      throw new Error(`export.py groups[${i}] is not an object`);
    }
    const externalId = cellStr(item["ID"] ?? item.id ?? item.externalId);
    const name = cellStr(item["Название"] ?? item.name);
    if (!externalId) {
      throw new Error(`export.py groups[${i}] missing ID`);
    }
    if (!name) {
      throw new Error(`export.py groups[${i}] missing Название`);
    }
    if (seenIds.has(externalId)) {
      throw new Error(`export.py groups: duplicate ID «${externalId}»`);
    }
    if (seenNames.has(name)) {
      throw new Error(`export.py groups: duplicate Название «${name}»`);
    }
    seenIds.add(externalId);
    seenNames.add(name);
    groups.push({ externalId, name });
  }

  const version =
    typeof root.version === "number" && Number.isFinite(root.version)
      ? root.version
      : 0;

  return { version, groups };
}
