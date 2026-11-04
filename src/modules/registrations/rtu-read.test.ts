import { describe, expect, it } from "vitest";
import { SELECT_ROW_LIMIT } from "@/modules/rtu-soap/envelope";
import {
  collectRegistrationPages,
  readRegistrations,
  type RegistrationsExchange,
} from "@/modules/registrations/rtu-read";

const ORIGIN = "https://rtu.example";
const PASSWORD = "s3cret";
const PCOMM_ID = "06.1501.01";
const PUPR_ID = "06.1502.01";
const DECOY_ID = "06.1599.01";

const WSDL = `<?xml version="1.0"?>
<definitions xmlns="http://schemas.xmlsoap.org/wsdl/"
 xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
 xmlns:tns="urn:rtu-api"
 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
 xmlns:soapenc="http://schemas.xmlsoap.org/soap/encoding/"
 targetNamespace="urn:rtu-api">
  <message name="getObjectsRequest"><part name="p_types" type="soapenc:Array"/></message>
  <message name="describeTableRequest"><part name="p_object_id" type="xsd:string"/></message>
  <message name="selectRowsetRequest">
    <part name="p_table_hi" type="xsd:string"/>
    <part name="p_filter" type="xsd:string"/>
    <part name="p_sort" type="xsd:string"/>
    <part name="p_limit" type="xsd:int"/>
    <part name="p_offset" type="xsd:int"/>
    <part name="p_columns" type="soapenc:Array"/>
  </message>
  <message name="getLookupRequest">
    <part name="p_object_id" type="xsd:string"/>
    <part name="p_column_nm" type="xsd:string"/>
  </message>
  <portType name="ApiPort">
    <operation name="getObjects"><input message="tns:getObjectsRequest"/></operation>
    <operation name="describeTable"><input message="tns:describeTableRequest"/></operation>
    <operation name="selectRowset"><input message="tns:selectRowsetRequest"/></operation>
    <operation name="getLookup"><input message="tns:getLookupRequest"/></operation>
  </portType>
  <binding name="ApiBinding" type="tns:ApiPort">
    <soap:binding style="rpc" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="getObjects">
      <soap:operation soapAction="urn:rtu-api#getObjects"/>
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
    <operation name="getLookup">
      <soap:operation soapAction="urn:rtu-api#getLookup"/>
      <input><soap:body use="encoded" namespace="urn:rtu-api" encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"/></input>
    </operation>
  </binding>
  <service name="Api">
    <port name="ApiPort" binding="tns:ApiBinding">
      <soap:address location="https://rtu.example/service/"/>
    </port>
  </service>
</definitions>`;

function objectItem(objectId: string, title: string, path: string): string {
  return `<item><object_id>${objectId}</object_id><title>${title}</title><path>${path}</path><type>table</type></item>`;
}

const OBJECTS = `<?xml version="1.0"?>
<Envelope><Body><getObjectsResponse>
  ${objectItem(PCOMM_ID, "Регистрации (ПКомм)", "Мониторинг ПКомм;Регистрации (ПКомм)")}
  ${objectItem(DECOY_ID, "Регистрации (ПКомм)", "Мониторинг ПКомм;Данные по модулям;;Регистрации (ПКомм)")}
  ${objectItem(PUPR_ID, "Регистрации (ПУпр)", "Мониторинг ПКомм;Регистрации (ПУпр)")}
</getObjectsResponse></Body></Envelope>`;

function column(name: string, title: string, lookup = ""): string {
  return `<item><name>${name}</name><title>${title}</title><type>column</type><data_type>string</data_type><have_lookup>${lookup}</have_lookup></item>`;
}

const PCOMM_DESCRIBE = `<?xml version="1.0"?><Envelope><Body><describeTableResponse><columns>
  ${column("reg_id", "ID регистрации")}
  ${column("reg_name", "Имя")}
  ${column("reg_alias", "Алиасы")}
  ${column("reg_addr", "Адрес")}
  ${column("reg_state", "Состояние")}
</columns></describeTableResponse></Body></Envelope>`;

const PUPR_DESCRIBE = `<?xml version="1.0"?><Envelope><Body><describeTableResponse><columns>
  ${column("reg_id", "ID регистрации")}
  ${column("eq_id", "ID оборудования")}
  ${column("reg_agent", "Агент пользователя")}
</columns></describeTableResponse></Body></Envelope>`;

function row(cells: Array<[string, string]>): string {
  return `<item>${cells
    .map(([name, value]) => `<item><name>${name}</name><value>${value}</value></item>`)
    .join("")}</item>`;
}

const PCOMM_ROWS = `<?xml version="1.0"?><Envelope><Body><selectRowsetResponse>
  ${row([
    ["reg_id", "1"],
    ["reg_name", "100"],
    ["reg_alias", ""],
    ["reg_addr", "1.2.3.4:5060"],
    ["reg_state", "Зарегистрирован"],
  ])}
</selectRowsetResponse></Body></Envelope>`;

