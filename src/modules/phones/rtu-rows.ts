/**
 * Turn one page of «Оборудование» into the phone catalog snapshot.
 * Catalog keys stay the phone-table names, including «емкость» with «е».
 */

import { normalizeRtuLabel } from "@/modules/live-calls/columns";
import { mapColumns } from "@/modules/live-calls/catalog";
import {
  EQUIPMENT_SELECT_COLUMN_CAP,
  isRtuColumnName,
} from "@/modules/rtu-soap/envelope";
import type { SoapColumn } from "@/modules/rtu-soap/response";
import { EQUIPMENT_TITLE } from "@/modules/phones/rtu-catalog";
import {
  ENDPOINT_HEADERS,
  GATEWAY_HEADERS,
  REGISTRATION_NO,
  REGISTRATION_YES,
  STATUS_ACTIVE,
  STATUS_BLOCKED,
  STATUS_FIELD,
  type ParsedPhoneEndpoint,
  type ParsedPhoneGateway,
  type ParsedPhonesPayload,
  type PhoneRowData,
} from "@/modules/phones/types";

export const EQUIPMENT_TITLES = {
  name: "Название",
  description: "Описание",
  equipmentType: "Тип оборудования",
  endpointNumber: "Номер оконечного оборудования",
  originator: "Действует как иниц. устр-во",
  terminator: "Действует как терм. устр-во",
  registration: "Регистрировать оборудование",
  protocol: "Протокол сигнализации",
  zone: "Зона",
  srcZone: "ИНИЦ. Зона",
  dstZone: "ТЕРМ. Зона",
  srcAddresses: "ИНИЦ. Список адресов (IPv4)",
  srcPort: "ИНИЦ. Порт",
  srcCapacity: "ИНИЦ. Ёмкость",
  groups: "Входящие группы",
  dstAddresses: "ТЕРМ. Список Адресов (IPv4)",
  dstPort: "ТЕРМ. SIP порт",
  dstCapacity: "ТЕРМ. Ёмкость",
  regName: "Регистрационное имя",
  regPassword: "Регистрационный пароль",
  regAddresses: "Список разреш. адресов для регистрации (IPv4)",
  active: "Запись активна",
} as const;

export type EquipmentField = keyof typeof EQUIPMENT_TITLES;

const GATEWAY_LABEL = "Шлюз";
const ENDPOINT_LABEL = "Оконечное оборудование";
const SRC_ZONE_NAME = "src_zone";
const DST_ZONE_NAME = "dst_zone";
const PROTOCOLS = ["H.323", "SIP", "SS7", "Internal", "SIP-T/I"] as const;
const PROTOCOL_NAMES = new Set<string>(PROTOCOLS);

const CATALOG = {
  name: "Название",
  description: "Описание",
  endpointNumber: "Номер оконечного оборудования",
  originator: "Инициирующее устройство",
  terminator: "Терминирующее устройство",
  registration: "Регистрация",
  zone: "Зона",
  srcAddresses: "ИНИЦ. список адресов",
  srcPort: "ИНИЦ. порт",
  srcZone: "ИНИЦ. зона",
  srcCapacity: "ИНИЦ. емкость",
  groups: "Входящие группы",
  dstAddresses: "ТЕРМ. список адресов",
  dstPort: "ТЕРМ. порт",
  dstZone: "ТЕРМ. зона",
  dstCapacity: "ТЕРМ. емкость",
  regName: "Регистрационное имя",
  regPassword: "Регистрационный пароль",
  regAddresses: "Список разрешенных адресов для регистрации",
  protocol: "Протокол сигнализации",
} as const;

export type LookupPairs = ReadonlyArray<{ key: string; value: string }>;

export type EquipmentLayout = {
  pk: string;
  names: readonly string[];
  field: Record<EquipmentField, string>;
  srcZone: string;
  dstZone: string;
  lookup: { type: boolean; protocol: boolean; groups: boolean };
};

