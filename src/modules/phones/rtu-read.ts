/**
 * Read the current «Оборудование» rows from the RTU SOAP API.
 * getObjects, describeTable, selectRowset, and countRowset.
 * getLookup only for type, protocol, and incoming groups. No node header.
 */

import { EQUIPMENT_TITLE, findEquipmentTable } from "@/modules/phones/rtu-catalog";
import {
  mapEquipmentRows,
  prepareEquipmentColumns,
  type EquipmentLayout,
  type LookupPairs,
} from "@/modules/phones/rtu-rows";
import type { ParsedPhonesPayload } from "@/modules/phones/types";
import { loadRtuSoapAccount } from "@/modules/rtu-soap/credentials";
import { rtuExchange, type RtuExchange } from "@/modules/rtu-soap/exchange";
import {
  EQUIPMENT_SELECT_COLUMN_CAP,
  EQUIPMENT_SELECT_OFFSET_CAP,
  SELECT_ROW_LIMIT,
  buildCountRowsetEnvelope,
  buildDescribeTableEnvelope,
  buildGetLookupEnvelope,
  buildGetObjectsEnvelope,
  buildSelectRowsetEnvelope,
  isRtuColumnName,
  quoteSoapAction,
  registrationStateLookup,
} from "@/modules/rtu-soap/envelope";
import {
  interpretCountRowset,
  interpretDescribeTable,
  interpretGetLookup,
  interpretGetObjects,
  interpretSelectRowset,
} from "@/modules/rtu-soap/response";
import { redactSecret } from "@/modules/rtu-soap/xml";
import { readCallReads, readWsdl, type CallReadPlan } from "@/modules/rtu-soap/wsdl";

const WSDL_TIMEOUT_MS = 10_000;
const DESCRIBE_TIMEOUT_MS = 20_000;
const LOOKUP_TIMEOUT_MS = 20_000;
const PAGE_TIMEOUT_MS = 60_000;
export const EQUIPMENT_MAX_PAGES = 25;

const EQUIPMENT_BOUNDS = {
  columnCap: EQUIPMENT_SELECT_COLUMN_CAP,
  offsetCap: EQUIPMENT_SELECT_OFFSET_CAP,
};

export type EquipmentAccount = {
  origin: string;
  login: string;
  password: string;
  caPem: string | null;
};

export type EquipmentRead =
  | { ok: true; payload: ParsedPhonesPayload }
  | { ok: false; detail: string };

export type EquipmentExchange = (input: {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  caPem: string | null;
  fetchImpl?: typeof fetch;
}) => Promise<RtuExchange>;

export async function readStoredEquipment(
  fetchImpl?: typeof fetch,
): Promise<EquipmentRead> {
  const account = await loadRtuSoapAccount();
  if (!account.ok) {
    return {
      ok: false,
      detail:
        account.code === "DECRYPT_FAILED"
          ? "Пароль API РТУ не расшифрован."
          : "Учётка API РТУ не задана.",
    };
  }
  return readEquipment({ account, fetchImpl });
}

