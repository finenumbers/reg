import { describe, expect, it } from "vitest";
import { SELECT_ROW_LIMIT } from "@/modules/rtu-soap/envelope";
import { assembleRegistrations } from "@/modules/registrations/rtu-rows";
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
const MODULES_ID = "08.2600.01";

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

const WSDL_NO_LOOKUP = WSDL.replace(
  `  <message name="getLookupRequest">
    <part name="p_object_id" type="xsd:string"/>
    <part name="p_column_nm" type="xsd:string"/>
  </message>
`,
  "",
)
  .replace(`    <operation name="getLookup"><input message="tns:getLookupRequest"/></operation>\n`, "")
  .replace(
    `    <operation name="getLookup">
      <soap:operation soapAction="urn:rtu-api#getLookup"/>
      <input><soap:body use="encoded" namespace="urn:rtu-api" encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"/></input>
    </operation>
`,
    "",
  );

const WSDL_COLUMN_LOOKUP = WSDL.replace(
  `  <message name="getLookupRequest">
    <part name="p_object_id" type="xsd:string"/>
    <part name="p_column_nm" type="xsd:string"/>
  </message>`,
  `  <message name="getColumnLookupRequest">
    <part name="p_table_hi" type="xsd:string"/>
    <part name="p_column_nm" type="xsd:string"/>
  </message>`,
).replaceAll("getLookup", "getColumnLookup");

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

const STATE_LOOKUP_DESCRIBE = `<?xml version="1.0"?><Envelope><Body><describeTableResponse><columns>
  ${column("reg_id", "ID регистрации")}
  ${column("reg_name", "Имя")}
  ${column("reg_alias", "Алиасы")}
  ${column("reg_addr", "Адрес")}
  ${column("reg_state", "Состояние", "1")}
</columns></describeTableResponse></Body></Envelope>`;