export function prepareEquipmentColumns(
  columns: readonly SoapColumn[],
): { ok: true; layout: EquipmentLayout } | { ok: false; detail: string } {
  const mapped = mapColumns(columns, EQUIPMENT_TITLES, EQUIPMENT_TITLE);
  if (!mapped.ok) return mapped;
  const field = {} as Record<EquipmentField, string>;
  for (const key of Object.keys(EQUIPMENT_TITLES) as EquipmentField[]) {
    const column = columnByName(columns, mapped.columns[key].name);
    if (!column) {
      return {
        ok: false,
        detail: `В таблице «${EQUIPMENT_TITLE}» нет колонки «${EQUIPMENT_TITLES[key]}».`,
      };
    }
    const hidden = rejectHidden(column);
    if (hidden) return { ok: false, detail: hidden };
    field[key] = column.name;
  }
  const names = new Set(Object.values(field));
  if (names.size !== Object.keys(field).length) {
    return {
      ok: false,
      detail: "Колонки «Оборудование» имеют одинаковые технические имена.",
    };
  }

  const srcNamed = oneTechnical(columns, SRC_ZONE_NAME);
  if (!srcNamed.ok) return srcNamed;
  const dstNamed = oneTechnical(columns, DST_ZONE_NAME);
  if (!dstNamed.ok) return dstNamed;
  const srcZone = srcNamed.column?.name ?? field.srcZone;
  const dstZone = dstNamed.column?.name ?? field.dstZone;
  for (const column of [srcNamed.column, dstNamed.column]) {
    if (!column) continue;
    const hidden = rejectHidden(column);
    if (hidden) return { ok: false, detail: hidden };
  }

  const pkHits = columns.filter((column) => column.pk);
  if (pkHits.length !== 1 || !pkHits[0]) {
    return { ok: false, detail: "В таблице «Оборудование» нет одного первичного ключа." };
  }
  const pkColumn = pkHits[0];
  const pkHidden = rejectHidden(pkColumn);
  if (pkHidden) return { ok: false, detail: pkHidden };

  const groups = columnByName(columns, field.groups);
  if (groups && isListControl(groups.ctlType) && !groups.haveLookup) {
    return {
      ok: false,
      detail: "Колонка «Входящие группы» — список без подстановки.",
    };
  }

  const selected = uniqueNames([pkColumn.name, ...valueFields(field), srcZone, dstZone]);
  if (selected.length > EQUIPMENT_SELECT_COLUMN_CAP) {
    return { ok: false, detail: "Список колонок оборудования не помещается в запрос." };
  }

  const typeColumn = columnByName(columns, field.equipmentType);
  const protocolColumn = columnByName(columns, field.protocol);
  return {
    ok: true,
    layout: {
      pk: pkColumn.name,
      names: selected,
      field,
      srcZone,
      dstZone,
      lookup: {
        type: typeColumn?.haveLookup === true,
        protocol: protocolColumn?.haveLookup === true,
        groups: groups?.haveLookup === true,
      },
    },
  };
}

export type EquipmentIdentity = {
  pk: string;
  kind: "endpoint" | "gateway" | "other";
  name: string;
  number: string;
  /** Trimmed raw «Запись активна» cell. */
  rawActive: string;
  /** Decoded «Статус» for an endpoint. The raw cell for every other row. */
  activation: string;
  endpoint: PhoneRowData | null;
};

