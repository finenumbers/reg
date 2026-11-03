import { afterEach, describe, expect, it } from "vitest";
import { readLiveCalls, resetLiveCallMemory, type LiveCallDeps } from "@/modules/live-calls/snapshot";

const ORIGIN = "https://rtu.example";
const PASSWORD = "s3cret";

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

const OBJECTS = `<?xml version="1.0"?>
<Envelope><Body><getObjectsResponse>
  <item>
    <object_id>08.2504.01</object_id>
    <title>Транзитные вызовы (ПКомм)</title>
    <path>Подсистема коммутации;Мониторинг ПКомм;Транзитные вызовы (ПКомм)</path>
    <type>table</type>
  </item>
  <item>
    <object_id>08.2599.01</object_id>
    <title>Транзитные вызовы (ПКомм)</title>
    <path>Подсистема коммутации;Мониторинг ПКомм;Данные по модулям;signaling-1;Конференции Class 4</path>
    <type>table</type>
  </item>
  <item>
    <object_id>08.2505.01</object_id>
    <title>Транзитные вызовы (ПУпр)</title>
    <path>Подсистема коммутации;Мониторинг ПКомм;Транзитные вызовы (ПУпр)</path>
    <type>table</type>
  </item>
</getObjectsResponse></Body></Envelope>`;

function column(name: string, title: string, mask = ""): string {
  return `<item><name>${name}</name><title>${title}</title><type>column</type><data_type>string</data_type><data_mask>${mask}</data_mask></item>`;
}

const PCOMM_DESCRIBE = `<?xml version="1.0"?><Envelope><Body><describeTableResponse><columns>
  ${column("conf_id", "Conference ID ПКомм")}
  ${column("t_start", "Время начала", "YMDhms")}
  ${column("t_conn", "Время соединения", "YMDhms")}
  ${column("dur", "Время разговора")}
  ${column("src_sig", "Адрес инициатора (сигн.)")}
  ${column("out_a", "Исходящий А-номер")}
  ${column("out_b", "Исходящий Б-номер")}
  ${column("dst_sig", "Адрес терм. устр-ва (сигн.)")}
</columns></describeTableResponse></Body></Envelope>`;

const PUPR_DESCRIBE = `<?xml version="1.0"?><Envelope><Body><describeTableResponse><columns>
  ${column("conf_id", "Conference ID ПКомм")}
  ${column("call_state", "Состояние вызова")}
  ${column("src_name", "Имя инициатора")}
  ${column("dialpeer", "Объект набора")}
  ${column("dst_name", "Имя терм. устройства")}
</columns></describeTableResponse></Body></Envelope>`;

function row(cells: Array<[string, string]>): string {
  return `<item>${cells
    .map(([name, value]) => `<item><name>${name}</name><value>${value}</value></item>`)
    .join("")}</item>`;
}

const PCOMM_ROWS = `<?xml version="1.0"?><Envelope><Body><selectRowsetResponse>
  ${row([
    ["conf_id", "c1"],
    ["t_start", "20261103233200"],
    ["t_conn", ""],
    ["dur", "5"],
    ["src_sig", "1.1.1.1"],
    ["out_a", "100"],
    ["out_b", "200"],
    ["dst_sig", "2.2.2.2"],
  ])}
  ${row([
    ["conf_id", ""],
    ["t_start", "1"],
    ["dur", ""],
    ["src_sig", "9.9.9.9"],
    ["out_a", "101"],
    ["out_b", "201"],
    ["dst_sig", ""],
  ])}
</selectRowsetResponse></Body></Envelope>`;

const PCOMM_CHANGED = PCOMM_ROWS.replace("100", "999");

const PUPR_ROWS = `<?xml version="1.0"?><Envelope><Body><selectRowsetResponse>
  ${row([
    ["conf_id", "c1"],
    ["call_state", "talk"],
    ["src_name", "gw-a"],
    ["dialpeer", "peer"],
    ["dst_name", "term"],
  ])}
  ${row([
    ["conf_id", "c1"],
    ["call_state", "extra"],
    ["src_name", "gw-b"],
    ["dialpeer", ""],
    ["dst_name", ""],
  ])}
  ${row([
    ["conf_id", ""],
    ["call_state", "blank"],
    ["src_name", ""],
    ["dialpeer", ""],
    ["dst_name", ""],
  ])}
</selectRowsetResponse></Body></Envelope>`;

const EMPTY_SELECT = `<?xml version="1.0"?><Envelope><Body><selectRowsetResponse/></Body></Envelope>`;
const FAULT = `<?xml version="1.0"?><Envelope><Body><Fault><faultstring>Access denied</faultstring></Fault></Body></Envelope>`;
const UNKNOWN = `<?xml version="1.0"?><Envelope><Body><Fault><faultstring>Unknown object 08.2505.01</faultstring></Fault></Body></Envelope>`;

type Mode = "ok" | "fault" | "empty" | "partial" | "unknown";

