import { describe, expect, it } from "vitest";
import type { SoapColumn } from "@/modules/rtu-soap/response";
import {
  EQUIPMENT_TITLES,
  mapEquipmentRows,
  prepareEquipmentColumns,
  refusePhonesSnapshot,
  type EquipmentField,
  type EquipmentLayout,
  type LookupPairs,
} from "@/modules/phones/rtu-rows";
import { ENDPOINT_HEADERS, GATEWAY_HEADERS } from "@/modules/phones/types";

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

function column(name: string, title: string, extra: Partial<SoapColumn> = {}): SoapColumn {
  return {
    name,
    title,
    dataMask: null,
    haveLookup: false,
    pk: false,
    ctlType: null,
    action: null,
    actionUnreadable: false,
    ...extra,
  };
}

function described(patch?: (column: SoapColumn) => SoapColumn): SoapColumn[] {
  const columns = (Object.keys(EQUIPMENT_TITLES) as EquipmentField[]).map((key) =>
    column(TECH[key], EQUIPMENT_TITLES[key]),
  );
  columns.push(column("gateway_id", "ID", { pk: true }));
  return patch ? columns.map(patch) : columns;
}

function layoutOf(columns: readonly SoapColumn[]): EquipmentLayout {
  const prepared = prepareEquipmentColumns(columns);
  if (!prepared.ok) throw new Error(prepared.detail);
  return prepared.layout;
}

function row(
  id: string,
  cells: Partial<Record<EquipmentField, string>>,
): Record<string, string> {
  const out: Record<string, string> = { gateway_id: id };
  for (const key of Object.keys(TECH) as EquipmentField[]) {
    out[TECH[key]] = cells[key] ?? "";
  }
  return out;
}

const TYPE_PAIRS: LookupPairs = [
  { key: "1", value: "Шлюз" },
  { key: "6", value: "Оконечное оборудование" },
  { key: "3", value: "ENUM" },
];

const PROTO_PAIRS: LookupPairs = [
  { key: "0", value: "H.323" },
  { key: "1", value: "SIP" },
  { key: "2", value: "ОКС-7" },
  { key: "3", value: "Внутренний" },
  { key: "4", value: "SIP-T/I" },
];

const GROUP_PAIRS: LookupPairs = [
  { key: "1", value: "Moscow" },
  { key: "2", value: "SPb" },
];

function withLookups(columns: SoapColumn[]): SoapColumn[] {
  return columns.map((item) =>
    item.name === "equipment_type" || item.name === "protocol" || item.name === "src_groups"
      ? { ...item, haveLookup: true }
      : item,
  );
}

describe("prepareEquipmentColumns", () => {
  it("requires every catalog title and one primary key", () => {
    const layout = layoutOf(described());
    expect(layout.pk).toBe("gateway_id");
    expect(layout.names).toContain("src_zone");
    expect(layout.names).toContain("dst_zone");
    expect(layout.names).not.toContain("visible_zone");
    expect(layout.lookup).toEqual({ type: false, protocol: false, groups: false });
    expect(prepareEquipmentColumns(described().filter((item) => item.title !== "Название"))).toEqual({
      ok: false,
      detail: "В таблице «Оборудование» нет колонки «Название».",
    });
  });

  it("fails a hidden required column and a list without a lookup", () => {
    expect(
      prepareEquipmentColumns(
        described((item) => (item.name === "reg_password" ? { ...item, action: 2 } : item)),
      ).ok,
    ).toBe(false);
    expect(
      prepareEquipmentColumns(
        described((item) =>
          item.name === "src_groups" ? { ...item, ctlType: "arrangebox" } : item,
        ),
      ),
    ).toMatchObject({ ok: false });
  });

  it("fails two columns with the same zone name", () => {
    const columns = described();
    columns.push(column("src_zone", "Другая зона"));
    expect(prepareEquipmentColumns(columns).ok).toBe(false);
  });
});