export function mapEquipmentRows(input: {
  layout: EquipmentLayout;
  rows: readonly Record<string, string>[];
  lookups: {
    type: LookupPairs | null;
    protocol: LookupPairs | null;
    groups: LookupPairs | null;
  };
}):
  | { ok: true; payload: ParsedPhonesPayload; identities: EquipmentIdentity[] }
  | { ok: false; detail: string } {
  const typePairs = input.layout.lookup.type ? input.lookups.type : null;
  if (input.layout.lookup.type && !typePairs) {
    return { ok: false, detail: "Подстановка «Тип оборудования» пуста." };
  }
  if (input.layout.lookup.protocol && !input.lookups.protocol) {
    return { ok: false, detail: "Подстановка «Протокол сигнализации» пуста." };
  }
  if (input.layout.lookup.groups && !input.lookups.groups) {
    return { ok: false, detail: "Подстановка «Входящие группы» пуста." };
  }
  const gatewayPair = typePairs ? oneLabel(typePairs, GATEWAY_LABEL) : null;
  const endpointPair = typePairs ? oneLabel(typePairs, ENDPOINT_LABEL) : null;
  if (typePairs && (!gatewayPair || !endpointPair)) {
    return {
      ok: false,
      detail:
        "Подстановка «Тип оборудования» не содержит «Шлюз» и «Оконечное оборудование».",
    };
  }
  if (gatewayPair === "many" || endpointPair === "many") {
    return { ok: false, detail: "Подстановка «Тип оборудования» повторяет подпись." };
  }

  const protocolLabels = input.lookups.protocol ? pairMap(input.lookups.protocol) : null;
  const groupLabels = input.lookups.groups ? pairMap(input.lookups.groups) : null;
  const endpoints: ParsedPhoneEndpoint[] = [];
  const gateways: ParsedPhoneGateway[] = [];
  const identities: EquipmentIdentity[] = [];
  const seenPk = new Set<string>();

  for (const row of input.rows) {
    const pk = cell(row, input.layout.pk).trim();
    if (!pk) return { ok: false, detail: "Пустой первичный ключ в строке оборудования." };
    if (seenPk.has(pk)) {
      return { ok: false, detail: "Повтор первичного ключа в строке оборудования." };
    }
    seenPk.add(pk);
    const rawActive = cell(row, input.layout.field.active).trim();
    const kind = classifyType(
      cell(row, input.layout.field.equipmentType),
      gatewayPair,
      endpointPair,
    );
    if (kind === "ambiguous") {
      return { ok: false, detail: "Тип оборудования неоднозначен." };
    }
    if (kind === "other") {
      identities.push({
        pk,
        kind,
        name: cell(row, input.layout.field.name).trim(),
        number: "",
        rawActive,
        activation: rawActive,
        endpoint: null,
      });
      continue;
    }
    const name = cell(row, input.layout.field.name).trim();
    if (!name) return { ok: false, detail: "Пустое название оборудования." };
    const originator = decodeBool(cell(row, input.layout.field.originator));
    const terminator = decodeBool(cell(row, input.layout.field.terminator));
    const srcZone = cell(row, input.layout.srcZone);
    const dstZone = cell(row, input.layout.dstZone);
    const groupCell = cell(row, input.layout.field.groups);
    const groups = input.layout.lookup.groups
      ? mapGroups(groupCell, groupLabels)
      : groupCell;
    if (kind === "gateway") {
      const data = blank(GATEWAY_HEADERS);
      data[CATALOG.name] = name;
      data[CATALOG.description] = cell(row, input.layout.field.description);
      data[CATALOG.originator] = originator;
      data[CATALOG.terminator] = terminator;
      data[CATALOG.protocol] = decodeProto(
        cell(row, input.layout.field.protocol),
        input.layout.lookup.protocol ? protocolLabels : null,
      );
      fillShared(data, row, input.layout, srcZone, dstZone, groups);
      gateways.push({ name, data });
      identities.push({
        pk,
        kind: "gateway",
        name,
        number: "",
        rawActive,
        activation: rawActive,
        endpoint: null,
      });
      continue;
    }
    const registration = decodeBool(cell(row, input.layout.field.registration));
    if (registration !== REGISTRATION_YES && registration !== REGISTRATION_NO) {
      return { ok: false, detail: "Регистрация должна быть «Да» или «Нет»." };
    }
    const activation = decodeActivation(cell(row, input.layout.field.active));
    if (!activation) {
      return { ok: false, detail: "Статус активации должен быть «Да» или «Нет»." };
    }
    const data = blank(ENDPOINT_HEADERS);
    data[CATALOG.name] = name;
    data[CATALOG.description] = cell(row, input.layout.field.description);
    const number = cell(row, input.layout.field.endpointNumber).trim();
    data[CATALOG.endpointNumber] = number;
    data[CATALOG.originator] = originator;
    data[CATALOG.terminator] = terminator;
    data[CATALOG.registration] = registration;
    data[CATALOG.zone] = registration === REGISTRATION_YES ? srcZone : "";
    data[CATALOG.srcZone] = registration === REGISTRATION_NO ? srcZone : "";
    data[CATALOG.dstZone] = registration === REGISTRATION_NO ? dstZone : "";
    data[CATALOG.regName] = cell(row, input.layout.field.regName);
    data[CATALOG.regPassword] = cell(row, input.layout.field.regPassword);
    data[CATALOG.regAddresses] = cell(row, input.layout.field.regAddresses);
    data[STATUS_FIELD] = activation;
    fillShared(
      data,
      row,
      input.layout,
      data[CATALOG.srcZone] ?? "",
      data[CATALOG.dstZone] ?? "",
      groups,
    );
    endpoints.push({
      name,
      endpointNumber: number.length > 0 ? number : null,
      data,
    });
    identities.push({
      pk,
      kind: "endpoint",
      name,
      number,
      rawActive,
      activation,
      endpoint: { ...data },
    });
  }

  if (input.rows.length > 0 && endpoints.length === 0 && gateways.length === 0) {
    return { ok: false, detail: "Тип оборудования не распознан." };
  }
  return {
    ok: true,
    payload: {
      version: 2,
      endpointHeaders: [...ENDPOINT_HEADERS],
      gatewayHeaders: [...GATEWAY_HEADERS],
      endpoints,
      gateways,
    },
    identities,
  };
}

