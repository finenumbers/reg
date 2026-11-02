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
