import { isRtuObjectId } from "@/modules/rtu-soap/envelope";
import type { ActivationWriteBinding } from "@/modules/rtu-soap/wsdl";
import { escapeXml, isXmlName } from "@/modules/rtu-soap/xml";

/**
 * The only SOAP write this service can build.
 * The operation name is this literal. Callers cannot substitute another one.
 * `p_filter` is nil. The rowset is one row: the primary key and «Запись активна».
 */
const UPDATE_ROWSET = "updateRowset";
const UPDATE_PARTS = ["p_table_hi", "p_rowset", "p_filter"] as const;

export type ActivationWire = "0" | "1";

export type ActivationUpdateCommand = {
  objectId: string;
  pkName: string;
  pkValue: string;
  activeName: string;
  activeValue: ActivationWire;
};

export function buildActivationUpdateEnvelope(
  binding: ActivationWriteBinding,
  login: string,
  password: string,
  command: ActivationUpdateCommand,
): string {
  if (binding.operation !== UPDATE_ROWSET) {
    throw new Error("updateRowset binding required");
  }
  if (!exactParts(binding.parts)) throw new Error("updateRowset parts rejected");
  if (!isRtuObjectId(command.objectId)) throw new Error("object id rejected");
  if (!isXmlName(command.pkName) || !isXmlName(command.activeName)) {
    throw new Error("column name rejected");
  }
  if (command.pkName === command.activeName) throw new Error("column name rejected");
  const pkValue = command.pkValue.trim();
  if (!pkValue || pkValue.length > 64 || /[\r\n\0]/.test(pkValue)) {
    throw new Error("primary key rejected");
  }
  if (command.activeValue !== "0" && command.activeValue !== "1") {
    throw new Error("activation value rejected");
  }
  const fields: Record<(typeof UPDATE_PARTS)[number], string> = {
    p_table_hi: taggedString("p_table_hi", command.objectId, binding.kind),
    p_rowset: rowset(
      binding.kind,
      command.pkName,
      pkValue,
      command.activeName,
      command.activeValue,
    ),
    p_filter: nilElement("p_filter"),
  };
  const body = callBody(binding, fields);
  const xml = envelope(login, password, body);
  assertClosed(xml);
  return xml;
}

function exactParts(names: readonly string[]): boolean {
  if (names.length !== UPDATE_PARTS.length) return false;
  const seen = new Set(names);
  return UPDATE_PARTS.every((name) => seen.has(name));
}

function rowset(
  kind: ActivationWriteBinding["kind"],
  pkName: string,
  pkValue: string,
  activeName: string,
  activeValue: ActivationWire,
): string {
  const cells = [cell(kind, pkName, pkValue), cell(kind, activeName, activeValue)].join(
    "",
  );
  if (kind === "rpc-encoded") {
    return (
      `<p_rowset SOAP-ENC:arrayType="SOAP-ENC:Array[1]" xsi:type="SOAP-ENC:Array">` +
      `<item SOAP-ENC:arrayType="xsd:anyType[2]" xsi:type="SOAP-ENC:Array">` +
      cells +
      `</item></p_rowset>`
    );
  }
  return `<p_rowset><item>${cells}</item></p_rowset>`;
}

function cell(kind: ActivationWriteBinding["kind"], name: string, value: string): string {
  if (kind === "rpc-encoded") {
    return (
      `<item xsi:type="xsd:anyType">` +
      `<name xsi:type="xsd:string">${escapeXml(name)}</name>` +
      `<value xsi:type="xsd:string">${escapeXml(value)}</value>` +
      `</item>`
    );
  }
  return `<item><name>${escapeXml(name)}</name><value>${escapeXml(value)}</value></item>`;
}

function callBody(
  binding: ActivationWriteBinding,
  fields: Record<(typeof UPDATE_PARTS)[number], string>,
): string {
  const inner = binding.parts.map((part) => field(part, fields)).join("");
  if (binding.kind === "rpc-encoded") {
    const ns = escapeXml(binding.operationNamespace);
    return (
      `<ns1:${UPDATE_ROWSET} xmlns:ns1="${ns}" ` +
      `SOAP-ENV:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
      inner +
      `</ns1:${UPDATE_ROWSET}>`
    );
  }
  const xmlns = binding.targetNamespace
    ? ` xmlns="${escapeXml(binding.targetNamespace)}"`
    : "";
  return `<${UPDATE_ROWSET}${xmlns}>${inner}</${UPDATE_ROWSET}>`;
}

function field(
  name: string,
  fields: Record<(typeof UPDATE_PARTS)[number], string>,
): string {
  if (name !== "p_table_hi" && name !== "p_rowset" && name !== "p_filter") {
    throw new Error("updateRowset parts rejected");
  }
  return fields[name];
}

function nilElement(name: string): string {
  return `<${name} xsi:nil="true"/>`;
}

function taggedString(
  name: string,
  value: string,
  kind: ActivationWriteBinding["kind"],
): string {
  if (kind === "rpc-encoded") {
    return `<${name} xsi:type="xsd:string">${escapeXml(value)}</${name}>`;
  }
  return `<${name}>${escapeXml(value)}</${name}>`;
}

function envelope(login: string, password: string, body: string): string {
  const header =
    `<SOAP-ENV:Header>` +
    `<Login xmlns="auth">${escapeXml(login)}</Login>` +
    `<Password xmlns="auth">${escapeXml(password)}</Password>` +
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

function assertClosed(xml: string): void {
  const banned = [
    "insertRowset",
    "deleteRowset",
    "checkRowset",
    "transaction",
    "callContext",
    "getObjectId",
    "describeProcedure",
    "<node",
    "http://mfisoft.ru/auth",
  ];
  for (const token of banned) {
    if (xml.includes(token)) throw new Error("activation envelope rejected");
  }
  const rpc = xml.match(/<ns1:updateRowset\b/g)?.length ?? 0;
  const plain = xml.match(/<updateRowset\b/g)?.length ?? 0;
  if (rpc + plain !== 1) throw new Error("activation envelope rejected");
}