describe("mapEquipmentRows", () => {
  const columns = withLookups(described());
  const layout = layoutOf(columns);

  function map(rows: Array<Record<string, string>>) {
    return mapEquipmentRows({
      layout,
      rows,
      lookups: { type: TYPE_PAIRS, protocol: PROTO_PAIRS, groups: GROUP_PAIRS },
    });
  }

  it("builds the same catalog keys as export.py", () => {
    const mapped = map([
      row("e1", {
        name: "EP yes",
        description: "опис",
        equipmentType: "6",
        endpointNumber: "7495",
        originator: "TRUE",
        terminator: "нет",
        registration: "1",
        srcZone: "A",
        dstZone: "B",
        zone: "VISIBLE",
        srcAddresses: "1.1.1.1",
        srcPort: "5060",
        srcCapacity: "",
        groups: "1; 2; ;9",
        dstAddresses: "2.2.2.2",
        dstPort: "5080",
        dstCapacity: "0",
        regName: "user",
        regPassword: "secret",
        regAddresses: "3.3.3.3",
      }),
      row("e2", {
        name: "EP no",
        equipmentType: "6",
        registration: "false",
        srcZone: "SRC",
        dstZone: "DST",
        zone: "VISIBLE",
      }),
      row("g1", {
        name: "GW",
        equipmentType: "1",
        protocol: "2",
        originator: "0",
        terminator: "1",
        srcZone: "GS",
        dstZone: "GD",
        srcAddresses: "10.0.0.1",
        dstAddresses: "10.0.0.2",
      }),
      row("x1", { name: "ENUM", equipmentType: "3" }),
    ]);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.payload.endpointHeaders).toEqual([...ENDPOINT_HEADERS]);
    expect(mapped.payload.gatewayHeaders).toEqual([...GATEWAY_HEADERS]);
    expect(mapped.payload.endpoints).toHaveLength(2);
    expect(mapped.payload.gateways).toHaveLength(1);
    const registered = mapped.payload.endpoints[0]?.data ?? {};
    expect(registered["Регистрация"]).toBe("Да");
    expect(registered["Зона"]).toBe("A");
    expect(registered["ИНИЦ. зона"]).toBe("");
    expect(registered["ТЕРМ. зона"]).toBe("");
    expect(registered["ИНИЦ. емкость"]).toBe("");
    expect(registered["ТЕРМ. емкость"]).toBe("0");
    expect(registered["Входящие группы"]).toBe("Moscow; 2; ;9");
    expect(registered["Регистрационный пароль"]).toBe("secret");
    expect(registered["ТЕРМ. порт"]).toBe("5080");
    expect(registered["Инициирующее устройство"]).toBe("Да");
    expect(registered["Терминирующее устройство"]).toBe("Нет");
    const open = mapped.payload.endpoints[1]?.data ?? {};
    expect(open["Регистрация"]).toBe("Нет");
    expect(open["Зона"]).toBe("");
    expect(open["ИНИЦ. зона"]).toBe("SRC");
    expect(open["ТЕРМ. зона"]).toBe("DST");
    const gateway = mapped.payload.gateways[0]?.data ?? {};
    expect(gateway["Протокол сигнализации"]).toBe("SS7");
    expect(gateway["ИНИЦ. зона"]).toBe("GS");
    expect(gateway["ТЕРМ. зона"]).toBe("GD");
    expect(gateway["Зона"]).toBeUndefined();
    expect(gateway["Регистрация"]).toBeUndefined();
    expect(JSON.stringify(mapped.payload.endpoints[0])).not.toContain("VISIBLE");
  });

  it("translates protocol aliases and keeps an unknown protocol", () => {
    const mapped = map([
      row("g-sip", { name: "sip", equipmentType: "Шлюз", protocol: "sip" }),
      row("g-int", { name: "int", equipmentType: "1", protocol: "3" }),
      row("g-both", { name: "both", equipmentType: "1", protocol: "H.323 и SIP" }),
    ]);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.payload.gateways.map((item) => item.data["Протокол сигнализации"])).toEqual([
      "SIP",
      "Internal",
      "Ошибка",
    ]);
  });

  it("drops an unknown type and refuses a snapshot that recognizes nothing", () => {
    const dropped = map([row("x", { name: "other", equipmentType: "9" })]);
    expect(dropped).toMatchObject({ ok: false, detail: "Тип оборудования не распознан." });
    const empty = map([]);
    expect(empty.ok).toBe(true);
    if (!empty.ok) return;
    expect(empty.payload.endpoints).toEqual([]);
    expect(empty.payload.gateways).toEqual([]);
  });

  it("refuses a repeated type label, a bad registration, and an empty name", () => {
    expect(
      mapEquipmentRows({
        layout,
        rows: [row("e", { name: "a", equipmentType: "6", registration: "1" })],
        lookups: {
          type: [...TYPE_PAIRS, { key: "16", value: "Оконечное оборудование" }],
          protocol: PROTO_PAIRS,
          groups: GROUP_PAIRS,
        },
      }).ok,
    ).toBe(false);
    expect(
      map([row("e", { name: "a", equipmentType: "6", registration: "yes" })]).ok,
    ).toBe(false);
    expect(map([row("e", { name: "  ", equipmentType: "6", registration: "1" })]).ok).toBe(
      false,
    );
  });

  it("keeps a group cell unchanged when it has no lookup", () => {
    const plain = layoutOf(described());
    const mapped = mapEquipmentRows({
      layout: plain,
      rows: [row("e", { name: "a", equipmentType: "6", registration: "Да", groups: "1;;2" })],
      lookups: { type: null, protocol: null, groups: null },
    });
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.payload.endpoints[0]?.data["Входящие группы"]).toBe("1;;2");
    expect(mapped.payload.endpoints[0]?.data["Регистрация"]).toBe("Да");
  });
});

