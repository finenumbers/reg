import {
  findTransitTable,
  mapColumns,
  type MappedColumn,
  type PcommMap,
  type PuprMap,
} from "@/modules/live-calls/catalog";
import {
  PCOMM_FIELDS,
  PCOMM_TABLE,
  PUPR_FIELDS,
  PUPR_TABLE,
  type LiveCallColumnKey,
  type PcommField,
  type PuprField,
} from "@/modules/live-calls/columns";
import { presentSwitchValue } from "@/modules/live-calls/format";
import { joinLiveCalls, type CallSide } from "@/modules/live-calls/join";
import { rtuExchange } from "@/modules/rtu-soap/exchange";
import {
  SELECT_ROW_LIMIT,
  buildDescribeTableEnvelope,
  buildGetObjectsEnvelope,
  buildSelectRowsetEnvelope,
  isRtuColumnName,
  isRtuObjectId,
  quoteSoapAction,
} from "@/modules/rtu-soap/envelope";
import {
  interpretDescribeTable,
  interpretGetObjects,
  interpretSelectRowset,
  type SoapColumn,
} from "@/modules/rtu-soap/response";
import { readCallReads, readWsdl, type CallBinding, type GetObjectsBinding } from "@/modules/rtu-soap/wsdl";

const REFRESH_MS = 3000;
const WSDL_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 12_000;
const UNKNOWN_OBJECT = /unknown object|неизвестн|does not exist|не найден/i;

export type LiveCallAccount = {
  origin: string;
  login: string;
  password: string;
  caPem: string | null;
};

export type LiveCallRow = Record<LiveCallColumnKey, string> & { key: string };

export type LiveCallPayload = {
  rows: LiveCallRow[] | null;
  takenAt: string | null;
  refreshInMs: number;
  truncated: boolean;
  error: string | null;
};

export type LiveCallDeps = {
  now: () => number;
  account: LiveCallAccount;
  fetchImpl?: typeof fetch;
};

type Catalog = {
  endpoint: string;
  getObjects: GetObjectsBinding;
  describeTable: CallBinding;
  selectRowset: CallBinding;
  pcommId: string;
  puprId: string;
  pcomm: PcommMap;
  pupr: PuprMap;
};

type Snapshot = {
  takenAtMs: number;
  takenAt: string;
  rows: LiveCallRow[];
  truncated: boolean;
};

type Memory = {
  key: string;
  catalog: Catalog | null;
  snapshot: Snapshot | null;
  attemptedAtMs: number;
  error: string | null;
};

let memory: Memory | null = null;
let pending: Promise<LiveCallPayload> | null = null;

export function resetLiveCallMemory(): void {
  memory = null;
  pending = null;
}

export function readLiveCalls(deps: LiveCallDeps): Promise<LiveCallPayload> {
  if (pending) return pending;
  pending = execute(deps).finally(() => {
    pending = null;
  });
  return pending;
}

async function execute(deps: LiveCallDeps): Promise<LiveCallPayload> {
  const key = `${deps.account.origin}\n${deps.account.login}`;
  if (memory && memory.key !== key) memory = null;
  const now = deps.now();
  if (memory && now - memory.attemptedAtMs < REFRESH_MS) {
    return view(memory, now);
  }

  let unknownRetried = false;
  for (;;) {
    const outcome = await readOnce(deps, memory?.catalog ?? null);
    if (outcome.kind === "retry") {
      if (!unknownRetried) {
        unknownRetried = true;
        if (memory) memory = { ...memory, catalog: null };
        continue;
      }
      return rememberError(deps, key, "Объект таблицы РТУ не найден.");
    }
    if (outcome.kind === "ok") {
      const attemptedAtMs = deps.now();
      const snapshot: Snapshot = {
        takenAtMs: attemptedAtMs,
        takenAt: new Date(attemptedAtMs).toISOString(),
        rows: outcome.rows,
        truncated: outcome.truncated,
      };
      memory = {
        key,
        catalog: outcome.catalog,
        snapshot,
        attemptedAtMs,
        error: null,
      };
      return view(memory, attemptedAtMs);
    }
    return rememberError(deps, key, outcome.detail);
  }
}

