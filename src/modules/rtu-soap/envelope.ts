import type { CallBinding, GetObjectsBinding } from "@/modules/rtu-soap/wsdl";
import { escapeXml, isXmlName } from "@/modules/rtu-soap/xml";

/**
 * SOAP bodies this service can build. Each operation name is a literal.
 * Callers cannot substitute another one.
 * `getObjects` is the Settings access check.
 * `describeTable` and `selectRowset` read the two transit-call summary tables.
 * An optional module name adds one `node` header on `selectRowset`.
 * The live-call snapshot passes that name only for a signaling or scripting call table.
 */
const GET_OBJECTS = "getObjects";
const DESCRIBE_TABLE = "describeTable";
const SELECT_ROWSET = "selectRowset";

/** Handbook requires limit and offset together. This is the one page we read. */
export const SELECT_ROW_LIMIT = 2000;
const ROW_OFFSET = 0;
const OBJECT_ID = /^[0-9]+(?:\.[0-9]+)+$/;

export function buildGetObjectsEnvelope(
  binding: GetObjectsBinding,
  login: string,
  password: string,
): string {
  const header =
    `<SOAP-ENV:Header>` +
    `<Login xmlns="auth">${escapeXml(login)}</Login>` +
    `<Password xmlns="auth">${escapeXml(password)}</Password>` +
    `</SOAP-ENV:Header>`;
  const body = binding.kind === "rpc-encoded" ? rpcBody(binding) : documentBody(binding);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/">` +
    header +
    `<SOAP-ENV:Body>${body}</SOAP-ENV:Body>` +
    `</SOAP-ENV:Envelope>`
  );
}

export function quoteSoapAction(action: string): string {
  return `"${action.replaceAll('"', "")}"`;
}

function rpcBody(binding: Extract<GetObjectsBinding, { kind: "rpc-encoded" }>): string {
  const ns = escapeXml(binding.operationNamespace);
  const part = binding.partName;
  const parent = binding.nilParent ? `<p_parent_id xsi:nil="true"/>` : "";
  return (
    `<ns1:${GET_OBJECTS} xmlns:ns1="${ns}" ` +
    `SOAP-ENV:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
    `<${part} SOAP-ENC:arrayType="xsd:string[2]" xsi:type="SOAP-ENC:Array">` +
    `<item xsi:type="xsd:string">table</item>` +
    `<item xsi:type="xsd:string">procedure</item>` +
    `</${part}>` +
    parent +
    `</ns1:${GET_OBJECTS}>`
  );
}

function documentBody(
  binding: Extract<GetObjectsBinding, { kind: "document-literal" }>,
): string {
  const param = binding.parameterName;
  const inner =
    binding.parameterStyle === "repeat"
      ? `<${param}>table</${param}><${param}>procedure</${param}>`
      : `<${param}><item>table</item><item>procedure</item></${param}>`;
  const xmlns = binding.targetNamespace
    ? ` xmlns="${escapeXml(binding.targetNamespace)}"`
    : "";
  return `<${GET_OBJECTS}${xmlns}>${inner}</${GET_OBJECTS}>`;
}

export function isRtuObjectId(value: string): boolean {
  return OBJECT_ID.test(value);
}

export function isRtuColumnName(value: string): boolean {
  return isXmlName(value);
}

/** Column names and the object id are element values, never an operation name. */
export function buildDescribeTableEnvelope(
  binding: CallBinding,
  login: string,
  password: string,
  objectId: string,
): string {
  if (binding.operation !== DESCRIBE_TABLE) {
    throw new Error("describeTable binding required");
  }
  assertObjectId(objectId);
  const fields = {
    p_object_id: taggedString("p_object_id", objectId, binding.kind),
  };
  return wrap(login, password, callBody(binding, fields));
}

/**
 * One page of the current rowset. Limit is a literal.
 * Offset is a later page of that same page size, or zero.
 * Filter and sort are nil: an empty filter is not the handbook default.
 */
export function buildSelectRowsetEnvelope(
  binding: CallBinding,
  login: string,
  password: string,
  objectId: string,
  columns: readonly string[],
  moduleName?: string,
  offset = ROW_OFFSET,
): string {
  if (binding.operation !== SELECT_ROWSET) {
    throw new Error("selectRowset binding required");
  }
  assertObjectId(objectId);
  assertPageOffset(offset);
  if (columns.length === 0 || columns.length > 16) {
    throw new Error("column list rejected");
  }
  for (const column of columns) {
    if (!isRtuColumnName(column)) throw new Error("column name rejected");
  }
  const fields = {
    p_table_hi: taggedString("p_table_hi", objectId, binding.kind),
    p_filter: nilElement("p_filter"),
    p_sort: nilElement("p_sort"),
    p_limit: taggedInt("p_limit", SELECT_ROW_LIMIT, binding.kind),
    p_offset: taggedInt("p_offset", offset, binding.kind),
    p_columns: columnList(binding, columns),
  };
  return wrap(login, password, callBody(binding, fields), moduleName);
}

function assertObjectId(objectId: string): void {
  if (!isRtuObjectId(objectId)) throw new Error("object id rejected");
}

function assertPageOffset(offset: number): void {
  const lastPage = SELECT_ROW_LIMIT * 4;
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > lastPage ||
    offset % SELECT_ROW_LIMIT !== 0
  ) {
    throw new Error("row offset rejected");
  }
}

function moduleHeader(moduleName: string | undefined): string {
  if (moduleName === undefined) return "";
  if (
    moduleName.length === 0 ||
    moduleName.trim().length === 0 ||
    moduleName.includes("\0") ||
    moduleName.includes("\n") ||
    moduleName.includes("\r")
  ) {
    throw new Error("module name rejected");
  }
  return `<node xmlns="args">${escapeXml(moduleName)}</node>`;
}

function wrap(
  login: string,
  password: string,
  body: string,
  moduleName?: string,
): string {
  const header =
    `<SOAP-ENV:Header>` +
    `<Login xmlns="auth">${escapeXml(login)}</Login>` +
    `<Password xmlns="auth">${escapeXml(password)}</Password>` +
    moduleHeader(moduleName) +
    `</SOAP-ENV:Header>`;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/">` +
    header +
    `<SOAP-ENV:Body>${body}</SOAP-ENV:Body>` +
    `</SOAP-ENV:Envelope>`
  );
}

