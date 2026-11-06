import type {
  CallBinding,
  CountBinding,
  GetObjectsBinding,
  LookupBinding,
} from "@/modules/rtu-soap/wsdl";
import { escapeXml, isXmlName } from "@/modules/rtu-soap/xml";

/**
 * SOAP bodies this service can build. Each operation name is a literal.
 * Callers cannot substitute another one.
 * `getObjects` is the Settings access check.
 * `describeTable` and `selectRowset` read the transit-call tables,
 * the incoming-groups page, the equipment page, and the two registration summary pages.
 * An optional module name adds one `node` header on `selectRowset`.
 * The live-call snapshot passes that name only for a signaling or scripting
 * call table. A registration summary passes none. A registration template
 * passes it only for signaling on ПКомм and scripting on ПУпр. Groups pass none.
 * The equipment page passes none.
 * `getLookup` reads «Состояние вызова» on the ПУпр call table,
 * «Состояние» on «Регистрации (ПКомм)», and three columns of «Оборудование».
 * It sends no `node` header.
 * `getColumnLookup` is sent only when that operation is in the same WSDL.
 * `countRowset` is one nil-filter count of the equipment page.
 */
const GET_OBJECTS = "getObjects";
const DESCRIBE_TABLE = "describeTable";
const SELECT_ROWSET = "selectRowset";
const COUNT_ROWSET = "countRowset";
const GET_LOOKUP = "getLookup";
const GET_COLUMN_LOOKUP = "getColumnLookup";

/** Handbook requires limit and offset together. This is the one page we read. */
export const SELECT_ROW_LIMIT = 2000;
/** Calls, groups, and registrations stay inside this column list. */
export const SELECT_COLUMN_CAP = 16;
/** Five pages: offsets 0, 2000, 4000, 6000, and 8000. */
export const SELECT_OFFSET_CAP = SELECT_ROW_LIMIT * 4;
/** Equipment page: catalog fields, the activation flag, and one primary key. The cap leaves room for the zone columns. */
export const EQUIPMENT_SELECT_COLUMN_CAP = 24;
/** Twenty-five equipment pages. The last offset is 48000. */
export const EQUIPMENT_SELECT_OFFSET_CAP = SELECT_ROW_LIMIT * 24;

export type SelectRowsetBounds = {
  columnCap: number;
  offsetCap: number;
};
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
  bounds?: SelectRowsetBounds,
): string {
  if (binding.operation !== SELECT_ROWSET) {
    throw new Error("selectRowset binding required");
  }
  assertObjectId(objectId);
  const columnCap = bounds?.columnCap ?? SELECT_COLUMN_CAP;
  const offsetCap = bounds?.offsetCap ?? SELECT_OFFSET_CAP;
  if (
    !Number.isInteger(columnCap) ||
    columnCap < 1 ||
    columnCap > EQUIPMENT_SELECT_COLUMN_CAP ||
    !Number.isInteger(offsetCap) ||
    offsetCap < 0 ||
    offsetCap > EQUIPMENT_SELECT_OFFSET_CAP
  ) {
    throw new Error("column list rejected");
  }
  assertPageOffset(offset, offsetCap);
  if (columns.length === 0 || columns.length > columnCap) {
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

/**
 * One `getLookup` in the style of a describeTable binding already accepted
 * from the same WSDL. No call when that binding's SOAPAction cannot be reused.
 */
export function registrationStateLookup(describeTable: CallBinding): LookupBinding | null {
  const soapAction = lookupSoapAction(describeTable.soapAction);
  if (soapAction === null) return null;
  if (describeTable.kind === "rpc-encoded") {
    return {
      kind: "rpc-encoded",
      operation: GET_LOOKUP,
      operationNamespace: describeTable.operationNamespace,
      soapAction,
      parts: ["p_object_id", "p_column_nm"],
    };
  }
  return {
    kind: "document-literal",
    operation: GET_LOOKUP,
    targetNamespace: describeTable.targetNamespace,
    soapAction,
    parameters: [
      { name: "p_object_id", style: "scalar" },
      { name: "p_column_nm", style: "scalar" },
    ],
  };
}

function lookupSoapAction(action: string): string | null {
  if (action === "") return "";
  const suffix = DESCRIBE_TABLE;
  if (!action.endsWith(suffix)) return null;
  return `${action.slice(0, -suffix.length)}${GET_LOOKUP}`;
}

/** Interface strings for one column. The column name is the technical name. */
export function buildGetLookupEnvelope(
  binding: LookupBinding,
  login: string,
  password: string,
  objectId: string,
  columnName: string,
): string {
  if (binding.operation !== GET_LOOKUP && binding.operation !== GET_COLUMN_LOOKUP) {
    throw new Error("getLookup binding required");
  }
  assertObjectId(objectId);
  if (!isRtuColumnName(columnName)) throw new Error("column name rejected");
  const names =
    binding.kind === "rpc-encoded" ? binding.parts : binding.parameters.map((item) => item.name);
  const idName = names.find((name) => name === "p_object_id" || name === "p_table_hi");
  const columnPart = names.find((name) => name === "p_column_nm" || name === "p_column_name");
  if (!idName || !columnPart) throw new Error("getLookup binding required");
  const fields = {
    [idName]: taggedString(idName, objectId, binding.kind),
    [columnPart]: taggedString(columnPart, columnName, binding.kind),
  };
  return wrap(login, password, callBody(binding, fields));
}

/** One nil-filter count. The operation name is the literal `countRowset`. */
export function buildCountRowsetEnvelope(
  binding: CountBinding,
  login: string,
  password: string,
  objectId: string,
): string {
  if (binding.operation !== COUNT_ROWSET) {
    throw new Error("countRowset binding required");
  }
  assertObjectId(objectId);
  const fields = {
    p_table_hi: taggedString("p_table_hi", objectId, binding.kind),
    p_filter: nilElement("p_filter"),
  };
  return wrap(login, password, callBody(binding, fields));
}

function assertObjectId(objectId: string): void {
  if (!isRtuObjectId(objectId)) throw new Error("object id rejected");
}

function assertPageOffset(offset: number, offsetCap: number): void {
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > offsetCap ||
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

function callBody(
  binding: CallBinding | LookupBinding | CountBinding,
  fields: Record<string, string>,
): string {
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
