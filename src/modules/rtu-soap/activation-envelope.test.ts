import { describe, expect, it } from "vitest";
import {
  buildActivationUpdateEnvelope,
  type ActivationUpdateCommand,
} from "@/modules/rtu-soap/activation-envelope";
import { interpretUpdateRowset } from "@/modules/rtu-soap/response";
import { readActivationWrite, readCallReads } from "@/modules/rtu-soap/wsdl";

const ORIGIN = "https://rtu.example";

const RPC_WSDL = `<?xml version="1.0"?>
<definitions xmlns="http://schemas.xmlsoap.org/wsdl/"
 xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
 xmlns:tns="urn:rtu-api"
 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
 targetNamespace="urn:rtu-api">
  <message name="getObjectsRequest"><part name="p_types" type="xsd:string"/></message>
  <message name="updateRowsetRequest">
    <part name="p_rowset" type="xsd:string"/>
    <part name="p_table_hi" type="xsd:string"/>
    <part name="p_filter" type="xsd:string"/>
  </message>
  <message name="insertRowsetRequest"><part name="p_table_hi" type="xsd:string"/></message>
  <portType name="ApiPort">
    <operation name="getObjects"><input message="tns:getObjectsRequest"/></operation>
    <operation name="updateRowset"><input message="tns:updateRowsetRequest"/></operation>
    <operation name="insertRowset"><input message="tns:insertRowsetRequest"/></operation>
  </portType>
  <binding name="ApiBinding" type="tns:ApiPort">
    <soap:binding style="rpc" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="getObjects">
      <soap:operation soapAction="urn:getObjects"/>
      <input><soap:body use="encoded" namespace="urn:rtu-api"/></input>
    </operation>
    <operation name="updateRowset">
      <soap:operation soapAction="urn:updateRowset"/>
      <input><soap:body use="encoded" namespace="urn:rtu-api"/></input>
    </operation>
    <operation name="insertRowset">
      <soap:operation soapAction="urn:insertRowset"/>
      <input><soap:body use="encoded" namespace="urn:rtu-api"/></input>
    </operation>
  </binding>
  <service name="Api">
    <port name="ApiPort" binding="tns:ApiBinding">
      <soap:address location="https://rtu.example/service/"/>
    </port>
  </service>
</definitions>`;

const command: ActivationUpdateCommand = {
  objectId: "02.2201.01",
  pkName: "gateway_id",
  pkValue: "15",
  activeName: "enable",
  activeValue: "0",
};

function binding() {
  const plan = readActivationWrite(RPC_WSDL, ORIGIN);
  if (!plan.ok) throw new Error(plan.reason);
  return plan.binding;
}

describe("activation update envelope", () => {
  it("sends one nil-filter update of the key and the checkbox", () => {
    const xml = buildActivationUpdateEnvelope(binding(), "login", "p&ass", command);
    expect(xml.match(/<ns1:updateRowset\b/g)).toHaveLength(1);
    expect(xml).not.toMatch(/<updateRowset\b/);
    expect(xml).toContain('<p_filter xsi:nil="true"/>');
    expect(xml).toContain('<name xsi:type="xsd:string">gateway_id</name>');
    expect(xml).toContain('<value xsi:type="xsd:string">15</value>');
    expect(xml).toContain('<name xsi:type="xsd:string">enable</name>');
    expect(xml).toContain('<value xsi:type="xsd:string">0</value>');
    expect(xml.match(/<name /g)).toHaveLength(2);
    expect(xml).toContain("p&amp;ass");
    expect(xml).not.toContain("<node");
    for (const token of [
      "insertRowset",
      "deleteRowset",
      "checkRowset",
      "transaction",
      "callContext",
      "getObjectId",
      "http://mfisoft.ru/auth",
    ]) {
      expect(xml).not.toContain(token);
    }
  });

  it("rejects any value except 0 and 1", () => {
    expect(() =>
      buildActivationUpdateEnvelope(binding(), "login", "secret", {
        ...command,
        activeValue: "true" as "0",
      }),
    ).toThrow(/activation value/);
  });

  it("rejects a second column name and a filter-shaped binding", () => {
    expect(() =>
      buildActivationUpdateEnvelope(binding(), "login", "secret", {
        ...command,
        activeName: "gateway_id",
      }),
    ).toThrow(/column name/);
    const extra = readActivationWrite(
      RPC_WSDL.replace(
        '<part name="p_filter" type="xsd:string"/>',
        '<part name="p_filter" type="xsd:string"/><part name="p_sort" type="xsd:string"/>',
      ),
      ORIGIN,
    );
    expect(extra.ok).toBe(false);
  });

  it("keeps updateRowset out of the read plan", () => {
    const reads = readCallReads(RPC_WSDL, ORIGIN);
    expect(reads.ok).toBe(false);
    expect(JSON.stringify(reads)).not.toContain("updateRowset");
  });
});

describe("interpretUpdateRowset", () => {
  it("accepts one integer and rejects an echoed row", () => {
    const one = interpretUpdateRowset(
      `<?xml version="1.0"?><Envelope><Body><updateRowsetResponse>1</updateRowsetResponse></Body></Envelope>`,
      "secret",
    );
    expect(one).toEqual({ kind: "count", count: 1 });
    const echoed = interpretUpdateRowset(
      `<?xml version="1.0"?><Envelope><Body><updateRowsetResponse><item><value>15</value><value>0</value></item><return>1</return></updateRowsetResponse></Body></Envelope>`,
      "secret",
    );
    expect(echoed.kind).toBe("bad");
  });
});