function callBody(binding: CallBinding, fields: Record<string, string>): string {
  if (binding.kind === "rpc-encoded") {
    const ns = escapeXml(binding.operationNamespace);
    const inner = binding.parts.map((part) => requiredField(part, fields)).join("");
    return (
      `<ns1:${binding.operation} xmlns:ns1="${ns}" ` +
      `SOAP-ENV:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
      inner +
      `</ns1:${binding.operation}>`
    );
  }
  const xmlns = binding.targetNamespace
    ? ` xmlns="${escapeXml(binding.targetNamespace)}"`
    : "";
  const inner = binding.parameters
    .map((parameter) => requiredField(parameter.name, fields))
    .join("");
  return `<${binding.operation}${xmlns}>${inner}</${binding.operation}>`;
}

function requiredField(name: string, fields: Record<string, string>): string {
  const value = fields[name];
  if (value === undefined) throw new Error("soap part missing");
  if (!isXmlName(name)) throw new Error("soap part rejected");
  return value;
}

function nilElement(name: string): string {
  return `<${name} xsi:nil="true"/>`;
}

function taggedString(name: string, value: string, kind: CallBinding["kind"]): string {
  if (kind === "rpc-encoded") {
    return `<${name} xsi:type="xsd:string">${escapeXml(value)}</${name}>`;
  }
  return `<${name}>${escapeXml(value)}</${name}>`;
}

function taggedInt(name: string, value: number, kind: CallBinding["kind"]): string {
  if (kind === "rpc-encoded") {
    return `<${name} xsi:type="xsd:int">${value}</${name}>`;
  }
  return `<${name}>${value}</${name}>`;
}

function columnList(binding: CallBinding, values: readonly string[]): string {
  if (binding.kind === "rpc-encoded") {
    const items = values
      .map((value) => `<item xsi:type="xsd:string">${escapeXml(value)}</item>`)
      .join("");
    return (
      `<p_columns SOAP-ENC:arrayType="xsd:string[${values.length}]" ` +
      `xsi:type="SOAP-ENC:Array">${items}</p_columns>`
    );
  }
  const parameter = binding.parameters.find((item) => item.name === "p_columns");
  if (!parameter || parameter.style === "scalar") {
    throw new Error("column list encoding rejected");
  }
  if (parameter.style === "repeat") {
    return values.map((value) => `<p_columns>${escapeXml(value)}</p_columns>`).join("");
  }
  const items = values.map((value) => `<item>${escapeXml(value)}</item>`).join("");
  return `<p_columns>${items}</p_columns>`;
}
