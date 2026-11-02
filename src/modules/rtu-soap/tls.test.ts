import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseRtuCaPem } from "@/modules/rtu-soap/ca";
import { probeRtuSoapAccess } from "@/modules/rtu-soap/probe";
import { settingsUpdateSchema } from "@/modules/settings/schemas";

const PASSWORD = "s3cret";
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function openssl(dir: string, args: string[]) {
  execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
}

function selfSigned(dir: string, name: string, extra: string[]) {
  openssl(dir, [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-keyout",
    `${name}.key`,
    "-out",
    `${name}.pem`,
    "-nodes",
    "-subj",
    "/CN=rtu.example",
    "-addext",
    "subjectAltName=DNS:rtu.example",
    ...extra,
  ]);
  return {
    cert: readFileSync(join(dir, `${name}.pem`), "utf8"),
    key: readFileSync(join(dir, `${name}.key`), "utf8"),
  };
}

function signedLeaf(dir: string) {
  openssl(dir, [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-keyout",
    "ca.key",
    "-out",
    "ca.pem",
    "-days",
    "2",
    "-nodes",
    "-subj",
    "/CN=TestCA",
  ]);
  openssl(dir, [
    "req",
    "-newkey",
    "rsa:2048",
    "-keyout",
    "srv.key",
    "-out",
    "srv.csr",
    "-nodes",
    "-subj",
    "/CN=rtu.example",
    "-addext",
    "subjectAltName=DNS:rtu.example",
  ]);
  openssl(dir, [
    "x509",
    "-req",
    "-in",
    "srv.csr",
    "-CA",
    "ca.pem",
    "-CAkey",
    "ca.key",
    "-CAcreateserial",
    "-out",
    "srv.pem",
    "-days",
    "2",
    "-copy_extensions",
    "copy",
  ]);
  return {
    ca: readFileSync(join(dir, "ca.pem"), "utf8"),
    cert: readFileSync(join(dir, "srv.pem"), "utf8"),
    key: readFileSync(join(dir, "srv.key"), "utf8"),
  };
}

function wsdl(origin: string) {
  return `<?xml version="1.0"?>
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
  <portType name="ApiPort">
    <operation name="getObjects">
      <input message="tns:getObjectsRequest"/>
      <output message="tns:getObjectsResponse"/>
    </operation>
  </portType>
  <binding name="ApiBinding" type="tns:ApiPort">
    <soap:binding style="rpc" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="getObjects">
      <soap:operation soapAction="urn:rtu-api#getObjects"/>
      <input><soap:body use="encoded" namespace="urn:rtu-api" encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"/></input>
      <output><soap:body use="encoded" namespace="urn:rtu-api" encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"/></output>
    </operation>
  </binding>
  <service name="Api">
    <port name="ApiPort" binding="tns:ApiBinding">
      <soap:address location="${origin}/service/"/>
    </port>
  </service>
</definitions>`;
}

