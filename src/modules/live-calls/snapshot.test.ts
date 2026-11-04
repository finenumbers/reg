import { afterEach, describe, expect, it } from "vitest";
import {
  MODULE_NAMES_MS,
  readLiveCalls,
  resetLiveCallMemory,
  type LiveCallDeps,
} from "@/modules/live-calls/snapshot";
import { SELECT_ROW_LIMIT } from "@/modules/rtu-soap/envelope";

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
    ["t_conn", "20231114221235"],
    ["src_sig", "1.1.1.1"],
    ["out_a", "100"],
    ["out_b", "200"],
    ["dst_sig", "2.2.2.2"],
  ])}
  ${row([
    ["conf_id", ""],
    ["t_start", "1"],
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
    expect(body).not.toContain('xmlns="args"');
    expect(body).not.toContain("insertRowset");
    const target = String(url);
    let text = WSDL;
    if (!target.includes("wsdl")) {
      if (body.includes("<ns1:getObjects")) text = OBJECTS;
      else if (body.includes("describeTable") && body.includes("08.2504.01"))
        text = PCOMM_DESCRIBE;
      else if (body.includes("describeTable") && body.includes("08.2505.01"))
        text = PUPR_DESCRIBE;
      else if (body.includes("selectRowset") && body.includes("08.2504.01")) {
        const current = mode();
        text =
          current === "empty"
            ? EMPTY_SELECT
            : current === "partial"
              ? PCOMM_CHANGED
              : PCOMM_ROWS;
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
    descriptions: async () => new Map(),
    rates: async () => [],
    exceptions: async () => [],
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
      connectedAt: "2023-11-14 22:12:35",
      seconds: "45",
      outA: "100",
      sideA: "-",
      sideB: "-",
      sourceName: "gw-a",
      destName: "term",
      sourceSignal: "1.1.1.1",
      destSignal: "2.2.2.2",
      tone: null,
      category: "Ошибка",
    });
    expect(first.rows?.[1]).toMatchObject({
      outA: "101",
      state: "",
      sideA: "-",
    });
    expect(first.rows?.[2]).toMatchObject({
      state: "extra",
      outA: "",
      sourceName: "gw-b",
    });
    expect(first.rows?.[3]).toMatchObject({ state: "blank", outA: "" });
    expect(bodies.some((body) => body.includes("08.2599.01"))).toBe(false);
    expect(bodies.some((body) => body.includes("getLookup"))).toBe(false);
    expect(bodies.some((body) => body.includes(">dur<"))).toBe(false);
    for (const body of bodies.filter((item) => item.includes("selectRowset"))) {
      if (body.includes("08.2504.01")) {
        expect(body).toContain("src_sig");
        expect(body).toContain("dst_sig");
      } else {
        expect(body).not.toContain("src_sig");
        expect(body).not.toContain("dst_sig");
      }
    }

    const cached = await readLiveCalls(deps(now + 2_999, fetchImpl));
    expect(cached.rows?.[0]?.outA).toBe("100");
    expect(bodies.filter((body) => body.includes("selectRowset"))).toHaveLength(2);

    mode = "partial";
    now += 3_000;
    const failed = await readLiveCalls(deps(now, fetchImpl));
    expect(failed.error).toBe("Access denied");
    expect(failed.error).not.toContain(PASSWORD);
    expect(failed.rows?.[0]?.outA).toBe("100");
    expect(failed.rows?.[0]?.seconds).toBe("45");
    expect(failed.takenAt).toBe(first.takenAt);

    mode = "empty";
    now += 3_000;
    const cleared = await readLiveCalls(deps(now, fetchImpl));
    expect(cleared.error).toBeNull();
    expect(cleared.rows).toEqual([]);
  });

  it("shows earlier start times first and leaves the switch sort nil", async () => {
    const pcomm = `<?xml version="1.0"?><Envelope><Body><selectRowsetResponse>
      ${row([
        ["conf_id", "old"],
        ["t_start", "20261104090000"],
        ["out_a", "111"],
        ["out_b", "200"],
      ])}
      ${row([
        ["conf_id", "new"],
        ["t_start", "20261104100000"],
        ["out_a", "222"],
        ["out_b", "200"],
      ])}
      ${row([
        ["conf_id", "junk"],
        ["t_start", "1"],
        ["out_a", "333"],
        ["out_b", "200"],
      ])}
    </selectRowsetResponse></Body></Envelope>`;
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const body = typeof init?.body === "string" ? init.body : "";
      bodies.push(body);
      const target = String(url);
      let text = WSDL;
      if (!target.includes("wsdl")) {
        if (body.includes("<ns1:getObjects")) text = OBJECTS;
        else if (body.includes("describeTable") && body.includes("08.2504.01"))
          text = PCOMM_DESCRIBE;
        else if (body.includes("describeTable") && body.includes("08.2505.01"))
          text = PUPR_DESCRIBE;
        else if (body.includes("selectRowset") && body.includes("08.2504.01")) text = pcomm;
        else if (body.includes("selectRowset") && body.includes("08.2505.01"))
          text = EMPTY_SELECT;
        else throw new Error(`unexpected call ${target} ${body.slice(0, 180)}`);
      }
      return new Response(text, { status: 200 });
    };
    const snapshot = await readLiveCalls(deps(1_700_000_000_000, fetchImpl));
    expect(snapshot.error).toBeNull();
    expect(snapshot.rows?.map((item) => item.startedAt)).toEqual([
      "2026-11-04 09:00:00",
      "2026-11-04 10:00:00",
      "1",
    ]);
    expect(snapshot.rows?.map((item) => item.outA)).toEqual(["111", "222", "333"]);
    const selected = bodies.filter((body) => body.includes("selectRowset"));
    expect(selected.length).toBeGreaterThan(0);
    for (const body of selected) {
      expect(body).toContain('<p_sort xsi:nil="true"/>');
      expect(body).not.toContain("<p_sort>");
    }
  });

  it("fills sides from the catalog and keeps the calls when that read fails", async () => {
    const { fetchImpl } = harness(() => "ok");
    const now = 1_700_000_000_000;
    let lookups = 0;
    const input = deps(now, fetchImpl);
    input.descriptions = async (phones) => {
      lookups += 1;
      expect(phones).toContain("100");
      expect(phones).not.toContain("1.1.1.1");
      return new Map([["100", "Офис"]]);
    };
    const filled = await readLiveCalls(input);
    expect(filled.error).toBeNull();
    expect(filled.rows?.[0]).toMatchObject({ outA: "100", sideA: "Офис", sideB: "-" });
    expect(lookups).toBe(1);

    const cached = await readLiveCalls({ ...input, now: () => now + 1_000 });
    expect(cached.rows?.[0]?.sideA).toBe("Офис");
    expect(lookups).toBe(1);

    resetLiveCallMemory();
    const failedCatalog = await readLiveCalls({
      ...deps(now, fetchImpl),
      descriptions: async () => {
        throw new Error("db down 79001112233");
      },
    });
    expect(failedCatalog.error).toBeNull();
    expect(failedCatalog.rows?.[0]).toMatchObject({
      outA: "100",
      sideA: "-",
      sideB: "-",
      tone: null,
      category: "-",
    });
  });

  it("retries a failed tariff load, then keeps the list for a minute", async () => {
    const { fetchImpl } = harness(() => "ok");
    let now = 1_700_000_000_000;
    let loads = 0;
    let fail = true;
    const input: LiveCallDeps = {
      ...deps(now, fetchImpl),
      now: () => now,
      rates: async () => {
        loads += 1;
        if (fail) throw new Error("tariff down");
        return [];
      },
    };
    const first = await readLiveCalls(input);
    expect(first.error).toBeNull();
    expect(first.rows?.[0]?.outA).toBe("100");
    expect(first.rows?.[0]?.category).toBe("Ошибка");
    expect(loads).toBe(1);

    fail = false;
    now += 3_000;
    await readLiveCalls(input);
    expect(loads).toBe(2);

    now += 3_000;
    await readLiveCalls(input);
    expect(loads).toBe(2);

    now += MODULE_NAMES_MS;
    await readLiveCalls(input);
    expect(loads).toBe(3);
  });

  it("does not ask the catalog when the snapshot has no numbers", async () => {
    const { fetchImpl } = harness(() => "empty");
    let lookups = 0;
    const cleared = await readLiveCalls({
      ...deps(1_700_000_000_000, fetchImpl),
      descriptions: async () => {
        lookups += 1;
        return new Map();
      },
    });
    expect(cleared.error).toBeNull();
    expect(cleared.rows).toEqual([]);
    expect(lookups).toBe(0);
  });

  it("does not turn the first fault into an empty table, and shares one in-flight read", async () => {
    const { fetchImpl, bodies } = harness(() => "fault");
    const now = 1_700_000_000_000;
    const input = deps(now, fetchImpl);
    const [first, second] = await Promise.all([
      readLiveCalls(input),
      readLiveCalls(input),
    ]);
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

  it("reads signaling and scripting templates when the summary pages are absent", async () => {
    let mode: "ok" | "fault" | "unknown" = "ok";
    const { fetchImpl, bodies } = moduleHarness(() => mode);
    let now = 1_700_000_000_000;
    const first = await readLiveCalls(deps(now, fetchImpl));
    expect(first.error).toBeNull();
    expect(first.rows).toEqual([
      expect.objectContaining({
        state: "talk",
        outA: "100",
        sourceName: "gw-a",
        sourceSignal: "1.1.1.1",
        destSignal: "",
        seconds: "",
      }),
      expect.objectContaining({
        state: "",
        outA: "200",
        sourceName: "",
        sourceSignal: "",
      }),
    ]);
    const calls = bodies.filter(
      (body) =>
        body.includes("selectRowset") ||
        body.includes("describeTable") ||
        body.includes("getObjects"),
    );
    expect(calls.map(kindOf)).toEqual([
      "objects",
      "describe-pcomm",
      "describe-pupr",
      "describe-modules",
      "names",
      "signaling-1",
      "signaling-2",
      "scripting-1",
      "scripting-2",
    ]);
    expect(
      bodies.some((body) => body.includes(">dur<") || body.includes("Время разговора")),
    ).toBe(false);
    expect(
      bodies.some((body) => /media-1|management-1|signaling-west|Signaling-1/.test(body)),
    ).toBe(false);
    expect(bodies.filter((body) => body.includes('xmlns="args"'))).toHaveLength(4);
    for (const body of bodies.filter((item) => item.includes("selectRowset"))) {
      if (body.includes("08.2701.01")) {
        expect(body).toContain("src_sig");
        expect(body).toContain("dst_sig");
      } else {
        expect(body).not.toContain("src_sig");
        expect(body).not.toContain("dst_sig");
      }
    }

    now += 3_000;
    await readLiveCalls(deps(now, fetchImpl));
    expect(bodies.filter((body) => body.includes("08.2703.01"))).toHaveLength(2);

    now += MODULE_NAMES_MS;
    await readLiveCalls(deps(now, fetchImpl));
    expect(bodies.filter((body) => body.includes("<ns1:getObjects"))).toHaveLength(1);
    expect(bodies.filter((body) => kindOf(body) === "names")).toHaveLength(2);

    mode = "unknown";
    now += 3_000;
    const rejected = await readLiveCalls(deps(now, fetchImpl));
    expect(rejected.error).toBe("Объект таблицы РТУ не найден.");
    expect(rejected.rows?.[0]?.outA).toBe("100");
    expect(bodies.filter((body) => body.includes("<ns1:getObjects"))).toHaveLength(2);
    expect(bodies.filter((body) => kindOf(body) === "scripting-1")).toHaveLength(3);
  });

  it("stops the module round on the first fault and refuses a fifth module", async () => {
    const faulted = moduleHarness(() => "fault");
    const failed = await readLiveCalls(deps(1_700_000_000_000, faulted.fetchImpl));
    expect(failed.rows).toBeNull();
    expect(failed.error).toBe("Access denied");
    expect(faulted.bodies.map(kindOf).filter(Boolean)).toEqual([
      "objects",
      "describe-pcomm",
      "describe-pupr",
      "describe-modules",
      "names",
      "signaling-1",
      "signaling-2",
    ]);

    resetLiveCallMemory();
    const many = moduleHarness(() => "ok", "many");
    const capped = await readLiveCalls(deps(1_700_000_000_000, many.fetchImpl));
    expect(capped.rows).toBeNull();
    expect(capped.error).toBe("Активных модулей signaling или scripting больше четырёх.");
    expect(many.bodies.some((body) => body.includes('xmlns="args"'))).toBe(false);

    resetLiveCallMemory();
    const none = moduleHarness(() => "ok", "none");
    const missing = await readLiveCalls(deps(1_700_000_000_000, none.fetchImpl));
    expect(missing.rows).toBeNull();
    expect(missing.error).toBe("Среди активных модулей нет пары signaling и scripting.");
    expect(none.bodies.some((body) => body.includes('xmlns="args"'))).toBe(false);

    resetLiveCallMemory();
    const odd = moduleHarness(() => "ok", "odd");
    const named = await readLiveCalls(deps(1_700_000_000_000, odd.fetchImpl));
    expect(named.rows).toBeNull();
    expect(named.error).toBe("Модуль signaling или scripting назван не по шаблону.");
    expect(odd.bodies.some((body) => body.includes('xmlns="args"'))).toBe(false);
  });

  it("reads the next page and does not append a repeated page", async () => {
    const next = pageHarness("next");
    const added = await readLiveCalls(deps(1_700_000_000_000, next.fetchImpl));
    expect(added.error).toBeNull();
    expect(added.truncated).toBe(false);
    expect(added.rows).toHaveLength(SELECT_ROW_LIMIT + 1);
    expect(
      next.bodies.filter((body) => pageOffset(body) === SELECT_ROW_LIMIT),
    ).toHaveLength(1);
    expect(next.bodies.some((body) => pageOffset(body) === SELECT_ROW_LIMIT * 2)).toBe(
      false,
    );

    resetLiveCallMemory();
    const same = pageHarness("same");
    const repeated = await readLiveCalls(deps(1_700_000_000_000, same.fetchImpl));
    expect(repeated.error).toBeNull();
    expect(repeated.truncated).toBe(true);
    expect(repeated.rows).toHaveLength(SELECT_ROW_LIMIT);
    expect(
      same.bodies.filter((body) => pageOffset(body) === SELECT_ROW_LIMIT),
    ).toHaveLength(1);
    expect(same.bodies.some((body) => pageOffset(body) === SELECT_ROW_LIMIT * 2)).toBe(
      false,
    );

    resetLiveCallMemory();
    const fault = pageHarness("fault");
    const failed = await readLiveCalls(deps(1_700_000_000_000, fault.fetchImpl));
    expect(failed.rows).toBeNull();
    expect(failed.error).toBe("Access denied");
    expect(fault.bodies.some((body) => pageOffset(body) === SELECT_ROW_LIMIT * 2)).toBe(
      false,
    );
  });

  it("shows the switch duration instead of a UTC difference of zero", async () => {
    const { fetchImpl } = durationHarness("value");
    const read = await readLiveCalls(deps(1_700_000_000_000, fetchImpl));
    expect(read.error).toBeNull();
    expect(read.rows?.[0]?.seconds).toBe("37");
    expect(read.rows?.[0]?.connectedAt).toBe("2026-11-04 03:48:00");
  });

  it("keeps a blank or zero duration from the switch", async () => {
    const blank = await readLiveCalls(
      deps(1_700_000_000_000, durationHarness("blank").fetchImpl),
    );
    expect(blank.error).toBeNull();
    expect(blank.rows?.[0]?.seconds).toBe("");

    resetLiveCallMemory();
    const zero = await readLiveCalls(
      deps(1_700_000_000_000, durationHarness("zero").fetchImpl),
    );
    expect(zero.error).toBeNull();
    expect(zero.rows?.[0]?.seconds).toBe("0");
  });

  it("ignores a duplicated duration title and still reads the calls", async () => {
    const { fetchImpl, bodies } = durationHarness("duplicate");
    const read = await readLiveCalls(deps(1_700_000_000_000, fetchImpl));
    expect(read.error).toBeNull();
    expect(read.rows?.[0]?.seconds).toBe("45");
    expect(bodies.some((body) => body.includes("dur_a") || body.includes("dur_b"))).toBe(
      false,
    );
  });

  it("drops a duration column after one SOAP fault and does not ask again", async () => {
    const { fetchImpl, bodies } = durationHarness("fault");
    let now = 1_700_000_000_000;
    const read = await readLiveCalls({
      ...deps(now, fetchImpl),
      now: () => now,
    });
    expect(read.error).toBeNull();
    expect(read.rows?.[0]?.seconds).toBe("45");
    expect(bodies.filter((body) => body.includes("talk_sec"))).toHaveLength(1);
    expect(bodies.filter((body) => body.includes("<ns1:getObjects"))).toHaveLength(1);

    now += 3_000;
    const again = await readLiveCalls({
      ...deps(now, fetchImpl),
      now: () => now,
    });
    expect(again.error).toBeNull();
    expect(bodies.filter((body) => body.includes("talk_sec"))).toHaveLength(1);
    expect(bodies.filter((body) => body.includes("<ns1:getObjects"))).toHaveLength(1);
  });

  it("does not repeat a duration select after an HTTP error", async () => {
    const { fetchImpl, bodies } = durationHarness("http");
    const read = await readLiveCalls(deps(1_700_000_000_000, fetchImpl));
    expect(read.rows).toBeNull();
    expect(read.error).toBe("Коммутатор ответил ошибкой HTTP.");
    expect(bodies.filter((body) => body.includes("talk_sec"))).toHaveLength(1);
  });

  it("shows the interface string for call state and keeps rows when lookup fails", async () => {
    const lookupWsdl = WSDL.replace(
      `<message name="insertRowsetRequest">`,
      `<message name="getLookupRequest"><part name="p_object_id" type="xsd:string"/><part name="p_column_nm" type="xsd:string"/></message><message name="insertRowsetRequest">`,
    )
      .replace(
        `<operation name="insertRowset"><input message="tns:insertRowsetRequest"/></operation>`,
        `<operation name="getLookup"><input message="tns:getLookupRequest"/></operation><operation name="insertRowset"><input message="tns:insertRowsetRequest"/></operation>`,
      )
      .replace(
        `<operation name="insertRowset">
      <soap:operation soapAction="urn:insertRowset"/>`,
        `<operation name="getLookup">
      <soap:operation soapAction="urn:rtu-api#getLookup"/>
      <input><soap:body use="encoded" namespace="urn:rtu-api" encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"/></input>
    </operation>
    <operation name="insertRowset">
      <soap:operation soapAction="urn:insertRowset"/>`,
      );
    const described = PUPR_DESCRIBE.replace(
      column("call_state", "Состояние вызова"),
      `<item><name>call_state</name><title>Состояние вызова</title><type>column</type><data_type>string</data_type><data_mask></data_mask><have_lookup>1</have_lookup></item>`,
    );
    const lookupOk = `<?xml version="1.0"?><Envelope><Body><getLookupResponse><item><key>talk</key><value>Разговор</value></item></getLookupResponse></Body></Envelope>`;
    let lookupMode: "ok" | "fault" = "ok";
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const body = typeof init?.body === "string" ? init.body : "";
      bodies.push(body);
      expect(body).not.toContain("insertRowset");
      expect(body).not.toContain("<node");
      expect(body).not.toContain('xmlns="args"');
      if (String(url).includes("wsdl")) return new Response(lookupWsdl, { status: 200 });
      if (body.includes("<ns1:getLookup")) {
        expect(body).toContain("call_state");
        expect(body).toContain("08.2505.01");
        return new Response(lookupMode === "fault" ? FAULT : lookupOk, { status: 200 });
      }
      if (body.includes("<ns1:getObjects")) return new Response(OBJECTS, { status: 200 });
      if (body.includes("describeTable") && body.includes("08.2504.01"))
        return new Response(PCOMM_DESCRIBE, { status: 200 });
      if (body.includes("describeTable") && body.includes("08.2505.01"))
        return new Response(described, { status: 200 });
      if (body.includes("selectRowset") && body.includes("08.2504.01")) {
        expect(body).not.toContain("category");
        return new Response(PCOMM_ROWS, { status: 200 });
      }
      if (body.includes("selectRowset") && body.includes("08.2505.01"))
        return new Response(PUPR_ROWS, { status: 200 });
      throw new Error(`unexpected call ${body.slice(0, 160)}`);
    };
    const lookups = () => bodies.filter((body) => body.includes("<ns1:getLookup")).length;
    let now = 1_700_000_000_000;
    const input = { ...deps(now, fetchImpl), now: () => now };
    const translated = await readLiveCalls(input);
    expect(translated.error).toBeNull();
    expect(translated.rows?.[0]?.state).toBe("Разговор");
    expect(translated.rows?.[2]?.state).toBe("extra");
    expect(lookups()).toBe(1);

    now += 3_000;
    const cached = await readLiveCalls(input);
    expect(cached.rows?.[0]?.state).toBe("Разговор");
    expect(lookups()).toBe(1);

    resetLiveCallMemory();
    lookupMode = "fault";
    now += 3_000;
    const failed = await readLiveCalls(input);
    expect(failed.error).toBeNull();
    expect(failed.rows?.[0]?.state).toBe("talk");
    expect(lookups()).toBe(2);

    now += 3_000;
    await readLiveCalls(input);
    expect(lookups()).toBe(2);

    now += MODULE_NAMES_MS;
    await readLiveCalls(input);
    expect(lookups()).toBe(3);
  });
});

