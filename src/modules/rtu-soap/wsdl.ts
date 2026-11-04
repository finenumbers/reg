import { XMLParser } from "fast-xml-parser";
import { pinSoapEndpoint } from "@/modules/rtu-soap/origin";
import { hasDoctype, isXmlName } from "@/modules/rtu-soap/xml";

export type RpcEncodedBinding = {
  kind: "rpc-encoded";
  operationNamespace: string;
  soapAction: string;
  partName: string;
  /** Live WSDL lists p_parent_id. Nil means the whole catalog, not one table. */
  nilParent: boolean;
};

export type DocumentLiteralBinding = {
  kind: "document-literal";
  targetNamespace: string;
  soapAction: string;
  parameterName: string;
  parameterStyle: "repeat" | "items";
};

export type GetObjectsBinding = RpcEncodedBinding | DocumentLiteralBinding;

export type WsdlPlan =
  | { ok: true; binding: GetObjectsBinding; endpoint: string }
  | { ok: false; reason: "doctype" | "parse" | "unsupported" | "host" };

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

export function readWsdl(xml: string, origin: string): WsdlPlan {
  if (hasDoctype(xml)) return { ok: false, reason: "doctype" };
  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch {
    return { ok: false, reason: "parse" };
  }
  const definitions = findChildRecord(parsed, "definitions");
  if (!definitions) return { ok: false, reason: "parse" };

  let hostMismatch = false;
  for (const binding of childRecords(definitions, "binding")) {
    const understood = understandBinding(definitions, binding);
    if (!understood) continue;
    const endpoint = endpointFor(definitions, attr(binding, "name") ?? "", origin);
    if (!understood) continue;
    if (endpoint === "missing") continue;
    if (endpoint === "mismatch") {
      hostMismatch = true;
      continue;
    }
    return { ok: true, binding: understood, endpoint };
  }
  return { ok: false, reason: hostMismatch ? "host" : "unsupported" };
}

function understandBinding(
  definitions: Record<string, unknown>,
  binding: Record<string, unknown>,
): GetObjectsBinding | null {
  const soapBinding = childRecords(binding, "binding")[0];
  const style = soapBinding ? attr(soapBinding, "style") : undefined;
  for (const operation of childRecords(binding, "operation")) {
    if (attr(operation, "name") !== "getObjects") continue;
    const soapOperation = childRecords(operation, "operation")[0];
    const soapAction = soapOperation ? (attr(soapOperation, "soapAction") ?? "") : "";
    const input = childRecords(operation, "input")[0];
    const body = input ? childRecords(input, "body")[0] : undefined;
    const use = body ? attr(body, "use") : undefined;
    if (style === "rpc" && use === "encoded") {
      return rpcBinding(definitions, body, soapAction);
    }
    if (style === "document" && use === "literal") {
      return documentBinding(definitions, soapAction);
    }
    return null;
  }
  return null;
}

function getObjectsMessageName(
  definitions: Record<string, unknown>,
): string | null {
  for (const portType of childRecords(definitions, "portType")) {
    for (const operation of childRecords(portType, "operation")) {
      if (attr(operation, "name") !== "getObjects") continue;
      const input = childRecords(operation, "input")[0];
      const name = localName(attr(input, "message") ?? "");
      if (name) return name;
    }
  }
  return null;
}

function rpcBinding(
  definitions: Record<string, unknown>,
  body: Record<string, unknown> | undefined,
  soapAction: string,
): RpcEncodedBinding | null {
  const operationNamespace = body ? (attr(body, "namespace") ?? "") : "";
  if (!operationNamespace) return null;
  const messageName = getObjectsMessageName(definitions);
  if (!messageName) return null;
  const message = childRecords(definitions, "message").find(
    (item) => attr(item, "name") === messageName,
  );
  if (!message) return null;
  const parts = childRecords(message, "part");
  const part =
    parts.find((item) => attr(item, "name") === "p_types") ??
    (parts.length === 1 ? parts[0] : undefined);
  const partName = part ? attr(part, "name") : undefined;
  if (!partName || !isXmlName(partName)) return null;
  return {
    kind: "rpc-encoded",
    operationNamespace,
    soapAction,
    partName,
    nilParent: parts.some((item) => attr(item, "name") === "p_parent_id"),
  };
}