function rememberError(deps: LiveCallDeps, key: string, detail: string): LiveCallPayload {
  const attemptedAtMs = deps.now();
  memory = {
    key,
    catalog: memory?.key === key ? (memory.catalog ?? null) : null,
    snapshot: memory?.key === key ? (memory.snapshot ?? null) : null,
    attemptedAtMs,
    error: detail,
  };
  return view(memory, attemptedAtMs);
}

type ReadOnce =
  | { kind: "ok"; catalog: Catalog; rows: LiveCallRow[]; truncated: boolean }
  | { kind: "retry" }
  | { kind: "error"; detail: string };

async function readOnce(deps: LiveCallDeps, catalog: Catalog | null): Promise<ReadOnce> {
  const ready = catalog ?? (await loadCatalog(deps));
  if ("detail" in ready) {
    return ready.unknown ? { kind: "retry" } : { kind: "error", detail: ready.detail };
  }
  const selected = await Promise.all([
    selectTable(deps, ready, ready.pcommId, Object.values(ready.pcomm).map((column) => column.name)),
    selectTable(deps, ready, ready.puprId, Object.values(ready.pupr).map((column) => column.name)),
  ]);
  const pcomm = selected[0];
  const pupr = selected[1];
  if (!pcomm || !pupr) return { kind: "error", detail: "Не удалось прочитать текущие вызовы." };
  if (!pcomm.ok || !pupr.ok) {
    const failed = !pcomm.ok ? pcomm : pupr;
    if (!failed.ok && failed.unknown) return { kind: "retry" };
    return {
      kind: "error",
      detail: failed.ok ? "Не удалось прочитать текущие вызовы." : failed.detail,
    };
  }
  const rows = joinLiveCalls(
    pcomm.rows.map((row) => sideFrom(row, ready.pcomm)),
    pupr.rows.map((row) => sideFrom(row, ready.pupr)),
  ).map((row, index) => ({
    key: `${row.conferenceId || "none"}:${index}`,
    state: row.state,
    startedAt: row.startedAt,
    connectedAt: row.connectedAt,
    duration: row.duration,
    outA: row.outA,
    outB: row.outB,
    sourceName: row.sourceName,
    sourceSignal: row.sourceSignal,
    destName: row.destName,
    destSignal: row.destSignal,
    dialpeer: row.dialpeer,
  }));
  return {
    kind: "ok",
    catalog: ready,
    rows,
    truncated: pcomm.truncated || pupr.truncated,
  };
}

function view(state: Memory, now: number): LiveCallPayload {
  const refreshInMs = Math.max(0, REFRESH_MS - (now - state.attemptedAtMs));
  return {
    rows: state.snapshot?.rows ?? null,
    takenAt: state.snapshot?.takenAt ?? null,
    refreshInMs,
    truncated: state.snapshot?.truncated ?? false,
    error: state.error,
  };
}