describe("refusePhonesSnapshot", () => {
  const endpoint = (zone: string, password = "secret") => ({
    Название: "a",
    Регистрация: "Да",
    Зона: zone,
    "Регистрационный пароль": password,
    "ИНИЦ. список адресов": "1.1.1.1",
    "ТЕРМ. список адресов": "2.2.2.2",
    "Входящие группы": "Moscow",
  });
  const gateway = {
    Название: "g",
    "Протокол сигнализации": "SIP",
    "ИНИЦ. зона": "GS",
    "ТЕРМ. зона": "GD",
    "ИНИЦ. список адресов": "10.0.0.1",
    "ТЕРМ. список адресов": "10.0.0.2",
    "Входящие группы": "SPb",
  };

  function payload(endpoints: Array<Record<string, string>>, gateways: Array<Record<string, string>>) {
    return {
      version: 2,
      endpointHeaders: [...ENDPOINT_HEADERS],
      gatewayHeaders: [...GATEWAY_HEADERS],
      endpoints: endpoints.map((data, index) => ({
        name: data["Название"] ?? String(index),
        endpointNumber: "1",
        data,
      })),
      gateways: gateways.map((data) => ({ name: data["Название"] ?? "g", data })),
    };
  }

  const previous = {
    endpoints: [endpoint("A"), endpoint("B", "other")],
    gateways: [gateway],
  };

  it("allows a one-row edit", () => {
    expect(
      refusePhonesSnapshot(previous, payload([endpoint("A"), endpoint("C", "new")], [gateway])),
    ).toEqual({ ok: true });
  });

  it("refuses a side, a mask, or a column that disappears", () => {
    expect(refusePhonesSnapshot(previous, payload([], [gateway])).ok).toBe(false);
    expect(refusePhonesSnapshot(previous, payload([endpoint("A")], [])).ok).toBe(false);
    expect(
      refusePhonesSnapshot(
        previous,
        payload([endpoint("A", "***"), endpoint("B", "••")], [gateway]),
      ).ok,
    ).toBe(false);
    expect(
      refusePhonesSnapshot(
        previous,
        payload([endpoint(""), endpoint("")], [{ ...gateway, "ИНИЦ. зона": "", "ТЕРМ. зона": "" }]),
      ).ok,
    ).toBe(false);
  });
});