function documentBinding(
  definitions: Record<string, unknown>,
  soapAction: string,
): DocumentLiteralBinding | null {
  const element = findNamedElement(definitions, "getObjects");
  if (!element) return null;
  const parameter = sequenceElements(element).find(
    (item) => attr(item, "name") === "p_types",
  );
  if (!parameter || !isXmlName("p_types")) return null;
  const style = parameterStyle(definitions, parameter);
  if (!style) return null;
  return {
    kind: "document-literal",
    targetNamespace: attr(definitions, "targetNamespace") ?? "",
    soapAction,
    parameterName: "p_types",
    parameterStyle: style,
  };
}

function parameterStyle(
  definitions: Record<string, unknown>,
  parameter: Record<string, unknown>,
): "repeat" | "items" | null {
  const nested = sequenceElements(parameter);
  if (nested.some((item) => attr(item, "name") === "item")) return "items";
  const typeName = localName(attr(parameter, "type") ?? "");
  if (typeName === "string" && repeats(parameter)) return "repeat";
  if (!typeName) return null;
  const complex = findNamedComplexType(definitions, typeName);
  if (!complex) return null;
  const fields = sequenceElements(complex);
  if (fields.some((item) => attr(item, "name") === "item")) return "items";
  return null;
}

function repeats(element: Record<string, unknown>): boolean {
  const max = attr(element, "maxOccurs");
  if (max === "unbounded") return true;
  const parsed = max ? Number(max) : 1;
  return Number.isFinite(parsed) && parsed >= 2;
}

function endpointFor(
  definitions: Record<string, unknown>,
  bindingName: string,
  origin: string,
): string | "missing" | "mismatch" {
  if (!bindingName) return "missing";
  let sawAddress = false;
  for (const service of childRecords(definitions, "service")) {
    for (const port of childRecords(service, "port")) {
      if (localName(attr(port, "binding") ?? "") !== bindingName) continue;
      const address = childRecords(port, "address")[0];
      const location = address ? attr(address, "location") : undefined;
      if (!location) continue;
      sawAddress = true;
      const pinned = pinSoapEndpoint(origin, location);
      if (pinned) return pinned;
    }
  }
  return sawAddress ? "mismatch" : "missing";
}

function findNamedElement(
  root: unknown,
  name: string,
): Record<string, unknown> | null {
  let found: Record<string, unknown> | null = null;
  walk(root, (key, value) => {
    if (found || localName(key) !== "element") return;
    const list = asRecords(value);
    for (const element of list) {
      if (attr(element, "name") === name) found = element;
    }
  });
  return found;
}

function findNamedComplexType(
  root: unknown,
  name: string,
): Record<string, unknown> | null {
  let found: Record<string, unknown> | null = null;
  walk(root, (key, value) => {
    if (found || localName(key) !== "complexType") return;
    const list = asRecords(value);
    for (const type of list) {
      if (attr(type, "name") === name) found = type;
    }
  });
  return found;
}

function sequenceElements(node: Record<string, unknown>): Record<string, unknown>[] {
  const direct = childRecords(node, "element");
  if (direct.length > 0) return direct;
  const complex = childRecords(node, "complexType")[0];
  if (!complex) return [];
  const sequence = childRecords(complex, "sequence")[0];
  if (!sequence) return childRecords(complex, "element");
  return childRecords(sequence, "element");
}

function findChildRecord(node: unknown, name: string): Record<string, unknown> | null {
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  return childRecords(node as Record<string, unknown>, name)[0] ?? null;
}

function childRecords(
  node: Record<string, unknown>,
  name: string,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@_")) continue;
    if (localName(key) !== name) continue;
    out.push(...asRecords(value));
  }
  return out;
}

function asRecords(value: unknown): Record<string, unknown>[] {
  const list = Array.isArray(value) ? value : [value];
  return list.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item),
  );
}

function walk(
  node: unknown,
  visit: (key: string, value: unknown) => void,
): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@_")) continue;
    visit(key, value);
    walk(value, visit);
  }
}