export async function readEquipment(deps: {
  account: EquipmentAccount;
  fetchImpl?: typeof fetch;
  exchange?: EquipmentExchange;
}): Promise<EquipmentRead> {
  const exchange = deps.exchange ?? rtuExchange;
  const secret = deps.account.password;
  const fail = (detail: string): EquipmentRead => ({
    ok: false,
    detail: redactSecret(detail, secret),
  });

  const wsdl = await exchange({
    url: `${deps.account.origin}/service/?wsdl_v2`,
    method: "GET",
    headers: { Accept: "text/xml, application/xml" },
    timeoutMs: WSDL_TIMEOUT_MS,
    caPem: deps.account.caPem,
    fetchImpl: deps.fetchImpl,
  });
  if (!wsdl.ok) return fail(wsdl.detail);
  if (wsdl.status >= 300 && wsdl.status < 400) {
    return fail("WSDL ответил редиректом. Пароль не отправлен.");
  }
  if (wsdl.status < 200 || wsdl.status >= 300) {
    return fail("WSDL не получен.");
  }
  const objectsPlan = readWsdl(wsdl.text, deps.account.origin);
  const readsPlan = readCallReads(wsdl.text, deps.account.origin);
  if (!objectsPlan.ok || !readsPlan.ok || objectsPlan.endpoint !== readsPlan.endpoint) {
    const reason = !objectsPlan.ok
      ? objectsPlan.reason
      : !readsPlan.ok
        ? readsPlan.reason
        : "host";
    return fail(
      reason === "host"
        ? "WSDL указывает другой адрес. Пароль не отправлен."
        : "Схема чтения РТУ в WSDL не разобрана.",
    );
  }
  if (readsPlan.countRowsetRejected) {
    return fail("Схема countRowset в WSDL не разобрана.");
  }

  const listed = await postRead(
    deps,
    exchange,
    objectsPlan.endpoint,
    objectsPlan.binding.soapAction,
    buildGetObjectsEnvelope(
      objectsPlan.binding,
      deps.account.login,
      deps.account.password,
    ),
    DESCRIBE_TIMEOUT_MS,
  );
  if (!listed.ok) return fail(listed.detail);
  const objects = interpretGetObjects(listed.text, secret);
  if (objects.kind === "fault") return fail(objects.detail);
  if (objects.kind !== "objects") return fail("Ответ getObjects не разобран.");
  const table = findEquipmentTable(objects.objects);
  if (!table.ok) return fail(table.detail);

  let describeEnvelope: string;
  try {
    describeEnvelope = buildDescribeTableEnvelope(
      readsPlan.describeTable,
      deps.account.login,
      deps.account.password,
      table.objectId,
    );
  } catch {
    return fail("Идентификатор таблицы РТУ не подходит для чтения.");
  }
  const described = await postRead(
    deps,
    exchange,
    readsPlan.endpoint,
    readsPlan.describeTable.soapAction,
    describeEnvelope,
    DESCRIBE_TIMEOUT_MS,
  );
  if (!described.ok) return fail(described.detail);
  const columns = interpretDescribeTable(described.text, secret);
  if (columns.kind === "fault") return fail(columns.detail);
  if (columns.kind !== "columns") return fail("Ответ describeTable не разобран.");
  const prepared = prepareEquipmentColumns(columns.columns);
  if (!prepared.ok) return fail(prepared.detail);
  const layout = prepared.layout;

  const typeLookup = await columnLookup(
    deps,
    exchange,
    readsPlan,
    table.objectId,
    "Тип оборудования",
    layout.field.equipmentType,
    layout.lookup.type,
  );
  if (!typeLookup.ok) return fail(typeLookup.detail);
  const protocolLookup = await columnLookup(
    deps,
    exchange,
    readsPlan,
    table.objectId,
    "Протокол сигнализации",
    layout.field.protocol,
    layout.lookup.protocol,
  );
  if (!protocolLookup.ok) return fail(protocolLookup.detail);
  const groupsLookup = await columnLookup(
    deps,
    exchange,
    readsPlan,
    table.objectId,
    "Входящие группы",
    layout.field.groups,
    layout.lookup.groups,
  );
  if (!groupsLookup.ok) return fail(groupsLookup.detail);

  let expectedCount: number | null = null;
  if (readsPlan.countRowset) {
    let countEnvelope: string;
    try {
      countEnvelope = buildCountRowsetEnvelope(
        readsPlan.countRowset,
        deps.account.login,
        deps.account.password,
        table.objectId,
      );
    } catch {
      return fail("Запрос countRowset не собран.");
    }
    const counted = await postRead(
      deps,
      exchange,
      readsPlan.endpoint,
      readsPlan.countRowset.soapAction,
      countEnvelope,
      PAGE_TIMEOUT_MS,
    );
    if (!counted.ok) return fail(counted.detail);
    const count = interpretCountRowset(counted.text, secret);
    if (count.kind === "fault") return fail(count.detail);
    if (count.kind !== "count") return fail("Ответ countRowset не разобран.");
    expectedCount = count.count;
  }

  const pages = await collectEquipmentPages(async (offset) => {
    let envelope: string;
    try {
      envelope = buildSelectRowsetEnvelope(
        readsPlan.selectRowset,
        deps.account.login,
        deps.account.password,
        table.objectId,
        layout.names,
        undefined,
        offset,
        EQUIPMENT_BOUNDS,
      );
    } catch {
      return { ok: false, detail: "Страница списка оборудования не собрана." };
    }
    const selected = await postRead(
      deps,
      exchange,
      readsPlan.endpoint,
      readsPlan.selectRowset.soapAction,
      envelope,
      PAGE_TIMEOUT_MS,
    );
    if (!selected.ok) return selected;
    const parsed = interpretSelectRowset(selected.text, secret);
    if (parsed.kind === "fault") return { ok: false, detail: parsed.detail };
    if (parsed.kind !== "rows") {
      return { ok: false, detail: "Ответ selectRowset не разобран." };
    }
    return { ok: true, rows: parsed.rows };
  }, layout.pk, expectedCount !== null);
  if (!pages.ok) return fail(pages.detail);
  if (expectedCount !== null && pages.rows.length !== expectedCount) {
    return fail(
      `Число строк страницы «${EQUIPMENT_TITLE}» не совпало со счётчиком: прочитано ${pages.rows.length}, счётчик ${expectedCount}.`,
    );
  }

  const mapped = mapEquipmentRows({
    layout,
    rows: pages.rows,
    lookups: {
      type: typeLookup.pairs,
      protocol: protocolLookup.pairs,
      groups: groupsLookup.pairs,
    },
  });
  if (!mapped.ok) return fail(mapped.detail);
  return mapped;
}

