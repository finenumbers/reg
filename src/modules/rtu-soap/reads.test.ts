import { describe, expect, it } from "vitest";
import {
  buildDescribeTableEnvelope,
  buildSelectRowsetEnvelope,
  SELECT_ROW_LIMIT,
} from "@/modules/rtu-soap/envelope";
import { interpretDescribeTable, interpretSelectRowset } from "@/modules/rtu-soap/response";
import { readCallReads, type CallBinding } from "@/modules/rtu-soap/wsdl";

const ORIGIN = "https://rtu.example";

const RPC_WSDL = `<?xml version="1.0"?>
<definitions xmlns="http://schemas.xmlsoap.org/wsdl/"
 xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
 xmlns:tns="urn:rtu-api"
 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
 targetNamespace="urn:rtu-api">
  <message name="describeTableRequest"><part name="p_object_id" type="xsd:string"/></message>
  <message name="selectRowsetRequest">
    <part name="p_sort" type="xsd:string"/>
    <part name="p_table_hi" type="xsd:string"/>
    <part name="p_filter" type="xsd:string"/>
    <part name="p_limit" type="xsd:int"/>
    <part name="p_offset" type="xsd:int"/>
    <part name="p_columns" type="xsd:string"/>
  </message>
  <message name="insertRowsetRequest"><part name="p_table_hi" type="xsd:string"/></message>
  <portType name="ApiPort">
    <operation name="insertRowset"><input message="tns:insertRowsetRequest"/></operation>
    <operation name="describeTable"><input message="tns:describeTableRequest"/></operation>
    <operation name="selectRowset"><input message="tns:selectRowsetRequest"/></operation>
  </portType>
  <binding name="ApiBinding" type="tns:ApiPort">
    <soap:binding style="rpc" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="insertRowset">
      <soap:operation soapAction="urn:insertRowset"/>
      <input><soap:body use="encoded" namespace="urn:rtu-api" encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"/></input>
    </operation>
    <operation name="describeTable">
      <soap:operation soapAction="urn:rtu-api#describeTable"/>
      <input><soap:body use="encoded" namespace="urn:rtu-api" encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"/></input>
    </operation>
    <operation name="selectRowset">
      <soap:operation soapAction="urn:rtu-api#selectRowset"/>
      <input><soap:body use="encoded" namespace="urn:rtu-api" encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"/></input>
    </operation>
  </binding>
  <service name="Api">
    <port name="ApiPort" binding="tns:ApiBinding">
      <soap:address location="https://rtu.example/service/"/>
    </port>
  </service>
</definitions>`;

const DOC_WSDL = `<?xml version="1.0"?>
<definitions xmlns="http://schemas.xmlsoap.org/wsdl/"
 xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
 targetNamespace="urn:rtu-api">
  <types>
    <schema xmlns="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:rtu-api">
      <element name="describeTable">
        <complexType><sequence>
          <element name="p_object_id" type="xsd:string"/>
        </sequence></complexType>
      </element>
      <element name="selectRowset">
        <complexType><sequence>
          <element name="p_table_hi" type="xsd:string"/>
          <element name="p_filter" type="xsd:string"/>
          <element name="p_sort" type="xsd:string"/>
          <element name="p_limit" type="xsd:int"/>
          <element name="p_offset" type="xsd:int"/>
          <element name="p_columns" maxOccurs="unbounded">
            <complexType><sequence>
              <element name="item" type="xsd:string"/>
            </sequence></complexType>
          </element>
        </sequence></complexType>
      </element>
    </schema>
  </types>
  <portType name="ApiPort">
    <operation name="describeTable"><input message="describeTableRequest"/></operation>
    <operation name="selectRowset"><input message="selectRowsetRequest"/></operation>
  </portType>
  <binding name="ApiBinding" type="ApiPort">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="describeTable">
      <soap:operation soapAction="urn:describeTable"/>
      <input><soap:body use="literal"/></input>
    </operation>
    <operation name="selectRowset">
      <soap:operation soapAction="urn:selectRowset"/>
      <input><soap:body use="literal"/></input>
    </operation>
  </binding>
  <service name="Api">
    <port name="ApiPort" binding="ApiBinding">
      <soap:address location="https://rtu.example/service/"/>
    </port>
  </service>
</definitions>`;

function rpcReads(): { describeTable: CallBinding; selectRowset: CallBinding } {
  const plan = readCallReads(RPC_WSDL, ORIGIN);
  if (!plan.ok) throw new Error(plan.reason);
  return plan;
}

describe("readCallReads", () => {
  it("reads the two named operations and ignores insertRowset", () => {
    const plan = readCallReads(RPC_WSDL, ORIGIN);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.endpoint).toBe("https://rtu.example/service/");
    expect(plan.describeTable.operation).toBe("describeTable");
    expect(plan.selectRowset.operation).toBe("selectRowset");
    if (plan.selectRowset.kind !== "rpc-encoded") throw new Error("expected rpc");
    expect(plan.selectRowset.parts[0]).toBe("p_sort");
  });

  it("rejects a WSDL that only offers a write", () => {
    const plan = readCallReads(
      RPC_WSDL.replaceAll("describeTable", "deleteRowset").replaceAll("selectRowset", "updateRowset"),
      ORIGIN,
    );
    expect(plan.ok).toBe(false);
  });
});