function durationHarness(
  kind: "value" | "blank" | "zero" | "duplicate" | "fault" | "http",
) {
  const bodies: string[] = [];
  const timed = kind === "value" || kind === "blank" || kind === "zero";
  const onPcomm = kind === "fault" || kind === "http";
  const pcommDescribe =
    kind === "duplicate"
      ? PCOMM_DESCRIBE.replace(
          "</columns>",
          `${column("dur_a", "Время разговора")}${column("dur_b", "Время разговора")}</columns>`,
        )
      : onPcomm
        ? PCOMM_DESCRIBE.replace(
            "</columns>",
            `${column("talk_sec", "Время разговора, сек")}</columns>`,
          )
        : PCOMM_DESCRIBE;
  const puprDescribe = timed
    ? PUPR_DESCRIBE.replace(
        "</columns>",
        `${column("talk_sec", "Время разговора, сек")}</columns>`,
      )
    : PUPR_DESCRIBE;
  const talkValue = kind === "value" ? "37" : kind === "zero" ? "0" : "";
  const pcommRows = timed
    ? `<?xml version="1.0"?><Envelope><Body><selectRowsetResponse>${row([
        ["conf_id", "c1"],
        ["t_conn", "20261104034800"],
      ])}</selectRowsetResponse></Body></Envelope>`
    : PCOMM_ROWS;
  const puprRows = timed
    ? `<?xml version="1.0"?><Envelope><Body><selectRowsetResponse>${row([
        ["conf_id", "c1"],
        ["call_state", "talk"],
        ["talk_sec", talkValue],
      ])}</selectRowsetResponse></Body></Envelope>`
    : PUPR_ROWS;
  const fetchImpl: typeof fetch = async (url, init) => {
    const body = typeof init?.body === "string" ? init.body : "";
    bodies.push(body);
    expect(body).not.toContain("insertRowset");
    expect(body).not.toContain("deleteRowset");
    const target = String(url);
    if (target.includes("wsdl")) return new Response(WSDL, { status: 200 });
    if (body.includes("<ns1:getObjects")) return new Response(OBJECTS, { status: 200 });
    if (body.includes("describeTable") && body.includes("08.2504.01"))
      return new Response(pcommDescribe, { status: 200 });
    if (body.includes("describeTable") && body.includes("08.2505.01"))
      return new Response(puprDescribe, { status: 200 });
    if (body.includes("selectRowset") && body.includes("08.2504.01")) {
      if (kind === "http" && body.includes("talk_sec"))
        return new Response("no", { status: 500 });
      if (kind === "fault" && body.includes("talk_sec")) {
        return new Response(
          `<?xml version="1.0"?><Envelope><Body><Fault><faultstring>Неизвестная колонка talk_sec</faultstring></Fault></Body></Envelope>`,
          { status: 200 },
        );
      }
      return new Response(pcommRows, { status: 200 });
    }
    if (body.includes("selectRowset") && body.includes("08.2505.01"))
      return new Response(puprRows, { status: 200 });
    throw new Error(`unexpected ${body.slice(0, 160)}`);
  };
  return { fetchImpl, bodies };
}

