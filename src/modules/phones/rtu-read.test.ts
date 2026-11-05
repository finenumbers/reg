import { describe, expect, it } from "vitest";
import {
  EQUIPMENT_SELECT_OFFSET_CAP,
  SELECT_ROW_LIMIT,
} from "@/modules/rtu-soap/envelope";
import { EQUIPMENT_TITLES, type EquipmentField } from "@/modules/phones/rtu-rows";
import {
  collectEquipmentPages,
  readEquipment,
  type EquipmentExchange,
} from "@/modules/phones/rtu-read";

const ORIGIN = "https://rtu.example";
const PASSWORD = "s3cret";
const EQUIPMENT_ID = "02.2201.01";

const TECH: Record<EquipmentField, string> = {
  name: "gateway_name",
  description: "description",
  equipmentType: "equipment_type",
  endpointNumber: "endpoint_number",
  originator: "src_enabled",
  terminator: "dst_enabled",
  registration: "reg_enabled",
  protocol: "protocol",
  zone: "visible_zone",
  srcZone: "src_zone",
  dstZone: "dst_zone",
  srcAddresses: "src_addresses",
  srcPort: "src_port",
  srcCapacity: "src_capacity",
  groups: "src_groups",
  dstAddresses: "dst_addresses",
  dstPort: "dst_port_sip",
  dstCapacity: "dst_capacity",
  regName: "reg_name",
  regPassword: "reg_password",
  regAddresses: "reg_addresses",
};

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
  <message name="countRowsetRequest">
    <part name="p_table_hi" type="xsd:string"/>
    <part name="p_filter" type="xsd:string"/>
  </message>
  <message name="getLookupRequest">
    <part name="p_object_id" type="xsd:string"/>
    <part name="p_column_nm" type="xsd:string"/>
  </message>
  <message name="insertRowsetRequest"><part name="p_table_hi" type="xsd:string"/></message>
  <portType name="ApiPort">
    <operation name="getObjects"><input message="tns:getObjectsRequest"/></operation>
    <operation name="describeTable"><input message="tns:describeTableRequest"/></operation>
    <operation name="selectRowset"><input message="tns:selectRowsetRequest"/></operation>
    <operation name="countRowset"><input message="tns:countRowsetRequest"/></operation>
    <operation name="getLookup"><input message="tns:getLookupRequest"/></operation>
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
    <operation name="countRowset">
      <soap:operation soapAction="urn:rtu-api#countRowset"/>
      <input><soap:body use="encoded" namespace="urn:rtu-api" encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"/></input>
    </operation>
    <operation name="getLookup">
      <soap:operation soapAction="urn:rtu-api#getLookup"/>
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

const WSDL_NO_COUNT = WSDL.replace(/countRowset/g, "ignoredCount");

function objectItem(objectId: string, title: string, path: string): string {
  return `<item><object_id>${objectId}</object_id><title>${title}</title><path>${path}</path><type>table</type></item>`;
}

const OBJECTS = `<?xml version="1.0"?>
<Envelope><Body><getObjectsResponse>
  ${objectItem(EQUIPMENT_ID, "Оборудование", "Оборудование;Оборудование")}
  ${objectItem("02.2299.01", "Оборудование", "Оборудование;Данные по модулям;;Оборудование")}
  ${objectItem("02.2298.01", "Устройства шлюзов по умолчанию", "Оборудование;Устройства шлюзов по умолчанию")}
</getObjectsResponse></Body></Envelope>`;

function columnXml(name: string, title: string, extra = ""): string {
  return `<item><name>${name}</name><title>${title}</title><type>column</type><data_type>string</data_type>${extra}</item>`;
}

const DESCRIBE = `<?xml version="1.0"?><Envelope><Body><describeTableResponse><columns>
  ${(Object.keys(EQUIPMENT_TITLES) as EquipmentField[])
    .map((key) => {
      const lookup =
        key === "equipmentType" || key === "protocol" || key === "groups"
          ? "<have_lookup>1</have_lookup>"
          : "";
      return columnXml(TECH[key], EQUIPMENT_TITLES[key], lookup);
    })
    .join("")}
  ${columnXml("gateway_id", "ID", "<pk>1</pk>")}
</columns></describeTableResponse></Body></Envelope>`;