/**
 * Every page of the equipment table. A short page ends it.
 * Without countRowset only a short first page is complete.
 * An empty key, a repeated key, or a full last page is not a complete list.
 */
export async function collectEquipmentPages(
  readPage: (
    offset: number,
  ) => Promise<
    | { ok: true; rows: Array<Record<string, string>> }
    | { ok: false; detail: string }
  >,
  pk: string,
  verifyCount: boolean,
): Promise<
  | { ok: true; rows: Array<Record<string, string>> }
  | { ok: false; detail: string }
> {
  const maxPages = verifyCount ? EQUIPMENT_MAX_PAGES : 1;
  const rows: Array<Record<string, string>> = [];
  const seen = new Set<string>();
  for (let page = 0; page < maxPages; page += 1) {
    const selected = await readPage(page * SELECT_ROW_LIMIT);
    if (!selected.ok) return selected;
    if (selected.rows.length > SELECT_ROW_LIMIT) {
      return { ok: false, detail: "Список оборудования прочитан не целиком." };
    }
    for (const row of selected.rows) {
      const id = (row[pk] ?? "").trim();
      if (!id) return { ok: false, detail: "Пустой первичный ключ в строке оборудования." };
      if (seen.has(id)) {
        return { ok: false, detail: "Страницы оборудования пересекаются." };
      }
      seen.add(id);
    }
    rows.push(...selected.rows);
    if (selected.rows.length < SELECT_ROW_LIMIT) return { ok: true, rows };
    if (!verifyCount || page === maxPages - 1) {
      return { ok: false, detail: "Список оборудования прочитан не целиком." };
    }
  }
  return { ok: false, detail: "Список оборудования прочитан не целиком." };
}

async function columnLookup(
  deps: { account: EquipmentAccount; fetchImpl?: typeof fetch },
  exchange: EquipmentExchange,
  reads: Extract<CallReadPlan, { ok: true }>,
  objectId: string,
  title: string,
  columnName: string,
  needed: boolean,
): Promise<{ ok: true; pairs: LookupPairs | null } | { ok: false; detail: string }> {
  if (!needed) return { ok: true, pairs: null };
  const binding = reads.getLookup ?? registrationStateLookup(reads.describeTable);
  if (!binding) return { ok: false, detail: `Подстановка «${title}» недоступна.` };
  if (!isRtuColumnName(columnName)) {
    return { ok: false, detail: "Колонка РТУ имеет неподдерживаемое имя." };
  }
  let envelope: string;
  try {
    envelope = buildGetLookupEnvelope(
      binding,
      deps.account.login,
      deps.account.password,
      objectId,
      columnName,
    );
  } catch {
    return { ok: false, detail: `Подстановка «${title}» не собрана.` };
  }
  const posted = await postRead(
    deps,
    exchange,
    reads.endpoint,
    binding.soapAction,
    envelope,
    LOOKUP_TIMEOUT_MS,
  );
  if (!posted.ok) return posted;
  const parsed = interpretGetLookup(posted.text, deps.account.password);
  if (parsed.kind === "fault") return { ok: false, detail: parsed.detail };
  if (parsed.kind !== "lookup" || parsed.pairs.length === 0) {
    return { ok: false, detail: `Подстановка «${title}» пуста.` };
  }
  return { ok: true, pairs: parsed.pairs };
}

async function postRead(
  deps: { account: EquipmentAccount; fetchImpl?: typeof fetch },
  exchange: EquipmentExchange,
  endpoint: string,
  soapAction: string,
  envelope: string,
  timeoutMs: number,
): Promise<{ ok: true; text: string } | { ok: false; detail: string }> {
  const posted = await exchange({
    url: endpoint,
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: quoteSoapAction(soapAction),
    },
    body: envelope,
    timeoutMs,
    caPem: deps.account.caPem,
    fetchImpl: deps.fetchImpl,
  });
  if (!posted.ok) return { ok: false, detail: posted.detail };
  if (posted.status >= 300 && posted.status < 400) {
    return { ok: false, detail: "Сервис ответил редиректом." };
  }
  if (posted.status < 200 || posted.status >= 300) {
    return { ok: false, detail: "Коммутатор ответил ошибкой HTTP." };
  }
  return { ok: true, text: posted.text };
}

export type { EquipmentLayout };
