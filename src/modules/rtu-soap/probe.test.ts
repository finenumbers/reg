import { describe, expect, it } from "vitest";
import { buildGetObjectsEnvelope } from "@/modules/rtu-soap/envelope";
import { parseRtuSoapOrigin, pinSoapEndpoint } from "@/modules/rtu-soap/origin";
import { openRtuSoapPassword } from "@/modules/rtu-soap/password";
import { probeRtuSoapAccess } from "@/modules/rtu-soap/probe";
import { acquireRtuSoapTest, releaseRtuSoapTest } from "@/modules/rtu-soap/flight";
import { readWsdl, type GetObjectsBinding } from "@/modules/rtu-soap/wsdl";

const ORIGIN = "https://rtu.example";
const PASSWORD = "s3cret";

const RPC_WSDL = `<?xml version="1.0"?>
<definitions xmlns="http://schemas.xmlsoap.org/wsdl/"
 xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
 xmlns:tns="urn:rtu-api"
 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
 xmlns:soapenc="http://schemas.xmlsoap.org/soap/encoding/"
 targetNamespace="urn:rtu-api">
  <message name="getObjectsRequest">
    <part name="p_types" type="soapenc:Array"/>
  </message>
  <message name="getObjectsResponse">
    <part name="return" type="xsd:string"/>
  </message>
  <message name="insertRowsetRequest">
    <part name="p_table_hi" type="xsd:string"/>
  </message>
  <portType name="ApiPort">
    <operation name="insertRowset">
      <input message="tns:insertRowsetRequest"/>
      <output message="tns:getObjectsResponse"/>
    </operation>
    <operation name="getObjects">
      <input message="tns:getObjectsRequest"/>
      <output message="tns:getObjectsResponse"/>
    </operation>
  </portType>
  <binding name="ApiBinding" type="tns:ApiPort">
    <soap:binding style="rpc" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="insertRowset">
      <soap:operation soapAction="urn:insertRowset"/>
      <input><soap:body use="encoded" namespace="urn:rtu-api" encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"/></input>
      <output><soap:body use="encoded" namespace="urn:rtu-api" encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"/></output>
    </operation>
    <operation name="getObjects">
      <soap:operation soapAction="urn:rtu-api#getObjects"/>
      <input><soap:body use="encoded" namespace="urn:rtu-api" encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"/></input>
      <output><soap:body use="encoded" namespace="urn:rtu-api" encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"/></output>
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
      <element name="getObjects">
        <complexType>
          <sequence>
            <element name="p_types" type="xsd:string" maxOccurs="unbounded"/>
          </sequence>
        </complexType>
      </element>
    </schema>
  </types>
  <message name="getObjectsRequest"/>
  <portType name="ApiPort">
    <operation name="getObjects">
      <input message="getObjectsRequest"/>
      <output message="getObjectsResponse"/>
    </operation>
  </portType>
  <binding name="ApiBinding" type="ApiPort">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="getObjects">
      <soap:operation soapAction="urn:getObjects"/>
      <input><soap:body use="literal"/></input>
      <output><soap:body use="literal"/></output>
    </operation>
  </binding>
  <service name="Api">
    <port name="ApiPort" binding="ApiBinding">
      <soap:address location="https://rtu.example/service/"/>
    </port>
  </service>
</definitions>`;

