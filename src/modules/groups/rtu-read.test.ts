import { describe, expect, it } from "vitest";
import { SELECT_ROW_LIMIT } from "@/modules/rtu-soap/envelope";
import {
  collectIncomingGroupPages,
  readIncomingGroups,
  type IncomingGroupsExchange,
} from "@/modules/groups/rtu-read";

const ORIGIN = "https://rtu.example";
const PASSWORD = "s3cret";
const GROUP_ID = "06.1401.01";
const DECOY_ID = "06.1499.01";

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
  <message name="insertRowsetRequest"><part name="p_table_hi" type="xsd:string"/></message>
  <portType name="ApiPort">
    <operation name="getObjects"><input message="tns:getObjectsRequest"/></operation>
    <operation name="describeTable"><input message="tns:describeTableRequest"/></operation>
    <operation name="selectRowset"><input message="tns:selectRowsetRequest"/></operation>
    <operation name="insertRowset"><input message="tns:insertRowsetRequest"/></operation>
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
    <operation name="insertRowset">
      <soap:operation soapAction="urn:insertRowset"/>
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
  ${objectItem(GROUP_ID, "Входящие группы", "Оборудование;Входящие группы")}
  ${objectItem(DECOY_ID, "Входящие группы", "Оборудование;Данные по модулям;;Входящие группы")}
  ${objectItem("06.1498.01", "Объекты набора", "Маршрутизация;Объекты набора")}
</getObjectsResponse></Body></Envelope>`;

function column(name: string, title: string, lookup = ""): string {
  return `<item><name>${name}</name><title>${title}</title><type>column</type><data_type>string</data_type><have_lookup>${lookup}</have_lookup></item>`;
}

const DESCRIBE = `<?xml version="1.0"?><Envelope><Body><describeTableResponse><columns>
  ${column("grp_id", "ID")}
  ${column("grp_nm", "Название")}
  ${column("note", "Описание")}
</columns></describeTableResponse></Body></Envelope>`;

function row(cells: Array<[string, string]>): string {
  return `<item>${cells
    .map(([name, value]) => `<item><name>${name}</name><value>${value}</value></item>`)
    .join("")}</item>`;
}

const ROWS = `<?xml version="1.0"?><Envelope><Body><selectRowsetResponse>
  ${row([
    ["grp_id", "01"],
    ["grp_nm", "PSTN_Moscow"],
  ])}
  ${row([
    ["grp_id", "2"],
    ["grp_nm", "PSTN_SPb"],
  ])}