async function loadCatalog(
  deps: LiveCallDeps,
): Promise<Catalog | { detail: string; unknown: boolean }> {
  const wsdl = await rtuExchange({
    url: `${deps.account.origin}/service/?wsdl_v2`,
    method: "GET",
    headers: { Accept: "text/xml, application/xml" },
    timeoutMs: WSDL_TIMEOUT_MS,
    caPem: deps.account.caPem,
    fetchImpl: deps.fetchImpl,
  });
  if (!wsdl.ok) return { detail: wsdl.detail, unknown: false };
  if (wsdl.status >= 300 && wsdl.status < 400) {
    return { detail: "WSDL ответил редиректом. Пароль не отправлен.", unknown: false };
  }
  if (wsdl.status < 200 || wsdl.status >= 300) {
    return { detail: "WSDL не получен.", unknown: false };
  }
  const objectsPlan = readWsdl(wsdl.text, deps.account.origin);
  const readsPlan = readCallReads(wsdl.text, deps.account.origin);
  if (!objectsPlan.ok || !readsPlan.ok || objectsPlan.endpoint !== readsPlan.endpoint) {
    const reason = !objectsPlan.ok ? objectsPlan.reason : !readsPlan.ok ? readsPlan.reason : "host";
    return {
      detail:
        reason === "host"
          ? "WSDL указывает другой адрес. Пароль не отправлен."
          : "Схема чтения вызовов в WSDL не разобрана.",
      unknown: false,
    };
  }

  const listed = await postRead(
    deps,
    objectsPlan.endpoint,
    objectsPlan.binding.soapAction,
    buildGetObjectsEnvelope(objectsPlan.binding, deps.account.login, deps.account.password),
  );
  if (!listed.ok) return { detail: listed.detail, unknown: listed.unknown };
  const objects = interpretGetObjects(listed.text, deps.account.password);
  if (objects.kind === "fault") return faultResult(objects.detail);
  if (objects.kind !== "objects") return { detail: "Ответ getObjects не разобран.", unknown: false };
  const pcomm = findTransitTable(objects.objects, PCOMM_TABLE);
  const pupr = findTransitTable(objects.objects, PUPR_TABLE);
  if (!pcomm.ok || !pupr.ok) {
    return { detail: catalogMiss(objects.objects, pcomm, pupr), unknown: false };
  }
  if (!isRtuObjectId(pcomm.objectId) || !isRtuObjectId(pupr.objectId)) {
    return { detail: "Идентификатор таблицы РТУ не подходит для чтения.", unknown: false };
  }

  const described = await Promise.all([
    describe(deps, readsPlan.endpoint, readsPlan.describeTable, pcomm.objectId),
    describe(deps, readsPlan.endpoint, readsPlan.describeTable, pupr.objectId),
  ]);
  const pcommColumns = described[0];
  const puprColumns = described[1];
  if (!pcommColumns?.ok || !puprColumns?.ok) {
    const failed = pcommColumns && !pcommColumns.ok ? pcommColumns : puprColumns;
    if (failed && !failed.ok && failed.unknown) return { detail: failed.detail, unknown: true };
    return {
      detail: failed && !failed.ok ? failed.detail : "Не удалось прочитать описание таблиц.",
      unknown: false,
    };
  }
  const pcommMap = mapColumns(pcommColumns.columns, PCOMM_FIELDS, PCOMM_TABLE);
  const puprMap = mapColumns(puprColumns.columns, PUPR_FIELDS, PUPR_TABLE);
  if (!pcommMap.ok) return { detail: pcommMap.detail, unknown: false };
  if (!puprMap.ok) return { detail: puprMap.detail, unknown: false };
  const names = [
    ...Object.values(pcommMap.columns),
    ...Object.values(puprMap.columns),
  ].map((column) => column.name);
  if (names.some((name) => !isRtuColumnName(name))) {
    return { detail: "Колонка РТУ имеет неподдерживаемое имя.", unknown: false };
  }
  return {
    endpoint: readsPlan.endpoint,
    getObjects: objectsPlan.binding,
    describeTable: readsPlan.describeTable,
    selectRowset: readsPlan.selectRowset,
    pcommId: pcomm.objectId,
    puprId: pupr.objectId,
    pcomm: pcommMap.columns,
    pupr: puprMap.columns,
  };
}

async function describe(
  deps: LiveCallDeps,
  endpoint: string,
  binding: CallBinding,
  objectId: string,
): Promise<{ ok: true; columns: SoapColumn[] } | { ok: false; detail: string; unknown: boolean }> {
  let envelope: string;
  try {
    envelope = buildDescribeTableEnvelope(binding, deps.account.login, deps.account.password, objectId);
  } catch {
    return { ok: false, detail: "Идентификатор таблицы РТУ не подходит для чтения.", unknown: false };
  }
  const posted = await postRead(deps, endpoint, binding.soapAction, envelope);
  if (!posted.ok) return { ok: false, detail: posted.detail, unknown: posted.unknown };
  const parsed = interpretDescribeTable(posted.text, deps.account.password);
  if (parsed.kind === "fault") return { ok: false, ...faultResult(parsed.detail) };
  if (parsed.kind !== "columns") {
    return { ok: false, detail: "Ответ describeTable не разобран.", unknown: false };
  }
  return { ok: true, columns: parsed.columns };
}