const MODULE_OBJECTS = `<?xml version="1.0"?>
<Envelope><Body><getObjectsResponse>
  <item>
    <object_id>08.2799.01</object_id>
    <title>Транзитные вызовы (ПКомм)</title>
    <path>Подсистема коммутации;Мониторинг ПКомм;Данные по модулям;signaling-1;Конференции Class 4</path>
    <type>table</type>
  </item>
  <item>
    <object_id>08.2701.01</object_id>
    <title>Транзитные вызовы (ПКомм)</title>
    <path>Подсистема коммутации;Мониторинг ПКомм;Данные по модулям;;Конференции Class 4</path>
    <type>table</type>
  </item>
  <item>
    <object_id>08.2702.01</object_id>
    <title>Транзитные вызовы (ПУпр)</title>
    <path>Подсистема коммутации;Мониторинг ПКомм;Данные по модулям;;Вызовы</path>
    <type>table</type>
  </item>
  <item>
    <object_id>08.2703.01</object_id>
    <title>Активные модули</title>
    <path>Подсистема коммутации;Мониторинг ПКомм;Активные модули</path>
    <type>table</type>
  </item>
</getObjectsResponse></Body></Envelope>`;

const MODULE_DESCRIBE = `<?xml version="1.0"?><Envelope><Body><describeTableResponse><columns>
  ${column("module_name", "Модуль")}
</columns></describeTableResponse></Body></Envelope>`;

