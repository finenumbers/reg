import { XMLParser } from "fast-xml-parser";
import { hasDoctype, redactSecret } from "@/modules/rtu-soap/xml";

export type RtuObject = {
  objectId: string;
  title: string;
  path: string;
  type: string;
};

export type SoapRead =
  | { kind: "fault"; detail: string }
  | { kind: "bad" }
  | { kind: "objects"; objects: RtuObject[] };

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: false,
  htmlEntities: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  removeNSPrefix: false,
});

export function interpretGetObjects(xml: string, password: string): SoapRead {
  if (!xml.trim() || hasDoctype(xml)) return { kind: "bad" };
  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch {
    return { kind: "bad" };
  }
  const fault = findFault(parsed);
  if (fault !== null) {
    return { kind: "fault", detail: redactSecret(fault, password) };
  }
  return { kind: "objects", objects: collectObjects(parsed) };
}

function findFault(node: unknown): string | null {
  let fault: string | null = null;
  walk(node, (key, value) => {
    if (fault !== null) return;
    if (localName(key) !== "faultstring" && localName(key) !== "Text") return;
    const text = textOf(value);
    if (text) fault = text;
  });
  return fault;
}

function collectObjects(node: unknown): RtuObject[] {
  const out: RtuObject[] = [];
  const seen = new Set<string>();
  walk(node, (_key, value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    const objectId = field(record, "object_id");
    const type = field(record, "type");
    if (!objectId || !type) return;
    const key = `${type}\n${objectId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      objectId,
      type,
      title: field(record, "title") ?? "",
      path: field(record, "path") ?? "",
    });
  });
  return out;
}

function field(record: Record<string, unknown>, name: string): string | null {
  for (const [key, value] of Object.entries(record)) {
    if (localName(key) !== name) continue;
    const text = textOf(value);
    if (text) return text;
  }
  return null;
}

function textOf(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const text = (value as Record<string, unknown>)["#text"];
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  return null;
}

function walk(node: unknown, visit: (key: string, value: unknown) => void): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) {
      visit("", item);
      walk(item, visit);
    }
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@_")) continue;
    visit(key, value);
    walk(value, visit);
  }
}

function localName(value: string): string {
  const index = value.lastIndexOf(":");
  return index === -1 ? value : value.slice(index + 1);
}

export type SoapColumn = {
  name: string;
  title: string;
  dataMask: string | null;
};

export type SoapColumns =
  | { kind: "fault"; detail: string }
  | { kind: "bad" }
  | { kind: "columns"; columns: SoapColumn[] };

export type SoapRows =
  | { kind: "fault"; detail: string }
  | { kind: "bad" }
  | { kind: "rows"; rows: Array<Record<string, string>> };

export function interpretDescribeTable(xml: string, password: string): SoapColumns {
  const parsed = parseSoap(xml, password);
  if (parsed.kind !== "tree") return parsed;
  if (!hasLocalName(parsed.tree, "describeTableResponse")) return { kind: "bad" };
  const columns: SoapColumn[] = [];
  const seen = new Set<string>();
  collectColumns(parsed.tree, columns, seen);
  return { kind: "columns", columns };
}

export function interpretSelectRowset(xml: string, password: string): SoapRows {
  const parsed = parseSoap(xml, password);
  if (parsed.kind !== "tree") return parsed;
  if (!hasLocalName(parsed.tree, "selectRowsetResponse")) return { kind: "bad" };
  const rows: Array<Record<string, string>> = [];
  collectRows(parsed.tree, rows);
  return { kind: "rows", rows };
}

function parseSoap(
  xml: string,
  password: string,
): { kind: "tree"; tree: unknown } | { kind: "fault"; detail: string } | { kind: "bad" } {
  if (!xml.trim() || hasDoctype(xml)) return { kind: "bad" };
  let tree: unknown;
  try {
    tree = parser.parse(xml);
  } catch {
    return { kind: "bad" };
  }
  const fault = findFault(tree);
  if (fault !== null) {
    return { kind: "fault", detail: redactSecret(fault, password) };
  }
  return { kind: "tree", tree };
}

function hasLocalName(node: unknown, expected: string): boolean {
  let found = false;
  walk(node, (key) => {
    if (localName(key) === expected) found = true;
  });
  return found;
}

function collectColumns(
  node: unknown,
  out: SoapColumn[],
  seen: Set<string>,
): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectColumns(item, out, seen);
    return;
  }
  const column = asColumn(node as Record<string, unknown>);
  if (column && !seen.has(column.name)) {
    seen.add(column.name);
    out.push(column);
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key.startsWith("@_")) continue;
    collectColumns(value, out, seen);
  }
}

function asColumn(record: Record<string, unknown>): SoapColumn | null {
  if (hasKey(record, "direction")) return null;
  const name = ownText(record, "name");
  const title = ownText(record, "title");
  if (!name || title === null || title === "") return null;
  const type = ownText(record, "type");
  const looks =
    type === "column" ||
    hasKey(record, "data_type") ||
    hasKey(record, "pk") ||
    hasKey(record, "data_mask") ||
    hasKey(record, "represent");
  if (!looks) return null;
  const mask = ownText(record, "data_mask");
  return { name, title, dataMask: mask ? mask : null };
}

function collectRows(node: unknown, out: Array<Record<string, string>>): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectRows(item, out);
    return;
  }
  const record = node as Record<string, unknown>;
  const row = rowFrom(record);
  if (row) {
    out.push(row);
    return;
  }
  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith("@_")) continue;
    collectRows(value, out);
  }
}

function rowFrom(record: Record<string, unknown>): Record<string, string> | null {
  const cells: { name: string; value: string }[] = [];
  let structural = 0;
  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith("@_")) continue;
    const list = Array.isArray(value) ? value : [value];
    for (const item of list) {
      const cell = asCell(item);
      if (cell) cells.push(cell);
      else if (item && typeof item === "object") structural += 1;
    }
  }
  if (cells.length === 0 || structural > 0) return null;
  const row: Record<string, string> = {};
  for (const cell of cells) row[cell.name] = cell.value;
  return row;
}

function asCell(value: unknown): { name: string; value: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    hasKey(record, "title") ||
    hasKey(record, "data_type") ||
    hasKey(record, "direction")
  ) {
    return null;
  }
  const name = ownText(record, "name");
  if (!name || !hasKey(record, "value")) return null;
  return { name, value: ownText(record, "value") ?? "" };
}

function hasKey(record: Record<string, unknown>, name: string): boolean {
  return Object.keys(record).some((key) => localName(key) === name);
}

function ownText(record: Record<string, unknown>, name: string): string | null {
  for (const [key, value] of Object.entries(record)) {
    if (localName(key) !== name) continue;
    if (typeof value === "string") return value.trim();
    if (typeof value === "number") return String(value);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const text = (value as Record<string, unknown>)["#text"];
      if (typeof text === "string") return text.trim();
      const keys = Object.keys(value as Record<string, unknown>);
      if (keys.length === 0 || keys.every((item) => item.startsWith("@_"))) return "";
    }
    if (value == null) return "";
  }
  return null;
}