export type PhoneCatalogSide = {
  endpoints: PhoneRowData[];
  gateways: PhoneRowData[];
};

/** Counts only. Cell values stay out of the refusal text. */
export function refusePhonesSnapshot(
  previous: PhoneCatalogSide,
  next: ParsedPhonesPayload,
): { ok: true } | { ok: false; detail: string } {
  const nextEndpoints = next.endpoints.map((row) => row.data);
  const nextGateways = next.gateways.map((row) => row.data);
  if (previous.endpoints.length > 0 && nextEndpoints.length === 0) {
    return { ok: false, detail: "Новый снимок без оконечного оборудования отклонён." };
  }
  if (previous.gateways.length > 0 && nextGateways.length === 0) {
    return { ok: false, detail: "Новый снимок без шлюзов отклонён." };
  }
  const previousPasswords = filled(previous.endpoints, CATALOG.regPassword);
  const nextPasswords = filled(nextEndpoints, CATALOG.regPassword);
  if (
    previousPasswords.length > 0 &&
    (nextPasswords.length === 0 || nextPasswords.every(isPasswordMask))
  ) {
    return { ok: false, detail: "В новом снимке не осталось регистрационных паролей." };
  }
  const previousRegistered = registered(previous.endpoints);
  const nextRegistered = registered(nextEndpoints);
  if (
    anyFilled(previousRegistered, CATALOG.zone) &&
    !anyFilled(nextRegistered, CATALOG.zone)
  ) {
    return {
      ok: false,
      detail: "В новом снимке не осталось зон у зарегистрированного оборудования.",
    };
  }
  const previousOpen = [...unregistered(previous.endpoints), ...previous.gateways];
  const nextOpen = [...unregistered(nextEndpoints), ...nextGateways];
  if (anyFilled(previousOpen, CATALOG.srcZone) && !anyFilled(nextOpen, CATALOG.srcZone)) {
    return { ok: false, detail: "В новом снимке не осталось ИНИЦ. зон." };
  }
  if (anyFilled(previousOpen, CATALOG.dstZone) && !anyFilled(nextOpen, CATALOG.dstZone)) {
    return { ok: false, detail: "В новом снимке не осталось ТЕРМ. зон." };
  }
  if (anyProtocol(previous.gateways) && !anyProtocol(nextGateways)) {
    return { ok: false, detail: "В новом снимке не осталось протоколов сигнализации." };
  }
  const previousAll = [...previous.endpoints, ...previous.gateways];
  const nextAll = [...nextEndpoints, ...nextGateways];
  if (
    anyFilled(previousAll, CATALOG.srcAddresses) &&
    !anyFilled(nextAll, CATALOG.srcAddresses)
  ) {
    return { ok: false, detail: "В новом снимке не осталось ИНИЦ. списков адресов." };
  }
  if (
    anyFilled(previousAll, CATALOG.dstAddresses) &&
    !anyFilled(nextAll, CATALOG.dstAddresses)
  ) {
    return { ok: false, detail: "В новом снимке не осталось ТЕРМ. списков адресов." };
  }
  if (anyFilled(previousAll, CATALOG.groups) && !anyFilled(nextAll, CATALOG.groups)) {
    return { ok: false, detail: "В новом снимке не осталось входящих групп." };
  }
  if (
    anyFilled(previous.endpoints, STATUS_FIELD) &&
    !anyFilled(nextEndpoints, STATUS_FIELD)
  ) {
    return {
      ok: false,
      detail: "В новом снимке не осталось статусов оконечного оборудования.",
    };
  }
  return { ok: true };
}