function moduleNames(kind: "ok" | "many" | "none" | "odd"): string {
  const names =
    kind === "odd"
      ? ["signaling-1", "signaling-west", "scripting-1"]
      : kind === "many"
        ? [
            "signaling-1",
            "signaling-2",
            "signaling-3",
            "signaling-4",
            "signaling-5",
            "scripting-1",
          ]
        : kind === "none"
          ? ["media-1", "management-1"]
          : [
              "media-1",
              "signaling-2",
              "signaling-1",
              "signaling-1",
              "scripting-2",
              "scripting-1",
              "management-1",
            ];
  return `<?xml version="1.0"?><Envelope><Body><selectRowsetResponse>${names
    .map((name) => row([["module_name", name]]))
    .join("")}</selectRowsetResponse></Body></Envelope>`;
}

const SIGNALING_ONE = `<?xml version="1.0"?><Envelope><Body><selectRowsetResponse>
  ${row([
    ["conf_id", "c1"],
    ["t_start", "20261103233200"],
    ["out_a", "100"],
    ["src_sig", "1.1.1.1"],
  ])}
</selectRowsetResponse></Body></Envelope>`;

const SIGNALING_TWO = `<?xml version="1.0"?><Envelope><Body><selectRowsetResponse>
  ${row([
    ["conf_id", "c2"],
    ["out_a", "200"],
  ])}
</selectRowsetResponse></Body></Envelope>`;