const OBJECTS = `<?xml version="1.0"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
  <SOAP-ENV:Body>
    <getObjectsResponse>
      <item>
        <object_id>02.2200.01</object_id>
        <title>System</title>
        <path>Global</path>
        <type>table</type>
      </item>
    </getObjectsResponse>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

async function withServer(
  material: { cert: string; key: string },
  run: (origin: string, hits: { method: string; body: string }[]) => Promise<void>,
) {
  const hits: { method: string; body: string }[] = [];
  let origin = "";
  const server = https.createServer({ cert: material.cert, key: material.key }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      hits.push({ method: req.method ?? "", body });
      const url = req.url ?? "";
      res.writeHead(200, { "Content-Type": "text/xml" });
      res.end(url.includes("wsdl") ? wsdl(origin) : OBJECTS);
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  origin = `https://127.0.0.1:${port}`;
  const previous = process.env.NODE_EXTRA_CA_CERTS;
  delete process.env.NODE_EXTRA_CA_CERTS;
  try {
    await run(origin, hits);
  } finally {
    if (previous === undefined) delete process.env.NODE_EXTRA_CA_CERTS;
    else process.env.NODE_EXTRA_CA_CERTS = previous;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("RTU SOAP certificate pin", () => {
  it("accepts a pasted self-signed leaf for an IP and does not send the password before that", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rtu-ca-"));
    dirs.push(dir);
    const leaf = selfSigned(dir, "leaf", ["-days", "2"]);
    const parsed = parseRtuCaPem(leaf.cert);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(
      settingsUpdateSchema.parse({ rtuSoapCaPem: leaf.cert }).rtuSoapCaPem,
    ).toContain("BEGIN CERTIFICATE");

    await withServer(leaf, async (origin, hits) => {
      const rejected = await probeRtuSoapAccess({
        origin,
        login: "admin",
        password: PASSWORD,
        wsdlTimeoutMs: 5_000,
        callTimeoutMs: 5_000,
      });
      expect(rejected.code).toBe("tls");
      expect(rejected.detail).toContain("Издатель");
      expect(hits).toHaveLength(0);
      expect(JSON.stringify(hits)).not.toContain(PASSWORD);

      const accepted = await probeRtuSoapAccess({
        origin,
        login: "admin",
        password: PASSWORD,
        caPem: leaf.cert,
        wsdlTimeoutMs: 5_000,
        callTimeoutMs: 5_000,
      });
      expect(accepted.code).toBe("ok");
      expect(accepted.tableCount).toBe(1);
      expect(hits.some((hit) => hit.method === "POST" && hit.body.includes(PASSWORD))).toBe(true);
      expect(hits.some((hit) => hit.body.includes("insertRowset"))).toBe(false);
      expect(hits.some((hit) => hit.body.includes("getObjects"))).toBe(true);
    });
  });

  it("does not accept another leaf just because its CA was pasted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rtu-ca-"));
    dirs.push(dir);
    const signed = signedLeaf(dir);
    await withServer(
      { cert: `${signed.cert}\n${signed.ca}`, key: signed.key },
      async (origin, hits) => {
        const result = await probeRtuSoapAccess({
          origin,
          login: "admin",
          password: PASSWORD,
          caPem: signed.ca,
          wsdlTimeoutMs: 5_000,
          callTimeoutMs: 5_000,
        });
        expect(result.code).toBe("tls");
        expect(result.detail).toContain("Имя в сертификате");
        expect(hits).toHaveLength(0);
        expect(result.peerFingerprint).toBeTruthy();
        const ca = parseRtuCaPem(signed.ca);
        expect(ca.ok).toBe(true);
        if (!ca.ok) return;
        expect(result.peerFingerprint?.toUpperCase()).not.toBe(
          ca.ca.certs[0]?.fingerprint256.toUpperCase(),
        );
      },
    );
  });

  it("rejects an expired pasted leaf and an unreadable extra CA file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rtu-ca-"));
    dirs.push(dir);
    const expired = selfSigned(dir, "old", [
      "-not_before",
      "20200101000000Z",
      "-not_after",
      "20200102000000Z",
    ]);
    await withServer(expired, async (origin, hits) => {
      const result = await probeRtuSoapAccess({
        origin,
        login: "admin",
        password: PASSWORD,
        caPem: expired.cert,
        wsdlTimeoutMs: 5_000,
        callTimeoutMs: 5_000,
      });
      expect(result.code).toBe("tls");
      expect(result.detail).toContain("Срок");
      expect(hits).toHaveLength(0);

      process.env.NODE_EXTRA_CA_CERTS = join(dir, "missing.pem");
      const missing = await probeRtuSoapAccess({
        origin,
        login: "admin",
        password: PASSWORD,
        caPem: expired.cert,
        wsdlTimeoutMs: 5_000,
        callTimeoutMs: 5_000,
      });
      expect(missing.detail).toContain("NODE_EXTRA_CA_CERTS");
      expect(hits).toHaveLength(0);
    });
  });
});