</selectRowsetResponse></Body></Envelope>`;

const EMPTY_ROWS = `<?xml version="1.0"?><Envelope><Body><selectRowsetResponse></selectRowsetResponse></Body></Envelope>`;

const FORBIDDEN = [
  "insertRowset",
  "deleteRowset",
  "updateRowset",
  "checkRowset",
  "getLookup",
  "args:node",
  'xmlns="args"',
  "http://mfisoft.ru/auth",
];

function harness(input: {
  objects?: string;
  describe?: string;
  rows?: string;
}): { exchange: IncomingGroupsExchange; bodies: string[] } {
  const bodies: string[] = [];
  const exchange: IncomingGroupsExchange = async (call) => {
    if (call.method === "GET") {
      expect(call.timeoutMs).toBe(10_000);
      expect(call.url).toBe(`${ORIGIN}/service/?wsdl_v2`);
      return { ok: true, status: 200, text: WSDL };
    }
    expect(call.timeoutMs).toBe(12_000);
    const body = call.body ?? "";
    bodies.push(body);
    for (const token of FORBIDDEN) expect(body).not.toContain(token);
    expect(body).not.toContain(DECOY_ID);
    if (body.includes("getObjects")) return { ok: true, status: 200, text: input.objects ?? OBJECTS };
    if (body.includes("describeTable")) {
      expect(body).toContain(GROUP_ID);
      return { ok: true, status: 200, text: input.describe ?? DESCRIBE };
    }
    if (body.includes("selectRowset")) {
      expect(body).toContain(GROUP_ID);
      expect(body).toContain("grp_id");
      expect(body).toContain("grp_nm");
      expect(body).not.toContain("note");
      return { ok: true, status: 200, text: input.rows ?? ROWS };
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

describe("readIncomingGroups", () => {
  it("reads the equipment page id and name", async () => {
    const { exchange, bodies } = harness({});
    const result = await readIncomingGroups({ account, exchange });
    expect(result).toEqual({
      ok: true,
      groups: [
        { externalId: "01", name: "PSTN_Moscow" },
        { externalId: "2", name: "PSTN_SPb" },
      ],
    });
    expect(bodies.some((body) => body.includes("getObjects"))).toBe(true);
    expect(bodies.some((body) => body.includes("describeTable"))).toBe(true);
    expect(bodies.some((body) => body.includes("selectRowset"))).toBe(true);
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
  });

  it("accepts an empty current list", async () => {
    const { exchange } = harness({ rows: EMPTY_ROWS });
    const result = await readIncomingGroups({ account, exchange });
    expect(result).toEqual({ ok: true, groups: [] });
  });

  it("does not describe a page outside Оборудование", async () => {
    const { exchange, bodies } = harness({
      objects: `<?xml version="1.0"?><Envelope><Body><getObjectsResponse>
        ${objectItem(DECOY_ID, "Входящие группы", "Подсистема коммутации;Данные по модулям;;Входящие группы")}
      </getObjectsResponse></Body></Envelope>`,
    });
    const result = await readIncomingGroups({ account, exchange });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain("Данные по модулям");
    expect(bodies.some((body) => body.includes("describeTable"))).toBe(false);
  });

  it("stops when ID is a lookup", async () => {
    const { exchange, bodies } = harness({
      describe: `<?xml version="1.0"?><Envelope><Body><describeTableResponse><columns>
        ${column("grp_id", "ID", "1")}
        ${column("grp_nm", "Название")}
      </columns></describeTableResponse></Body></Envelope>`,
    });
    const result = await readIncomingGroups({ account, exchange });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain("список подстановки");
    expect(bodies.some((body) => body.includes("selectRowset"))).toBe(false);
  });

  it("rejects a semicolon in the name", async () => {
    const { exchange } = harness({
      rows: `<?xml version="1.0"?><Envelope><Body><selectRowsetResponse>
        ${row([
          ["grp_id", "1"],
          ["grp_nm", "A;B"],
        ])}
      </selectRowsetResponse></Body></Envelope>`,
    });
    const result = await readIncomingGroups({ account, exchange });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain("точка с запятой");
  });
});

describe("collectIncomingGroupPages", () => {
  it("stops when the fifth full page still fills the limit", async () => {
    let calls = 0;
    const result = await collectIncomingGroupPages(async () => {
      calls += 1;
      return {
        ok: true,
        rows: Array.from({ length: SELECT_ROW_LIMIT }, (_, index) => ({
          grp_id: `${calls}-${index}`,
        })),
      };
    }, "grp_id");
    expect(calls).toBe(5);
    expect(result).toEqual({
      ok: false,
      detail: "Список входящих групп прочитан не целиком.",
    });
  });

  it("keeps a short second page", async () => {
    let calls = 0;
    const result = await collectIncomingGroupPages(async (offset) => {
      calls += 1;
      expect(offset).toBe(calls === 1 ? 0 : SELECT_ROW_LIMIT);
      const length = calls === 1 ? SELECT_ROW_LIMIT : 1;
      return {
        ok: true,
        rows: Array.from({ length }, (_, index) => ({
          grp_id: `${offset}-${index}`,
        })),
      };
    }, "grp_id");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(SELECT_ROW_LIMIT + 1);
  });
});