describe("live-call envelopes", () => {
  it("builds describeTable and selectRowset with nil filter and a fixed page", () => {
    const { describeTable, selectRowset } = rpcReads();
    const described = buildDescribeTableEnvelope(describeTable, "admin", "s3cret", "08.2504.01");
    const selected = buildSelectRowsetEnvelope(selectRowset, "admin", "s3cret", "08.2504.01", [
      "conf_id",
      "t_start",
    ]);
    expect(described).toContain("<ns1:describeTable ");
    expect(described).not.toContain("selectRowset");
    expect(selected).toContain("<ns1:selectRowset ");
    expect(selected.indexOf("<p_sort ")).toBeLessThan(selected.indexOf("<p_table_hi "));
    expect(selected).toContain('<p_filter xsi:nil="true"/>');
    expect(selected).toContain('<p_sort xsi:nil="true"/>');
    expect(selected).toContain(`<p_limit xsi:type="xsd:int">${SELECT_ROW_LIMIT}</p_limit>`);
    expect(selected).toContain('<p_offset xsi:type="xsd:int">0</p_offset>');
    expect(selected).toContain("<item xsi:type=\"xsd:string\">conf_id</item>");
    expect(selected).not.toContain("args:node");
    expect(selected).not.toContain("deleteRowset");
    expect(selected).not.toContain("insertRowset");
    expect(selected).not.toContain("http://mfisoft.ru/auth");
    expect(selected).not.toContain("<p_filter></p_filter>");
    expect(selected).not.toContain("<p_filter/>");
  });

  it("rejects an object id that is not a dotted numeric id", () => {
    const { selectRowset } = rpcReads();
    expect(() =>
      buildSelectRowsetEnvelope(selectRowset, "admin", "s3cret", "08.2504.01|node=ss7", ["conf_id"]),
    ).toThrow(/object id/);
  });

  it("encodes a document column list as items", () => {
    const plan = readCallReads(DOC_WSDL, ORIGIN);
    if (!plan.ok) throw new Error(plan.reason);
    const selected = buildSelectRowsetEnvelope(plan.selectRowset, "admin", "s3cret", "08.2504.01", [
      "conf_id",
    ]);
    expect(selected).toContain("<selectRowset ");
    expect(selected).toContain("<p_columns><item>conf_id</item></p_columns>");
    expect(selected).toContain('<p_filter xsi:nil="true"/>');
    expect(selected).toContain(`<p_limit>${SELECT_ROW_LIMIT}</p_limit>`);
  });
});

describe("live-call responses", () => {
  it("treats a fault as a fault and an empty response as no rows", () => {
    const fault = interpretSelectRowset(
      `<?xml version="1.0"?><Envelope><Body><Fault><faultstring>secret-pass denied</faultstring></Fault></Body></Envelope>`,
      "secret-pass",
    );
    expect(fault.kind).toBe("fault");
    if (fault.kind === "fault") expect(fault.detail).not.toContain("secret-pass");

    const empty = interpretSelectRowset(
      `<?xml version="1.0"?><Envelope><Body><selectRowsetResponse/></Body></Envelope>`,
      "",
    );
    expect(empty).toEqual({ kind: "rows", rows: [] });

    const html = interpretSelectRowset(`<?xml version="1.0"?><html><body>ok</body></html>`, "");
    expect(html.kind).toBe("bad");
  });

  it("reads name/value rows and column titles", () => {
    const rows = interpretSelectRowset(
      `<?xml version="1.0"?><Envelope><Body><selectRowsetResponse>
        <item>
          <item><name>conf_id</name><value>c1</value></item>
          <item><name>t_start</name><value></value></item>
        </item>
      </selectRowsetResponse></Body></Envelope>`,
      "",
    );
    expect(rows).toEqual({ kind: "rows", rows: [{ conf_id: "c1", t_start: "" }] });

    const columns = interpretDescribeTable(
      `<?xml version="1.0"?><Envelope><Body><describeTableResponse>
        <columns><item>
          <name>t_start</name>
          <title>Время начала</title>
          <type>column</type>
          <data_type>datetime</data_type>
          <data_mask>YMDhms</data_mask>
        </item></columns>
        <procedure_context><item>
          <name>drop_call</name>
          <title>Удалить</title>
          <direction>in</direction>
        </item></procedure_context>
      </describeTableResponse></Body></Envelope>`,
      "",
    );
    expect(columns).toEqual({
      kind: "columns",
      columns: [{ name: "t_start", title: "Время начала", dataMask: "YMDhms" }],
    });
  });
});