const PUPR_ROWS = `<?xml version="1.0"?><Envelope><Body><selectRowsetResponse>
  ${row([
    ["reg_id", "1"],
    ["reg_agent", "Yealink"],
  ])}
</selectRowsetResponse></Body></Envelope>`;

const LOOKUP = `<?xml version="1.0"?><Envelope><Body><getLookupResponse>
  <item><key>1</key><value>Зарегистрирован</value></item>
</getLookupResponse></Body></Envelope>`;

const FORBIDDEN = [
  "insertRowset",
  "deleteRowset",
  "updateRowset",
  "checkRowset",
  "args:node",
  'xmlns="args"',
  "http://mfisoft.ru/auth",
];

function harness(input?: {
  pcommDescribe?: string;
  pcommRows?: string;
  allowLookup?: boolean;
}): { exchange: RegistrationsExchange; bodies: string[] } {
  const bodies: string[] = [];
  const exchange: RegistrationsExchange = async (call) => {
    if (call.method === "GET") {
      expect(call.timeoutMs).toBe(10_000);
      expect(call.url).toBe(`${ORIGIN}/service/?wsdl_v2`);
      return { ok: true, status: 200, text: WSDL };
    }
    expect(call.timeoutMs).toBe(12_000);
    const body = call.body ?? "";
    bodies.push(body);
    for (const token of FORBIDDEN) expect(body).not.toContain(token);
    if (!input?.allowLookup) expect(body).not.toContain("getLookup");
    expect(body).not.toContain(DECOY_ID);
    if (body.includes("getObjects")) return { ok: true, status: 200, text: OBJECTS };
    if (body.includes("describeTable")) {
      return {
        ok: true,
        status: 200,
        text: body.includes(PUPR_ID) ? PUPR_DESCRIBE : (input?.pcommDescribe ?? PCOMM_DESCRIBE),
      };
    }
    if (body.includes("getLookup")) {
      expect(body).toContain(PCOMM_ID);
      expect(body).toContain("reg_state");
      return { ok: true, status: 200, text: LOOKUP };
    }
    if (body.includes("selectRowset")) {
      expect(body).toContain(String(SELECT_ROW_LIMIT));
      if (body.includes(PUPR_ID)) {
        expect(body).toContain("reg_agent");
        expect(body).not.toContain("eq_id");
        return { ok: true, status: 200, text: PUPR_ROWS };
      }
      expect(body).toContain("reg_name");
      expect(body).toContain("reg_state");
      return { ok: true, status: 200, text: input?.pcommRows ?? PCOMM_ROWS };
    }
    throw new Error("unexpected call");
  };
  return { exchange, bodies };
}

const account = {
  origin: ORIGIN,
  login: "reader",
  password: PASSWORD,
  caPem: null,
};

describe("readRegistrations", () => {
  it("reads both summary pages and skips the per-module copy", async () => {
    const { exchange } = harness();
    const result = await readRegistrations({ account, exchange });
    expect(result).toEqual({
      ok: true,
      pcomm: [
        {
          id: "1",
          name: "100",
          aliases: "",
          address: "1.2.3.4:5060",
          state: "Зарегистрирован",
        },
      ],
      pupr: [{ id: "1", userAgent: "Yealink" }],
    });
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
  });

  it("fails before select when the registration id is a lookup", async () => {
    const { exchange, bodies } = harness({
      pcommDescribe: `<?xml version="1.0"?><Envelope><Body><describeTableResponse><columns>
        ${column("reg_id", "ID регистрации", "1")}
        ${column("reg_name", "Имя")}
        ${column("reg_alias", "Алиасы")}
        ${column("reg_addr", "Адрес")}
        ${column("reg_state", "Состояние")}
      </columns></describeTableResponse></Body></Envelope>`,
    });
    const result = await readRegistrations({ account, exchange });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain("ID регистрации");
    expect(bodies.some((body) => body.includes("selectRowset"))).toBe(false);
  });

  it("resolves the state label when the column has a lookup", async () => {
    const { exchange } = harness({
      allowLookup: true,
      pcommRows: PCOMM_ROWS.replace("Зарегистрирован", "1"),
      pcommDescribe: `<?xml version="1.0"?><Envelope><Body><describeTableResponse><columns>
        ${column("reg_id", "ID регистрации")}
        ${column("reg_name", "Имя")}
        ${column("reg_alias", "Алиасы")}
        ${column("reg_addr", "Адрес")}
        ${column("reg_state", "Состояние", "1")}
      </columns></describeTableResponse></Body></Envelope>`,
    });
    const result = await readRegistrations({ account, exchange });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pcomm[0]?.state).toBe("Зарегистрирован");
  });
});

describe("collectRegistrationPages", () => {
  it("fails when the fifth page is still full", async () => {
    const result = await collectRegistrationPages(async (offset) => {
      expect(offset % SELECT_ROW_LIMIT).toBe(0);
      return {
        ok: true,
        rows: Array.from({ length: SELECT_ROW_LIMIT }, (_, index) => ({
          reg_id: `${offset + index}`,
        })),
      };
    }, "reg_id");
    expect(result).toEqual({
      ok: false,
      detail: "Список регистраций прочитан не целиком.",
    });
  });
});