function attr(node: Record<string, unknown> | undefined, name: string): string | undefined {
  if (!node) return undefined;
  for (const [key, value] of Object.entries(node)) {
    if (!key.startsWith("@_")) continue;
    if (localName(key.slice(2)) !== name) continue;
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function localName(value: string): string {
  const index = value.lastIndexOf(":");
  return index === -1 ? value : value.slice(index + 1);
}

const DESCRIBE_TABLE = "describeTable";
const SELECT_ROWSET = "selectRowset";
const GET_LOOKUP = "getLookup";
const GET_COLUMN_LOOKUP = "getColumnLookup";
const DESCRIBE_PARTS = ["p_object_id"] as const;
const SELECT_PARTS = [
  "p_table_hi",
  "p_filter",
  "p_sort",
  "p_limit",
  "p_offset",
  "p_columns",
] as const;
const LOOKUP_ID_PARTS = new Set(["p_object_id", "p_table_hi"]);
const LOOKUP_COLUMN_PARTS = new Set(["p_column_nm", "p_column_name"]);

export type CallParamStyle = "scalar" | "repeat" | "items";

type LookupOperation = typeof GET_LOOKUP | typeof GET_COLUMN_LOOKUP;
type ReadOperation = typeof DESCRIBE_TABLE | typeof SELECT_ROWSET | LookupOperation;

export type CallBinding =
  | {
      kind: "rpc-encoded";
      operation: typeof DESCRIBE_TABLE | typeof SELECT_ROWSET;
      operationNamespace: string;
      soapAction: string;
      parts: readonly string[];
    }
  | {
      kind: "document-literal";
      operation: typeof DESCRIBE_TABLE | typeof SELECT_ROWSET;
      targetNamespace: string;
      soapAction: string;
      parameters: readonly { name: string; style: CallParamStyle }[];
    };

export type LookupBinding =
  | {
      kind: "rpc-encoded";
      operation: LookupOperation;
      operationNamespace: string;
      soapAction: string;
      parts: readonly string[];
    }
  | {
      kind: "document-literal";
      operation: LookupOperation;
      targetNamespace: string;
      soapAction: string;
      parameters: readonly { name: string; style: CallParamStyle }[];
    };

type BoundCall =
  | {
      kind: "rpc-encoded";
      operation: ReadOperation;
      operationNamespace: string;
      soapAction: string;
      parts: readonly string[];
    }
  | {
      kind: "document-literal";
      operation: ReadOperation;
      targetNamespace: string;
      soapAction: string;
      parameters: readonly { name: string; style: CallParamStyle }[];
    };

export type CallReadPlan =
  | {
      ok: true;
      endpoint: string;
      describeTable: CallBinding;
      selectRowset: CallBinding;
      /** Absent when this binding has neither handbook lookup operation. */
      getLookup: LookupBinding | null;
    }
  | { ok: false; reason: "doctype" | "parse" | "unsupported" | "host" };

/** Bindings for the named live-call reads. Write operations stay ignored. */
export function readCallReads(xml: string, origin: string): CallReadPlan {
  if (hasDoctype(xml)) return { ok: false, reason: "doctype" };
  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch {
    return { ok: false, reason: "parse" };
  }
  const definitions = findChildRecord(parsed, "definitions");
  if (!definitions) return { ok: false, reason: "parse" };

  let hostMismatch = false;
  for (const binding of childRecords(definitions, "binding")) {
    const describeTable = asCallRead(understandCall(definitions, binding, DESCRIBE_TABLE));
    const selectRowset = asCallRead(understandCall(definitions, binding, SELECT_ROWSET));
    if (!describeTable || !selectRowset) continue;
    const endpoint = endpointFor(definitions, attr(binding, "name") ?? "", origin);
    if (endpoint === "missing") continue;
    if (endpoint === "mismatch") {
      hostMismatch = true;
      continue;
    }
    const getLookup =
      asLookup(understandCall(definitions, binding, GET_LOOKUP)) ??
      asLookup(understandCall(definitions, binding, GET_COLUMN_LOOKUP));
    return { ok: true, endpoint, describeTable, selectRowset, getLookup };
  }
  return { ok: false, reason: hostMismatch ? "host" : "unsupported" };
}

function asCallRead(binding: BoundCall | null): CallBinding | null {
  if (!binding || isLookupOperation(binding.operation)) return null;
  if (binding.kind === "rpc-encoded") {
    return {
      kind: "rpc-encoded",
      operation: binding.operation,
      operationNamespace: binding.operationNamespace,
      soapAction: binding.soapAction,
      parts: binding.parts,
    };
  }
  return {
    kind: "document-literal",
    operation: binding.operation,
    targetNamespace: binding.targetNamespace,
    soapAction: binding.soapAction,
    parameters: binding.parameters,
  };
}

function asLookup(binding: BoundCall | null): LookupBinding | null {
  if (!binding || !isLookupOperation(binding.operation)) return null;
  if (binding.kind === "rpc-encoded") {
    return {
      kind: "rpc-encoded",
      operation: binding.operation,
      operationNamespace: binding.operationNamespace,
      soapAction: binding.soapAction,
      parts: binding.parts,
    };
  }
  return {
    kind: "document-literal",
    operation: binding.operation,
    targetNamespace: binding.targetNamespace,
    soapAction: binding.soapAction,
    parameters: binding.parameters,
  };
}

function isLookupOperation(operation: ReadOperation): operation is LookupOperation {
  return operation === GET_LOOKUP || operation === GET_COLUMN_LOOKUP;
}

function understandCall(
  definitions: Record<string, unknown>,
  binding: Record<string, unknown>,
  operationName: ReadOperation,
): BoundCall | null {
  const soapBinding = childRecords(binding, "binding")[0];
  const style = soapBinding ? attr(soapBinding, "style") : undefined;
  for (const operation of childRecords(binding, "operation")) {
    if (attr(operation, "name") !== operationName) continue;
    const soapOperation = childRecords(operation, "operation")[0];
    const soapAction = soapOperation ? (attr(soapOperation, "soapAction") ?? "") : "";
    const input = childRecords(operation, "input")[0];
    const body = input ? childRecords(input, "body")[0] : undefined;
    const use = body ? attr(body, "use") : undefined;
    if (style === "rpc" && use === "encoded") {
      return rpcCallBinding(definitions, operationName, body, soapAction);
    }
    if (style === "document" && use === "literal") {
      return documentCallBinding(definitions, operationName, soapAction);
    }
    return null;
  }
  return null;
}

function rpcCallBinding(
  definitions: Record<string, unknown>,
  operationName: ReadOperation,
  body: Record<string, unknown> | undefined,
  soapAction: string,
): BoundCall | null {
  const operationNamespace = body ? (attr(body, "namespace") ?? "") : "";
  if (!operationNamespace) return null;
  const parts = inputPartNames(definitions, operationName);
  if (!parts || !exactParts(parts, operationName)) return null;
  return {
    kind: "rpc-encoded",
    operation: operationName,
    operationNamespace,
    soapAction,
    parts,
  };
}

function documentCallBinding(
  definitions: Record<string, unknown>,
  operationName: ReadOperation,
  soapAction: string,
): BoundCall | null {
  const element = findNamedElement(definitions, operationName);
  if (!element) return null;
  const sequence = sequenceElements(element);
  if (sequence.length === 0) return null;
  const parameters: { name: string; style: CallParamStyle }[] = [];
  for (const parameter of sequence) {
    const name = attr(parameter, "name");
    if (!name || !isXmlName(name)) return null;
    const style = callParamStyle(definitions, parameter, name);
    if (!style) return null;
    parameters.push({ name, style });
  }
  if (!exactParts(parameters.map((item) => item.name), operationName)) return null;
  if (operationName === SELECT_ROWSET) {
    const columns = parameters.find((item) => item.name === "p_columns");
    if (!columns || columns.style === "scalar") return null;
  }
  return {
    kind: "document-literal",
    operation: operationName,
    targetNamespace: attr(definitions, "targetNamespace") ?? "",
    soapAction,
    parameters,
  };
}

function exactParts(names: readonly string[], operationName: ReadOperation): boolean {
  if (isLookupOperation(operationName)) return exactLookupParts(names);
  const required = operationName === DESCRIBE_TABLE ? DESCRIBE_PARTS : SELECT_PARTS;
  if (names.length !== required.length) return false;
  const seen = new Set(names);
  return required.every((name) => seen.has(name));
}

function exactLookupParts(names: readonly string[]): boolean {
  if (names.length !== 2) return false;
  const ids = names.filter((name) => LOOKUP_ID_PARTS.has(name));
  const columns = names.filter((name) => LOOKUP_COLUMN_PARTS.has(name));
  return ids.length === 1 && columns.length === 1;
}

function inputPartNames(
  definitions: Record<string, unknown>,
  operationName: string,
): string[] | null {
  for (const portType of childRecords(definitions, "portType")) {
    for (const operation of childRecords(portType, "operation")) {
      if (attr(operation, "name") !== operationName) continue;
      const input = childRecords(operation, "input")[0];
      const messageName = localName(attr(input, "message") ?? "");
      if (!messageName) return null;
      const message = childRecords(definitions, "message").find(
        (item) => attr(item, "name") === messageName,
      );
      if (!message) return null;
      const names = childRecords(message, "part")
        .map((part) => attr(part, "name"))
        .filter((name): name is string => Boolean(name));
      if (names.length === 0 || names.some((name) => !isXmlName(name))) return null;
      return names;
    }
  }
  return null;
}

function callParamStyle(
  definitions: Record<string, unknown>,
  parameter: Record<string, unknown>,
  name: string,
): CallParamStyle | null {
  if (name !== "p_columns") return "scalar";
  const listed = parameterStyle(definitions, parameter);
  if (listed) return listed;
  if (localName(attr(parameter, "type") ?? "") === "Array") return "items";
  return null;
}