function harness(input?: {
  pcommDescribe?: string;
  pcommRows?: string;
  allowLookup?: boolean;
  wsdl?: string;
  lookupText?: string;
}): { exchange: RegistrationsExchange; bodies: string[] } {
  const bodies: string[] = [];
  const exchange: RegistrationsExchange = async (call) => {
    if (call.method === "GET") {
      expect(call.timeoutMs).toBe(10_000);
      expect(call.url).toBe(`${ORIGIN}/service/?wsdl_v2`);
      return { ok: true, status: 200, text: input?.wsdl ?? WSDL };
    }
    expect(call.timeoutMs).toBe(12_000);
    const body = call.body ?? "";
    bodies.push(body);
    for (const token of FORBIDDEN) expect(body).not.toContain(token);
    if (!input?.allowLookup) {
      expect(body).not.toContain("getLookup");
      expect(body).not.toContain("getColumnLookup");
    }
    expect(body).not.toContain(DECOY_ID);
    if (body.includes("getObjects")) return { ok: true, status: 200, text: OBJECTS };
    if (body.includes("describeTable")) {
      return {
        ok: true,
        status: 200,
        text: body.includes(PUPR_ID) ? PUPR_DESCRIBE : (input?.pcommDescribe ?? PCOMM_DESCRIBE),
      };
    }
    if (body.includes("getColumnLookup") || body.includes("getLookup")) {
      expect(body).toContain(PCOMM_ID);
      expect(body).toContain("reg_state");
      return { ok: true, status: 200, text: input?.lookupText ?? LOOKUP };
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

const TEMPLATE_OBJECTS = `<?xml version="1.0"?>
<Envelope><Body><getObjectsResponse>
  ${objectItem(PCOMM_ID, "Регистрации (ПКомм)", "Подсистема коммутации;Мониторинг ПКомм;Данные по модулям;;Регистрации")}
  ${objectItem(DECOY_ID, "Регистрации (ПКомм)", "Подсистема коммутации;Мониторинг ПКомм;Данные по модулям;signaling-1;Регистрации")}
  ${objectItem(PUPR_ID, "Регистрации (ПУпр)", "Подсистема коммутации;Мониторинг ПКомм;Данные по модулям;;Регистрации")}
  ${objectItem(MODULES_ID, "Активные модули", "Подсистема коммутации;Мониторинг ПКомм;Активные модули")}
</getObjectsResponse></Body></Envelope>`;

const MODULE_DESCRIBE = `<?xml version="1.0"?><Envelope><Body><describeTableResponse><columns>
  ${column("mod_nm", "Модуль")}
</columns></describeTableResponse></Body></Envelope>`;

const MODULE_ROWS = `<?xml version="1.0"?><Envelope><Body><selectRowsetResponse>
  ${row([["mod_nm", "media-1"]])}
  ${row([["mod_nm", "signaling-1"]])}
  ${row([["mod_nm", "scripting-1"]])}
</selectRowsetResponse></Body></Envelope>`;

const MODULE_FAULT = `<?xml version="1.0"?><Envelope><Body><Fault><faultstring>module down</faultstring></Fault></Body></Envelope>`;

function templateHarness(input?: {
  failSignaling?: boolean;
  moduleRows?: string;
}): { exchange: RegistrationsExchange; bodies: string[] } {
  const bodies: string[] = [];
  const exchange: RegistrationsExchange = async (call) => {
    if (call.method === "GET") return { ok: true, status: 200, text: WSDL };
    const body = call.body ?? "";
    bodies.push(body);
    for (const token of ["insertRowset", "deleteRowset", "updateRowset", "checkRowset", "http://mfisoft.ru/auth"]) {
      expect(body).not.toContain(token);
    }
    expect(body).not.toContain(DECOY_ID);
    if (body.includes("getObjects")) return { ok: true, status: 200, text: TEMPLATE_OBJECTS };
    if (body.includes("describeTable")) {
      expect(body).not.toContain("args:node");
      if (body.includes(MODULES_ID)) return { ok: true, status: 200, text: MODULE_DESCRIBE };
      return {
        ok: true,
        status: 200,
        text: body.includes(PUPR_ID) ? PUPR_DESCRIBE : PCOMM_DESCRIBE,
      };
    }
    if (body.includes("selectRowset") && body.includes(MODULES_ID)) {
      expect(body).not.toContain("args:node");
      const items = input?.moduleRows ?? MODULE_ROWS;
      return {
        ok: true,
        status: 200,
        text: items.startsWith("<?xml")
          ? items
          : `<?xml version="1.0"?><Envelope><Body><selectRowsetResponse>${items}</selectRowsetResponse></Body></Envelope>`,
      };
    }
    if (body.includes(">signaling-1<")) {
      expect(body).toContain(PCOMM_ID);
      expect(body).not.toContain(PUPR_ID);
      return {
        ok: true,
        status: 200,
        text: input?.failSignaling ? MODULE_FAULT : PCOMM_ROWS,
      };
    }
    if (body.includes(">scripting-1<")) {
      expect(body).toContain(PUPR_ID);
      expect(body).not.toContain("media-1");
      return { ok: true, status: 200, text: PUPR_ROWS };
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

  it("translates Passed through getColumnLookup from the WSDL", async () => {
    const { exchange, bodies } = harness({
      allowLookup: true,
      wsdl: WSDL_COLUMN_LOOKUP,
      pcommDescribe: STATE_LOOKUP_DESCRIBE,
      pcommRows: PCOMM_ROWS.replace("Зарегистрирован", "Passed"),
      lookupText: `<?xml version="1.0"?><Envelope><Body><getColumnLookupResponse>
        <item><key>Passed</key><value>Зарегистрирован</value></item>
      </getColumnLookupResponse></Body></Envelope>`,
    });
    const result = await readRegistrations({ account, exchange });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pcomm[0]?.state).toBe("Зарегистрирован");
    const lookups = bodies.filter((body) => body.includes("Lookup"));
    expect(lookups).toHaveLength(1);
    expect(lookups[0]).toContain("<ns1:getColumnLookup ");
    expect(lookups[0]).toContain("<p_table_hi ");
    expect(lookups[0]).not.toContain("<node ");
  });

  it("sends one handbook getLookup when the WSDL has neither lookup", async () => {
    const { exchange, bodies } = harness({
      allowLookup: true,
      wsdl: WSDL_NO_LOOKUP,
      pcommDescribe: STATE_LOOKUP_DESCRIBE,
      pcommRows: PCOMM_ROWS.replace("Зарегистрирован", "Passed"),
      lookupText: `<?xml version="1.0"?><Envelope><Body><getLookupResponse>
        <item><key>Passed</key><value>Зарегистрирован</value></item>
      </getLookupResponse></Body></Envelope>`,
    });
    const result = await readRegistrations({ account, exchange });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pcomm[0]?.state).toBe("Зарегистрирован");
    const lookups = bodies.filter((body) => body.includes("Lookup"));
    expect(lookups).toHaveLength(1);
    expect(lookups[0]).toContain("<ns1:getLookup ");
    expect(lookups[0]).toContain("<p_object_id ");
    expect(lookups[0]).toContain("<p_column_nm ");
    expect(lookups[0]).not.toContain("getColumnLookup");
    expect(lookups[0]).not.toContain("<node ");
  });

  it("does not send a second lookup when Passed stays untranslated", async () => {
    for (const lookupText of [
      `<?xml version="1.0"?><Envelope><Body><getLookupResponse></getLookupResponse></Body></Envelope>`,
      LOOKUP,
    ]) {
      const { exchange, bodies } = harness({
        allowLookup: true,
        wsdl: WSDL_NO_LOOKUP,
        pcommDescribe: STATE_LOOKUP_DESCRIBE,
        pcommRows: PCOMM_ROWS.replace("Зарегистрирован", "Passed"),
        lookupText,
      });
      const result = await readRegistrations({ account, exchange });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.pcomm[0]?.state).toBe("Passed");
      const assembled = assembleRegistrations({
        pcomm: result.pcomm,
        pupr: result.pupr,
        catalog: [],
      });
      expect(assembled.ok).toBe(false);
      if (assembled.ok) return;
      expect(assembled.detail).toContain("не разобрано");
      expect(bodies.filter((body) => body.includes("Lookup"))).toHaveLength(1);
      expect(bodies.some((body) => body.includes("getColumnLookup"))).toBe(false);
    }
  });

  it("keeps an interface string that is not a lookup key", async () => {
    const { exchange } = harness({
      allowLookup: true,
      pcommDescribe: STATE_LOOKUP_DESCRIBE,
    });
    const result = await readRegistrations({ account, exchange });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pcomm[0]?.state).toBe("Зарегистрирован");
  });

  it("keeps reading when the state lookup cannot be parsed", async () => {
    const { exchange, bodies } = harness({
      allowLookup: true,
      pcommDescribe: STATE_LOOKUP_DESCRIBE,
      lookupText: `<?xml version="1.0"?><Envelope><Body><Fault><faultstring>lookup down</faultstring></Fault></Body></Envelope>`,
    });
    const result = await readRegistrations({ account, exchange });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pcomm[0]?.state).toBe("Зарегистрирован");
    expect(bodies.some((body) => body.includes("selectRowset"))).toBe(true);
    expect(bodies.filter((body) => body.includes("Lookup"))).toHaveLength(1);
    expect(bodies.some((body) => body.includes("getColumnLookup"))).toBe(false);
  });

  it("reads the shared template once per signaling and scripting module", async () => {
    const { exchange, bodies } = templateHarness();
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
    const nodes = bodies.filter((body) => body.includes("<node "));
    expect(nodes).toHaveLength(2);
    expect(nodes.some((body) => body.includes(">signaling-1<") && body.includes(PCOMM_ID))).toBe(
      true,
    );
    expect(nodes.some((body) => body.includes(">scripting-1<") && body.includes(PUPR_ID))).toBe(
      true,
    );
    expect(bodies.some((body) => body.includes("media-1"))).toBe(false);
    expect(bodies.some((body) => body.includes("getLookup") && body.includes("<node "))).toBe(
      false,
    );
    expect(bodies.some((body) => body.includes("describeTable") && body.includes("<node "))).toBe(
      false,
    );
  });

  it("does not return rows when one module read fails", async () => {
    const { exchange, bodies } = templateHarness({ failSignaling: true });
    const result = await readRegistrations({ account, exchange });
    expect(result.ok).toBe(false);
    expect(bodies.some((body) => body.includes(">scripting-1<"))).toBe(false);
  });

  it("stops before select when a fifth signaling module is active", async () => {
    const { exchange, bodies } = templateHarness({
      moduleRows: ["signaling-1", "signaling-2", "signaling-3", "signaling-4", "signaling-5", "scripting-1"]
        .map((name) => row([["mod_nm", name]]))
        .join(""),
    });
    const result = await readRegistrations({ account, exchange });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain("четырёх");
    expect(bodies.some((body) => body.includes("<node "))).toBe(false);
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