const SCRIPTING_ONE = `<?xml version="1.0"?><Envelope><Body><selectRowsetResponse>
  ${row([
    ["conf_id", "c1"],
    ["call_state", "talk"],
    ["src_name", "gw-a"],
  ])}
</selectRowsetResponse></Body></Envelope>`;

function moduleNode(body: string): string {
  return body.match(/<node xmlns="args">([^<]*)<\/node>/)?.[1] ?? "";
}

function kindOf(body: string): string {
  if (body.includes("<ns1:getObjects")) return "objects";
  if (body.includes("describeTable") && body.includes("08.2701.01"))
    return "describe-pcomm";
  if (body.includes("describeTable") && body.includes("08.2702.01"))
    return "describe-pupr";
  if (body.includes("describeTable") && body.includes("08.2703.01"))
    return "describe-modules";
  if (body.includes("selectRowset") && body.includes("08.2703.01")) return "names";
  if (body.includes("selectRowset") && moduleNode(body)) return moduleNode(body);
  return "";
}

function pageOffset(body: string): number {
  const match = body.match(/<p_offset\b[^>]*>(\d+)<\/p_offset>/);
  return match ? Number(match[1]) : -1;
}

function callPage(ids: readonly string[]): string {
  return `<?xml version="1.0"?><Envelope><Body><selectRowsetResponse>${ids
    .map((id) =>
      row([
        ["conf_id", id],
        ["out_a", "1"],
      ]),
    )
    .join("")}</selectRowsetResponse></Body></Envelope>`;
}