function cells(values: Record<string, string>): string {
  return `<item>${Object.entries(values)
    .map(([name, value]) => `<item><name>${name}</name><value>${value}</value></item>`)
    .join("")}</item>`;
}

function equipmentCells(id: string, values: Partial<Record<EquipmentField, string>>): string {
  const all: Record<string, string> = { gateway_id: id };
  for (const key of Object.keys(TECH) as EquipmentField[]) all[TECH[key]] = values[key] ?? "";
  return cells(all);
}

const ROWS = `<?xml version="1.0"?><Envelope><Body><selectRowsetResponse>
  ${equipmentCells("e1", {
    name: "EP yes",
    equipmentType: "6",
    endpointNumber: "7495",
    registration: "1",
    srcZone: "A",
    dstZone: "B",
    regPassword: PASSWORD,
    groups: "1",
    dstCapacity: "0",
  })}
  ${equipmentCells("e2", {
    name: "EP no",
    equipmentType: "6",
    registration: "0",
    srcZone: "SRC",
    dstZone: "DST",
  })}
  ${equipmentCells("g1", {
    name: "GW",
    equipmentType: "1",
    protocol: "sip",
    srcZone: "GS",
    dstZone: "GD",
  })}
  ${equipmentCells("x1", { name: "ENUM", equipmentType: "3" })}
</selectRowsetResponse></Body></Envelope>`;

const COUNT = `<?xml version="1.0"?><Envelope><Body><countRowsetResponse><return>4</return></countRowsetResponse></Body></Envelope>`;

const LOOKUPS: Record<string, string> = {
  equipment_type: `<item><key>1</key><value>Шлюз</value></item><item><key>6</key><value>Оконечное оборудование</value></item><item><key>3</key><value>ENUM</value></item>`,
  protocol: `<item><key>1</key><value>SIP</value></item>`,
  src_groups: `<item><key>1</key><value>Moscow</value></item>`,
};

function lookupXml(column: string): string {
  return `<?xml version="1.0"?><Envelope><Body><getLookupResponse>${LOOKUPS[column] ?? ""}</getLookupResponse></Body></Envelope>`;
}

const FORBIDDEN = [
  "insertRowset",
  "deleteRowset",
  "updateRowset",
  "checkRowset",
  "args:node",
  'xmlns="args"',
  "http://mfisoft.ru/auth",
];