function objectsResponse(): string {
  return `<?xml version="1.0"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
  <SOAP-ENV:Body>
    <getObjectsResponse>
      <item>
        <object_id>02.2200.01</object_id>
        <title>System global settings</title>
        <path>Global settings</path>
        <type>table</type>
      </item>
      <item>
        <object_id>02.2221.01</object_id>
        <title>Create report</title>
        <path>Statistics;Reports</path>
        <type>procedure</type>
      </item>
    </getObjectsResponse>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
}

function fetchScripted(
  calls: { url: string; method: string; body?: string }[],
  respond: (url: string, init?: RequestInit) => Response,
): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return respond(url, init);
  };
}

describe("RTU SOAP origin", () => {
  it("keeps an https origin and rejects http, userinfo, and a path", () => {
    expect(parseRtuSoapOrigin(" https://rtu.example/ ")).toBe("https://rtu.example");
    expect(parseRtuSoapOrigin("http://rtu.example")).toBeNull();
    expect(parseRtuSoapOrigin("https://user:pw@rtu.example")).toBeNull();
    expect(parseRtuSoapOrigin("https://rtu.example/service")).toBeNull();
    expect(parseRtuSoapOrigin("https://rtu.example?wsdl")).toBeNull();
  });

  it("pins the SOAP path to the configured host", () => {
    expect(pinSoapEndpoint(ORIGIN, "https://rtu.example/service/")).toBe(
      "https://rtu.example/service/",
    );
    expect(pinSoapEndpoint(ORIGIN, "/service/index.php")).toBe(
      "https://rtu.example/service/index.php",
    );
    expect(pinSoapEndpoint(ORIGIN, "https://evil.example/service/")).toBeNull();
    expect(pinSoapEndpoint(ORIGIN, "http://rtu.example/service/")).toBeNull();
  });
});

describe("RTU SOAP password", () => {
  it("does not turn a decrypt failure into an empty password", () => {
    expect(openRtuSoapPassword(null, () => "x")).toEqual({
      ok: false,
      code: "INCOMPLETE",
    });
    expect(openRtuSoapPassword("cipher", () => "")).toEqual({
      ok: false,
      code: "DECRYPT_FAILED",
    });
    expect(
      openRtuSoapPassword("cipher", () => {
        throw new Error("bad");
      }),
    ).toEqual({ ok: false, code: "DECRYPT_FAILED" });
    expect(openRtuSoapPassword("cipher", () => "  keep  ")).toEqual({
      ok: true,
      password: "  keep  ",
    });
  });
});

describe("getObjects envelope", () => {
  const rpc: GetObjectsBinding = {
    kind: "rpc-encoded",
    operationNamespace: "urn:rtu-api",
    soapAction: "urn:rtu-api#getObjects",
    partName: "p_types",
    nilParent: false,
  };

  it("builds only getObjects and escapes the password", () => {
    const body = buildGetObjectsEnvelope(rpc, `a<b>&"'`, `p<q>&${PASSWORD}`);
    expect(body).toContain("<ns1:getObjects");
    expect(body).toContain(">table<");
    expect(body).toContain(">procedure<");
    expect(body).toContain("&lt;");
    expect(body).toContain("&amp;");
    expect(body).not.toContain("<b>");
    expect(body).not.toContain(`p<q>`);
    for (const name of [
      "insertRowset",
      "updateRowset",
      "deleteRowset",
      "transaction",
      "checkRowset",
      "callContext",
    ]) {
      expect(body).not.toContain(name);
    }
    expect(body).not.toMatch(/\bcall\b/);
    expect(body).not.toContain("http://mfisoft.ru/auth");
    expect(body).not.toContain("p_parent_id");
  });

  it("sends a nil parent when the WSDL lists that part", () => {
    const body = buildGetObjectsEnvelope({ ...rpc, nilParent: true }, "admin", PASSWORD);
    expect(body.indexOf("<p_types ")).toBeLessThan(body.indexOf("<p_parent_id "));
    expect(body).toContain('<p_parent_id xsi:nil="true"/>');
    expect(body).not.toContain("deleteRowset");
  });

  it("reads p_parent_id from the live message shape", () => {
    const withParent = RPC_WSDL.replace(
      `<part name="p_types" type="soapenc:Array"/>`,
      `<part name="p_types" type="soapenc:Array"/><part name="p_parent_id" type="xsd:string"/>`,
    );
    const listed = readWsdl(withParent, ORIGIN);
    const plain = readWsdl(RPC_WSDL, ORIGIN);
    if (!listed.ok || listed.binding.kind !== "rpc-encoded") throw new Error("parent wsdl");
    if (!plain.ok || plain.binding.kind !== "rpc-encoded") throw new Error("plain wsdl");
    expect(listed.binding.nilParent).toBe(true);
    expect(plain.binding.nilParent).toBe(false);
  });
});