const FULL_IDS = Array.from({ length: SELECT_ROW_LIMIT }, (_, index) => `p${index}`);
const FULL_PAGE = callPage(FULL_IDS);
const TAIL_PAGE = callPage(["tail"]);

function pageHarness(kind: "next" | "same" | "fault") {
  const bodies: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const body = typeof init?.body === "string" ? init.body : "";
    bodies.push(body);
    expect(body).not.toContain("deleteRowset");
    expect(body).not.toContain("insertRowset");
    expect(body).not.toContain("|node=");
    const target = String(url);
    if (target.includes("wsdl")) return new Response(WSDL, { status: 200 });
    if (body.includes("<ns1:getObjects"))
      return new Response(MODULE_OBJECTS, { status: 200 });
    if (body.includes("describeTable") && body.includes("08.2701.01")) {
      return new Response(PCOMM_DESCRIBE, { status: 200 });
    }
    if (body.includes("describeTable") && body.includes("08.2702.01")) {
      return new Response(PUPR_DESCRIBE, { status: 200 });
    }
    if (body.includes("describeTable") && body.includes("08.2703.01")) {
      return new Response(MODULE_DESCRIBE, { status: 200 });
    }
    if (body.includes("selectRowset") && body.includes("08.2703.01")) {
      expect(moduleNode(body)).toBe("");
      return new Response(moduleNames("ok"), { status: 200 });
    }
    const node = moduleNode(body);
    const offset = pageOffset(body);
    if (node === "signaling-1" && offset === 0)
      return new Response(FULL_PAGE, { status: 200 });
    if (node === "signaling-1" && offset === SELECT_ROW_LIMIT) {
      if (kind === "fault") return new Response(FAULT, { status: 200 });
      if (kind === "same") return new Response(FULL_PAGE, { status: 200 });
      return new Response(TAIL_PAGE, { status: 200 });
    }
    if (offset > SELECT_ROW_LIMIT) throw new Error(`offset ${offset}`);
    if (node === "signaling-2" || node === "scripting-1" || node === "scripting-2") {
      return new Response(EMPTY_SELECT, { status: 200 });
    }
    throw new Error(`unexpected page ${node} ${offset}`);
  };
  return { fetchImpl, bodies };
}