function harness(mode: () => Mode) {
  const bodies: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const body = typeof init?.body === "string" ? init.body : "";
    bodies.push(body);
    expect(body).not.toContain("deleteRowset");
    expect(body).not.toContain("args:node");
    expect(body).not.toContain("insertRowset");
    const target = String(url);
    let text = WSDL;
    if (!target.includes("wsdl")) {
      if (body.includes("<ns1:getObjects")) text = OBJECTS;
      else if (body.includes("describeTable") && body.includes("08.2504.01")) text = PCOMM_DESCRIBE;
      else if (body.includes("describeTable") && body.includes("08.2505.01")) text = PUPR_DESCRIBE;
      else if (body.includes("selectRowset") && body.includes("08.2504.01")) {
        const current = mode();
        text = current === "empty" ? EMPTY_SELECT : current === "partial" ? PCOMM_CHANGED : PCOMM_ROWS;
      } else if (body.includes("selectRowset") && body.includes("08.2505.01")) {
        const current = mode();
        text =
          current === "fault"
            ? FAULT
            : current === "partial"
              ? FAULT
              : current === "unknown"
                ? UNKNOWN
                : current === "empty"
                  ? EMPTY_SELECT
                  : PUPR_ROWS;
      } else {
        throw new Error(`unexpected call ${target} ${body.slice(0, 180)}`);
      }
    }
    return new Response(text, { status: 200 });
  };
  return { fetchImpl, bodies };
}

function deps(now: number, fetchImpl: typeof fetch): LiveCallDeps {
  return {
    now: () => now,
    fetchImpl,
    account: { origin: ORIGIN, login: "admin", password: PASSWORD, caPem: null },
  };
}

describe("readLiveCalls", () => {
  afterEach(() => {
    resetLiveCallMemory();
  });

  it("joins the two tables and does not replace a failed read with a partial snapshot", async () => {
    let mode: Mode = "ok";
    const { fetchImpl, bodies } = harness(() => mode);
    let now = 1_700_000_000_000;
    const first = await readLiveCalls(deps(now, fetchImpl));
    expect(first.error).toBeNull();
    expect(first.rows).toHaveLength(4);
    expect(first.rows?.[0]).toMatchObject({
      state: "talk",
      startedAt: "2026-11-03 23:32:00",
      outA: "100",
      sourceName: "gw-a",
      sourceSignal: "1.1.1.1",
      destName: "term",
    });
    expect(first.rows?.[1]).toMatchObject({ outA: "101", state: "", sourceSignal: "9.9.9.9" });
    expect(first.rows?.[2]).toMatchObject({ state: "extra", outA: "", sourceName: "gw-b" });
    expect(first.rows?.[3]).toMatchObject({ state: "blank", outA: "" });
    expect(bodies.some((body) => body.includes("08.2599.01"))).toBe(false);

    const cached = await readLiveCalls(deps(now + 2_999, fetchImpl));
    expect(cached.rows?.[0]?.outA).toBe("100");
    expect(bodies.filter((body) => body.includes("selectRowset"))).toHaveLength(2);

    mode = "partial";
    now += 3_000;
    const failed = await readLiveCalls(deps(now, fetchImpl));
    expect(failed.error).toBe("Access denied");
    expect(failed.error).not.toContain(PASSWORD);
    expect(failed.rows?.[0]?.outA).toBe("100");
    expect(failed.takenAt).toBe(first.takenAt);

    mode = "empty";
    now += 3_000;
    const cleared = await readLiveCalls(deps(now, fetchImpl));
    expect(cleared.error).toBeNull();
    expect(cleared.rows).toEqual([]);
  });

  it("does not turn the first fault into an empty table, and shares one in-flight read", async () => {
    const { fetchImpl, bodies } = harness(() => "fault");
    const now = 1_700_000_000_000;
    const input = deps(now, fetchImpl);
    const [first, second] = await Promise.all([readLiveCalls(input), readLiveCalls(input)]);
    expect(second).toBe(first);
    expect(first.rows).toBeNull();
    expect(first.error).toBeTruthy();
    const catalogCalls = bodies.filter((body) => body.includes("getObjects")).length;
    expect(catalogCalls).toBe(1);

    const again = await readLiveCalls(deps(now + 1_000, fetchImpl));
    expect(again.rows).toBeNull();
    expect(bodies.filter((body) => body.includes("getObjects"))).toHaveLength(1);
  });

  it("retries an unknown object once, then stops", async () => {
    const { fetchImpl, bodies } = harness(() => "unknown");
    const now = 1_700_000_000_000;
    const failed = await readLiveCalls(deps(now, fetchImpl));
    expect(failed.rows).toBeNull();
    expect(failed.error).toBe("Объект таблицы РТУ не найден.");
    expect(bodies.filter((body) => body.includes("getObjects"))).toHaveLength(2);
    await readLiveCalls(deps(now + 1_000, fetchImpl));
    expect(bodies.filter((body) => body.includes("getObjects"))).toHaveLength(2);
  });
});