describe("RTU SOAP access probe", () => {
  it("names a hostname mismatch instead of an unknown issuer", async () => {
    const result = await probeRtuSoapAccess({
      origin: ORIGIN,
      login: "admin",
      password: PASSWORD,
      fetchImpl: async () => {
        const error = new TypeError("fetch failed");
        (error as { cause?: unknown }).cause = {
          cause: { code: "ERR_TLS_CERT_ALTNAME_INVALID" },
        };
        throw error;
      },
    });
    expect(result.code).toBe("tls");
    expect(result.detail).toContain("Имя в сертификате");
    expect(result.detail).not.toContain("NODE_EXTRA_CA_CERTS");
  });

  it("keeps an unknown issuer distinct from a broken handshake", async () => {
    const issuer = await probeRtuSoapAccess({
      origin: ORIGIN,
      login: "admin",
      password: PASSWORD,
      fetchImpl: async () => {
        throw Object.assign(new TypeError("fetch failed"), {
          cause: { code: "DEPTH_ZERO_SELF_SIGNED_CERT" },
        });
      },
    });
    expect(issuer.detail).toContain("Издатель");

    const other = await probeRtuSoapAccess({
      origin: ORIGIN,
      login: "admin",
      password: PASSWORD,
      fetchImpl: async () => {
        throw Object.assign(new TypeError("fetch failed"), {
          cause: { code: "ERR_TLS_HANDSHAKE_TIMEOUT" },
        });
      },
    });
    expect(other.code).toBe("tls");
    expect(other.detail).toBe("Соединение TLS оборвалось.");
  });

  it("does not fetch when the stored certificate is not PEM", async () => {
    let called = false;
    const result = await probeRtuSoapAccess({
      origin: ORIGIN,
      login: "admin",
      password: PASSWORD,
      caPem: "not a certificate",
      fetchImpl: async () => {
        called = true;
        return new Response("");
      },
    });
    expect(called).toBe(false);
    expect(result.code).toBe("tls");
    expect(result.detail).toContain("не разбирается");
  });

  it("does not call the network when the password is empty", async () => {
    let called = false;
    const fetchImpl: typeof fetch = async () => {
      called = true;
      return new Response("");
    };
    const result = await probeRtuSoapAccess({
      origin: ORIGIN,
      login: "admin",
      password: "",
      fetchImpl,
    });
    expect(called).toBe(false);
    expect(result.code).toBe("wsdl");
  });

  it("does not send the password when the WSDL address is a foreign host", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const wsdl = RPC_WSDL.replace(
      "https://rtu.example/service/",
      "https://evil.example/steal",
    );
    const result = await probeRtuSoapAccess({
      origin: ORIGIN,
      login: "admin",
      password: PASSWORD,
      fetchImpl: fetchScripted(calls, () => new Response(wsdl, { status: 200 })),
    });
    expect(result.code).toBe("wsdl");
    expect(result.detail).toContain("Пароль не отправлен");
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls)).not.toContain(PASSWORD);
  });

  it("rejects a doctype before sending the password", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const result = await probeRtuSoapAccess({
      origin: ORIGIN,
      login: "admin",
      password: PASSWORD,
      fetchImpl: fetchScripted(
        calls,
        () => new Response(`<!DOCTYPE foo [<!ENTITY x "y">]><definitions/>`, { status: 200 }),
      ),
    });
    expect(result.code).toBe("wsdl");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toBeUndefined();
  });

  it("does not send the password when the binding is not understood", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const wsdl = RPC_WSDL.replaceAll('use="encoded"', 'use="literal"');
    const result = await probeRtuSoapAccess({
      origin: ORIGIN,
      login: "admin",
      password: PASSWORD,
      fetchImpl: fetchScripted(calls, () => new Response(wsdl, { status: 200 })),
    });
    expect(result.code).toBe("wsdl");
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls)).not.toContain(PASSWORD);
  });

  it("reads an empty catalog as success", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const empty = `<?xml version="1.0"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><getObjectsResponse/></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
    const result = await probeRtuSoapAccess({
      origin: ORIGIN,
      login: "admin",
      password: PASSWORD,
      fetchImpl: fetchScripted(calls, (url) =>
        new Response(url.includes("wsdl") ? RPC_WSDL : empty, { status: 200 }),
      ),
    });
    expect(result.code).toBe("ok");
    expect(result.tableCount).toBe(0);
    expect(result.procedureCount).toBe(0);
    expect(calls[1]?.method).toBe("POST");
    expect(calls[1]?.body).toContain("getObjects");
    expect(calls[1]?.body).not.toContain("insertRowset");
  });

  it("counts tables and procedures and keeps a fault unclassified", async () => {
    const listed = await probeRtuSoapAccess({
      origin: ORIGIN,
      login: "admin",
      password: PASSWORD,
      previewLimit: 1,
      fetchImpl: fetchScripted([], (url) =>
        new Response(url.includes("wsdl") ? RPC_WSDL : objectsResponse(), { status: 200 }),
      ),
    });
    expect(listed.code).toBe("ok");
    expect(listed.tableCount).toBe(1);
    expect(listed.procedureCount).toBe(1);
    expect(listed.procedures[0]?.title).toBe("Create report");
    expect(listed.detail).not.toContain("только просмотр");

    const fault = await probeRtuSoapAccess({
      origin: ORIGIN,
      login: "admin",
      password: PASSWORD,
      fetchImpl: fetchScripted([], (url) =>
        new Response(
          url.includes("wsdl")
            ? RPC_WSDL
            : `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><SOAP-ENV:Fault><faultcode>SOAP-ENV:Client</faultcode><faultstring>Authentication failed: ${PASSWORD}</faultstring></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>`,
          { status: url.includes("wsdl") ? 200 : 500 },
        ),
      ),
    });
    expect(fault.code).toBe("fault");
    expect(fault.detail).not.toContain(PASSWORD);
    expect(fault.detail).toContain("[REDACTED]");
    expect(fault.detail).not.toMatch(/неверный пароль/i);
  });

  it("stops when the WSDL exceeds the byte cap", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const result = await probeRtuSoapAccess({
      origin: ORIGIN,
      login: "admin",
      password: PASSWORD,
      maxBytes: 32,
      fetchImpl: fetchScripted(calls, () => new Response(RPC_WSDL, { status: 200 })),
    });
    expect(result.code).toBe("too_large");
    expect(calls).toHaveLength(1);
  });

  it("reads a document-literal binding", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const result = await probeRtuSoapAccess({
      origin: ORIGIN,
      login: "admin",
      password: PASSWORD,
      fetchImpl: fetchScripted(calls, (url) =>
        new Response(url.includes("wsdl") ? DOC_WSDL : objectsResponse(), { status: 200 }),
      ),
    });
    expect(result.code).toBe("ok");
    expect(calls[1]?.body).toContain("<getObjects");
    expect(calls[1]?.body).toContain("<p_types>table</p_types>");
    expect(calls[1]?.body).not.toContain("insertRowset");
  });
});

describe("RTU SOAP single flight", () => {
  it("allows one check at a time", () => {
    expect(acquireRtuSoapTest()).toBe(true);
    expect(acquireRtuSoapTest()).toBe(false);
    releaseRtuSoapTest();
    expect(acquireRtuSoapTest()).toBe(true);
    releaseRtuSoapTest();
  });
});