function moduleHarness(
  mode: () => "ok" | "fault" | "unknown",
  names: "ok" | "many" | "none" | "odd" = "ok",
) {
  const bodies: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const body = typeof init?.body === "string" ? init.body : "";
    bodies.push(body);
    expect(body).not.toContain("deleteRowset");
    expect(body).not.toContain("insertRowset");
    expect(body).not.toContain("updateRowset");
    expect(body).not.toContain("checkRowset");
    expect(body).not.toContain("args:node");
    expect(body).not.toContain("|node=");
    expect(body).not.toContain("getObjectId");
    const nodes = body.match(/<node xmlns="args">/g) ?? [];
    expect(nodes.length).toBeLessThanOrEqual(1);
    if (body.includes("getObjects") || body.includes("describeTable")) {
      expect(body).not.toContain('xmlns="args"');
    }
    const target = String(url);
    if (target.includes("wsdl")) return new Response(WSDL, { status: 200 });
    if (body.includes("<ns1:getObjects"))
      return new Response(MODULE_OBJECTS, { status: 200 });
    if (body.includes("describeTable") && body.includes("08.2701.01")) {
      return new Response(PCOMM_DESCRIBE, { status: 200 });
    }
    if (body.includes("describeTable") && body.includes("08.2702.01")) {
      return new Response(PUPR_DESCRIBE, { status: 200 });
    }
    if (body.includes("describeTable") && body.includes("08.2703.01")) {
      return new Response(MODULE_DESCRIBE, { status: 200 });
    }
    if (body.includes("selectRowset") && body.includes("08.2703.01")) {
      expect(moduleNode(body)).toBe("");
      return new Response(moduleNames(names), { status: 200 });
    }
    const node = moduleNode(body);
    if (body.includes("08.2799.01") || node === "media-1" || node === "management-1") {
      throw new Error(`unexpected module ${node || "decoy"}`);
    }
    if (
      (node === "signaling-1" || node === "signaling-2") &&
      !body.includes("08.2701.01")
    ) {
      throw new Error("signaling select on the wrong table");
    }
    if (
      (node === "scripting-1" || node === "scripting-2") &&
      !body.includes("08.2702.01")
    ) {
      throw new Error("scripting select on the wrong table");
    }
    const current = mode();
    if (node === "signaling-2" && current === "fault")
      return new Response(FAULT, { status: 200 });
    if (node === "signaling-2" && current === "unknown")
      return new Response(UNKNOWN, { status: 200 });
    if (node === "signaling-1" && body.includes("08.2701.01"))
      return new Response(SIGNALING_ONE, { status: 200 });
    if (node === "signaling-2" && body.includes("08.2701.01"))
      return new Response(SIGNALING_TWO, { status: 200 });
    if (node === "scripting-1" && body.includes("08.2702.01"))
      return new Response(SCRIPTING_ONE, { status: 200 });
    if (node === "scripting-2" && body.includes("08.2702.01"))
      return new Response(EMPTY_SELECT, { status: 200 });
    throw new Error(`unexpected call ${kindOf(body)} ${body.slice(0, 180)}`);
  };
  return { fetchImpl, bodies };
}