function harness(input: {
  wsdl?: string;
  rows?: string;
  count?: string;
  pages?: Array<Record<string, string>[]>;
}): { exchange: EquipmentExchange; bodies: string[] } {
  const bodies: string[] = [];
  let selectCalls = 0;
  const exchange: EquipmentExchange = async (call) => {
    if (call.method === "GET") {
      expect(call.timeoutMs).toBe(10_000);
      return { ok: true, status: 200, text: input.wsdl ?? WSDL };
    }
    const body = call.body ?? "";
    bodies.push(body);
    for (const token of FORBIDDEN) expect(body).not.toContain(token);
    if (body.includes("selectRowset") || body.includes("countRowset")) {
      expect(body).toContain('<p_filter xsi:nil="true"/>');
      expect(call.timeoutMs).toBe(60_000);
    }
    if (body.includes("describeTable") || body.includes("getLookup")) {
      expect(call.timeoutMs).toBe(20_000);
    }
    if (body.includes("getObjects")) return { ok: true, status: 200, text: OBJECTS };
    if (body.includes("describeTable")) return { ok: true, status: 200, text: DESCRIBE };
    if (body.includes("getLookup")) {
      const column = /<p_column_nm[^>]*>([^<]+)<\/p_column_nm>/.exec(body)?.[1] ?? "";
      return { ok: true, status: 200, text: lookupXml(column) };
    }
    if (body.includes("countRowset")) {
      return { ok: true, status: 200, text: input.count ?? COUNT };
    }
    if (body.includes("selectRowset")) {
      expect(body).not.toContain("<node");
      expect(body).toContain(EQUIPMENT_ID);
      expect(body).toContain("reg_password");
      selectCalls += 1;
      if (input.pages) {
        const page = input.pages[selectCalls - 1] ?? [];
        const xml = `<?xml version="1.0"?><Envelope><Body><selectRowsetResponse>${page
          .map((item) => cells(item))
          .join("")}</selectRowsetResponse></Body></Envelope>`;
        return { ok: true, status: 200, text: xml };
      }
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

describe("readEquipment", () => {
  it("reads gateways and endpoints and keeps the password out of the result text", async () => {
    const { exchange, bodies } = harness({});
    const result = await readEquipment({ account, exchange });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.endpoints.map((item) => item.name)).toEqual(["EP yes", "EP no"]);
    expect(result.payload.gateways.map((item) => item.name)).toEqual(["GW"]);
    expect(result.payload.endpoints[0]?.data["Регистрационный пароль"]).toBe(PASSWORD);
    expect(result.payload.endpoints[0]?.data["Зона"]).toBe("A");
    expect(result.payload.endpoints[1]?.data["ИНИЦ. зона"]).toBe("SRC");
    expect(result.payload.gateways[0]?.data["Протокол сигнализации"]).toBe("SIP");
    expect(result.payload.endpoints[0]?.data["Входящие группы"]).toBe("Moscow");
    expect(JSON.stringify({ endpoints: result.payload.endpoints.map((item) => item.name) })).not.toContain(
      PASSWORD,
    );
    expect(bodies.some((body) => body.includes("countRowset"))).toBe(true);
    expect(bodies.some((body) => body.includes("getLookup"))).toBe(true);
    expect(bodies.filter((body) => body.includes("selectRowset"))).toHaveLength(1);
  });

  it("does not apply a count that disagrees with the page", async () => {
    const { exchange } = harness({
      count: `<?xml version="1.0"?><Envelope><Body><countRowsetResponse><return>9</return></countRowsetResponse></Body></Envelope>`,
    });
    const result = await readEquipment({ account, exchange });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain("счётчик");
    expect(result.detail).not.toContain(PASSWORD);
  });

  it("rejects a full page when countRowset is absent", async () => {
    const full = Array.from({ length: SELECT_ROW_LIMIT }, (_, index) => ({
      gateway_id: `id-${index}`,
    }));
    const { exchange, bodies } = harness({ wsdl: WSDL_NO_COUNT, pages: [full] });
    const result = await readEquipment({ account, exchange });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain("не целиком");
    expect(bodies.some((body) => body.includes("countRowset"))).toBe(false);
    expect(bodies.filter((body) => body.includes("selectRowset"))).toHaveLength(1);
  });

  it("rejects an empty primary key", async () => {
    const { exchange } = harness({
      rows: `<?xml version="1.0"?><Envelope><Body><selectRowsetResponse>${equipmentCells("", {
        name: "x",
        equipmentType: "6",
        registration: "1",
      })}</selectRowsetResponse></Body></Envelope>`,
      count: `<?xml version="1.0"?><Envelope><Body><countRowsetResponse><return>1</return></countRowsetResponse></Body></Envelope>`,
    });
    const result = await readEquipment({ account, exchange });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain("первичн");
  });
});

describe("collectEquipmentPages", () => {
  it("stops on a repeated key and on the 25th full page", async () => {
    const repeated = await collectEquipmentPages(
      async () => ({
        ok: true,
        rows: [{ gateway_id: "a" }, { gateway_id: "a" }],
      }),
      "gateway_id",
      true,
    );
    expect(repeated.ok).toBe(false);

    let calls = 0;
    const capped = await collectEquipmentPages(
      async (offset) => {
        calls += 1;
        expect(offset).toBe((calls - 1) * SELECT_ROW_LIMIT);
        expect(offset).toBeLessThanOrEqual(EQUIPMENT_SELECT_OFFSET_CAP);
        return {
          ok: true,
          rows: Array.from({ length: SELECT_ROW_LIMIT }, (_, index) => ({
            gateway_id: `${offset}-${index}`,
          })),
        };
      },
      "gateway_id",
      true,
    );
    expect(capped.ok).toBe(false);
    expect(calls).toBe(25);
  });
});