function fillShared(
  data: PhoneRowData,
  row: Record<string, string>,
  layout: EquipmentLayout,
  srcZone: string,
  dstZone: string,
  groups: string,
): void {
  data[CATALOG.srcAddresses] = cell(row, layout.field.srcAddresses);
  data[CATALOG.srcPort] = cell(row, layout.field.srcPort);
  data[CATALOG.srcZone] = srcZone;
  data[CATALOG.srcCapacity] = cell(row, layout.field.srcCapacity);
  data[CATALOG.groups] = groups;
  data[CATALOG.dstAddresses] = cell(row, layout.field.dstAddresses);
  data[CATALOG.dstPort] = cell(row, layout.field.dstPort);
  data[CATALOG.dstZone] = dstZone;
  data[CATALOG.dstCapacity] = cell(row, layout.field.dstCapacity);
}

function valueFields(field: Record<EquipmentField, string>): string[] {
  return (Object.keys(EQUIPMENT_TITLES) as EquipmentField[])
    .filter((key) => key !== "zone" && key !== "srcZone" && key !== "dstZone")
    .map((key) => field[key]);
}

function uniqueNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function columnByName(columns: readonly SoapColumn[], name: string): SoapColumn | null {
  return columns.find((column) => column.name === name) ?? null;
}

function oneTechnical(
  columns: readonly SoapColumn[],
  name: string,
): { ok: true; column: SoapColumn | null } | { ok: false; detail: string } {
  const hits = columns.filter((column) => column.name === name);
  if (hits.length > 1) {
    return { ok: false, detail: `Колонка ${name} встретилась дважды.` };
  }
  return { ok: true, column: hits[0] ?? null };
}

function rejectHidden(column: SoapColumn): string | null {
  if (!isRtuColumnName(column.name)) {
    return "Колонка РТУ имеет неподдерживаемое имя.";
  }
  if (column.actionUnreadable) {
    return `Права колонки «${column.title}» не разобраны.`;
  }
  if (column.action != null && (column.action & 1) === 0) {
    return `Колонка «${column.title}» скрыта для просмотра.`;
  }
  return null;
}

function isListControl(ctlType: string | null): boolean {
  if (!ctlType) return false;
  const text = ctlType.trim().toLowerCase();
  return text === "combobox" || text === "arrangebox";
}

function oneLabel(
  pairs: LookupPairs,
  label: string,
): { key: string; value: string } | "many" | null {
  const want = normalizeRtuLabel(label);
  const hits = pairs.filter(
    (pair) =>
      normalizeRtuLabel(pair.key) === want || normalizeRtuLabel(pair.value) === want,
  );
  if (hits.length > 1) return "many";
  return hits[0] ?? null;
}

