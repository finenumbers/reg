import type { GetObjectsBinding } from "@/modules/rtu-soap/wsdl";
import { escapeXml } from "@/modules/rtu-soap/xml";

/**
 * The only SOAP body this service can build.
 * The operation name is a literal. Callers cannot substitute another one.
 */
const GET_OBJECTS = "getObjects";

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
  const body =
    binding.kind === "rpc-encoded" ? rpcBody(binding) : documentBody(binding);
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
  return (
    `<ns1:${GET_OBJECTS} xmlns:ns1="${ns}" ` +
    `SOAP-ENV:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
    `<${part} SOAP-ENC:arrayType="xsd:string[2]" xsi:type="SOAP-ENC:Array">` +
    `<item xsi:type="xsd:string">table</item>` +
    `<item xsi:type="xsd:string">procedure</item>` +
    `</${part}>` +
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