async function selectTable(
  deps: LiveCallDeps,
  catalog: Catalog,
  objectId: string,
  columns: string[],
): Promise<
  { ok: true; rows: Array<Record<string, string>>; truncated: boolean } | { ok: false; detail: string; unknown: boolean }
> {
  const unique = [...new Set(columns)];
  let envelope: string;
  try {
    envelope = buildSelectRowsetEnvelope(
      catalog.selectRowset,
      deps.account.login,
      deps.account.password,
      objectId,
      unique,
    );
  } catch {
    return { ok: false, detail: "Колонка РТУ имеет неподдерживаемое имя.", unknown: false };
  }
  const posted = await postRead(deps, catalog.endpoint, catalog.selectRowset.soapAction, envelope);
  if (!posted.ok) return { ok: false, detail: posted.detail, unknown: posted.unknown };
  const parsed = interpretSelectRowset(posted.text, deps.account.password);
  if (parsed.kind === "fault") return { ok: false, ...faultResult(parsed.detail) };
  if (parsed.kind !== "rows") {
    return { ok: false, detail: "Ответ selectRowset не разобран.", unknown: false };
  }
  return { ok: true, rows: parsed.rows, truncated: parsed.rows.length >= SELECT_ROW_LIMIT };
}

function sideFrom(
  row: Record<string, string>,
  columns: PcommMap | PuprMap,
): CallSide {
  const conference = columns.conferenceId;
  const conferenceId = (row[conference.name] ?? "").trim();
  const values: CallSide["values"] = {};
  for (const key of Object.keys(columns) as Array<PcommField | PuprField>) {
    if (key === "conferenceId") continue;
    const column = (columns as Record<string, MappedColumn | undefined>)[key];
    if (!column) continue;
    const raw = row[column.name] ?? "";
    values[key as LiveCallColumnKey] = presentSwitchValue(raw, column.dataMask);
  }
  return { conferenceId, values };
}

async function postRead(
  deps: LiveCallDeps,
  endpoint: string,
  soapAction: string,
  envelope: string,
): Promise<{ ok: true; text: string } | { ok: false; detail: string; unknown: boolean }> {
  const posted = await rtuExchange({
    url: endpoint,
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: quoteSoapAction(soapAction),
    },
    body: envelope,
    timeoutMs: CALL_TIMEOUT_MS,
    caPem: deps.account.caPem,
    fetchImpl: deps.fetchImpl,
  });
  if (!posted.ok) return { ok: false, detail: posted.detail, unknown: false };
  if (posted.status >= 300 && posted.status < 400) {
    return { ok: false, detail: "Сервис ответил редиректом.", unknown: false };
  }
  if (posted.status < 200 || posted.status >= 300) {
    return { ok: false, detail: "Коммутатор ответил ошибкой HTTP.", unknown: false };
  }
  return { ok: true, text: posted.text };
}

function catalogMiss(
  objects: readonly { type: string }[],
  pcomm: { ok: boolean; reason?: "none" | "many" },
  pupr: { ok: boolean; reason?: "none" | "many" },
): string {
  const tables = objects.filter((item) => item.type === "table").length;
  if (tables === 0) return "Каталог РТУ не содержит таблиц.";
  const many: string[] = [];
  const none: string[] = [];
  if (!pcomm.ok) (pcomm.reason === "many" ? many : none).push(PCOMM_TABLE);
  if (!pupr.ok) (pupr.reason === "many" ? many : none).push(PUPR_TABLE);
  const parts: string[] = [];
  if (many.length > 0) parts.push(`несколько страниц «${many.join("», «")}»`);
  if (none.length > 0) parts.push(`нет страницы «${none.join("», «")}»`);
  return `Каталог РТУ: ${parts.join("; ")}. Сводные таблицы не выбраны.`;
}

function faultResult(detail: string): { detail: string; unknown: boolean } {
  const text = detail.trim() || "Коммутатор вернул отказ.";
  return { detail: text, unknown: UNKNOWN_OBJECT.test(text) };
}