function classifyType(
  raw: string,
  gateway: { key: string; value: string } | null,
  endpoint: { key: string; value: string } | null,
): "gateway" | "endpoint" | "other" | "ambiguous" {
  const text = normalizeRtuLabel(raw);
  if (gateway || endpoint) {
    const asGateway = gateway ? matchesPair(text, gateway) : false;
    const asEndpoint = endpoint ? matchesPair(text, endpoint) : false;
    if (asGateway && asEndpoint) return "ambiguous";
    if (asGateway) return "gateway";
    if (asEndpoint) return "endpoint";
    return "other";
  }
  if (text === GATEWAY_LABEL || raw.trim() === "1") return "gateway";
  if (text === ENDPOINT_LABEL || raw.trim() === "6") return "endpoint";
  return "other";
}

function matchesPair(text: string, pair: { key: string; value: string }): boolean {
  return text === normalizeRtuLabel(pair.key) || text === normalizeRtuLabel(pair.value);
}

function decodeBool(raw: string): "Да" | "Нет" | "Ошибка" {
  const text = raw.trim().toLowerCase();
  if (text === "1" || text === "true" || text === "да") return "Да";
  if (text === "0" || text === "false" || text === "нет") return "Нет";
  return "Ошибка";
}

/** «Запись активна» on an endpoint. A lookup is not read. The cell value stays out of the error. */
function decodeActivation(
  raw: string,
): typeof STATUS_ACTIVE | typeof STATUS_BLOCKED | null {
  const flag = decodeBool(raw);
  if (flag === "Да") return STATUS_ACTIVE;
  if (flag === "Нет") return STATUS_BLOCKED;
  return null;
}

function decodeProto(raw: string, labels: ReadonlyMap<string, string> | null): string {
  const code = raw.trim();
  if (/^[0-4]$/.test(code)) return PROTOCOLS[Number(code)] ?? "Ошибка";
  const translated = labels?.get(code) ?? labels?.get(raw) ?? code;
  const text = translated.trim().toLowerCase();
  if (text === "h.323") return "H.323";
  if (text === "sip") return "SIP";
  if (text === "ss7" || text === "окс-7") return "SS7";
  if (text === "internal" || text === "внутренний") return "Internal";
  if (text === "sip-t/i") return "SIP-T/I";
  return "Ошибка";
}

function mapGroups(raw: string, labels: ReadonlyMap<string, string> | null): string {
  const parts = raw.split(";");
  const out: string[] = [];
  for (const part of parts) {
    if (part.length === 0) continue;
    const label = labels?.get(part);
    out.push(label !== undefined ? label : part);
  }
  return out.join(";");
}

function pairMap(pairs: LookupPairs): Map<string, string> {
  const labels = new Map<string, string>();
  for (const pair of pairs) labels.set(pair.key, pair.value);
  return labels;
}

function cell(row: Record<string, string>, name: string): string {
  return row[name] ?? "";
}

function blank(headers: readonly string[]): PhoneRowData {
  const data: PhoneRowData = {};
  for (const header of headers) data[header] = "";
  return data;
}

function filled(rows: readonly PhoneRowData[], key: string): string[] {
  return rows.map((row) => (row[key] ?? "").trim()).filter((value) => value.length > 0);
}

function anyFilled(rows: readonly PhoneRowData[], key: string): boolean {
  return filled(rows, key).length > 0;
}

function registered(rows: readonly PhoneRowData[]): PhoneRowData[] {
  return rows.filter(
    (row) => (row[CATALOG.registration] ?? "").trim() === REGISTRATION_YES,
  );
}

function unregistered(rows: readonly PhoneRowData[]): PhoneRowData[] {
  return rows.filter(
    (row) => (row[CATALOG.registration] ?? "").trim() === REGISTRATION_NO,
  );
}

function anyProtocol(rows: readonly PhoneRowData[]): boolean {
  return rows.some((row) => PROTOCOL_NAMES.has((row[CATALOG.protocol] ?? "").trim()));
}

function isPasswordMask(value: string): boolean {
  return /^[*•]+$/.test(value);
}
