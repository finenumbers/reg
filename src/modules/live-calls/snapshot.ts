import {
  ACTIVE_MODULES_TITLE,
  findActiveModules,
  findTalkColumn,
  findTransitTable,
  findTransitTemplate,
  mapColumns,
  PCOMM_TEMPLATE_LEAF,
  PUPR_TEMPLATE_LEAF,
  type MappedColumn,
  type PcommMap,
  type PuprMap,
  type TalkColumn,
} from "@/modules/live-calls/catalog";
import {
  PCOMM_FIELDS,
  PCOMM_TABLE,
  PCOMM_TALK_TITLES,
  PUPR_FIELDS,
  PUPR_TABLE,
  PUPR_TALK_TITLES,
  type LiveCallColumnKey,
  type PcommField,
  type PuprField,
} from "@/modules/live-calls/columns";
import {
  liveCallSeconds,
  presentSwitchValue,
  presentTalkSeconds,
} from "@/modules/live-calls/format";
import { joinLiveCalls, type CallSide } from "@/modules/live-calls/join";
import { orderLiveCallsByStart } from "@/modules/live-calls/order";
import type { LiveCallTone } from "@/modules/live-calls/row-class";
import { applyLiveCallSides, liveCallPhoneKeys } from "@/modules/live-calls/sides";
import { presentCallState, stateLabelMap } from "@/modules/live-calls/state-label";
import { liveCallCategory, liveCallTone } from "@/modules/live-calls/tone";
import { selectCallModules } from "@/modules/live-calls/modules";
import {
  conferenceIdSet,
  decideNextPage,
  MAX_CALL_PAGES,
} from "@/modules/live-calls/pages";
import { rtuExchange } from "@/modules/rtu-soap/exchange";
import {
  SELECT_ROW_LIMIT,
  buildDescribeTableEnvelope,
  buildGetLookupEnvelope,
  buildGetObjectsEnvelope,
  buildSelectRowsetEnvelope,
  isRtuColumnName,
  isRtuObjectId,
  quoteSoapAction,
} from "@/modules/rtu-soap/envelope";
import {
  interpretDescribeTable,
  interpretGetLookup,
  interpretGetObjects,
  interpretSelectRowset,
  type SoapColumn,
} from "@/modules/rtu-soap/response";
import {
  readCallReads,
  readWsdl,
  type CallBinding,
  type GetObjectsBinding,
  type LookupBinding,
} from "@/modules/rtu-soap/wsdl";
import type { TariffAbcRate } from "@/modules/traffic/tariff-match";

const REFRESH_MS = 3000;
/** Re-read «Активные модули» on this interval. Call rows still refresh every poll. */
export const MODULE_NAMES_MS = 60_000;
const WSDL_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 12_000;
const MODULE_COLUMN = "Модуль";
const UNKNOWN_OBJECT = /unknown object|неизвестн|does not exist|не найден/i;

export type LiveCallAccount = {
  origin: string;
  login: string;
  password: string;
  caPem: string | null;
};

export type LiveCallRow = Record<LiveCallColumnKey, string> & {
  key: string;
  tone: LiveCallTone | null;
};

type PreparedRow = LiveCallRow & { switchSeconds: string | null };

export type LiveCallPayload = {
  rows: LiveCallRow[] | null;
  takenAt: string | null;
  refreshInMs: number;
  truncated: boolean;
  error: string | null;
};

export type LiveCallDescriptions = (phones: string[]) => Promise<Map<string, string>>;

export type LiveCallDeps = {
  now: () => number;
  account: LiveCallAccount;
  fetchImpl?: typeof fetch;
  descriptions: LiveCallDescriptions;
  /** Live tariff ABC rows. The snapshot calls this at most once a minute. */
  rates: () => Promise<readonly TariffAbcRate[]>;
  /** Live dial-exception list. An empty list is empty, not the seed. */
  exceptions: () => Promise<readonly string[]>;
};

type CatalogBase = {
  endpoint: string;
  getObjects: GetObjectsBinding;
  describeTable: CallBinding;
  selectRowset: CallBinding;
  getLookup: LookupBinding | null;
  pcommId: string;
  puprId: string;
  pcomm: PcommMap;
  pupr: PuprMap;
  pcommTalk: TalkColumn | null;
  puprTalk: TalkColumn | null;
};

type Catalog =
  | (CatalogBase & { source: "summary" })
  | (CatalogBase & { source: "modules"; modulesId: string; moduleColumn: MappedColumn });

type ModuleNames = {
  signaling: string[];
  scripting: string[];
  atMs: number;
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
  modules: ModuleNames | null;
  snapshot: Snapshot | null;
  attemptedAtMs: number;
  error: string | null;
};

type ClassList = {
  rates: readonly TariffAbcRate[];
  exceptions: readonly string[];
  atMs: number;
  loaded: true;
};

type StateLabelCache = {
  key: string;
  map: ReadonlyMap<string, string>;
  failed: boolean;
  atMs: number;
};

let memory: Memory | null = null;
let pending: Promise<LiveCallPayload> | null = null;
let classList: ClassList | null = null;
let stateLabels: StateLabelCache | null = null;
/** A duration column that faulted once stays out of later selects until restart. */
let omitTalk = false;

export function resetLiveCallMemory(): void {
  memory = null;
  pending = null;
  classList = null;
  stateLabels = null;
  omitTalk = false;
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
  if (memory && memory.key !== key) {
    memory = null;
    stateLabels = null;
    omitTalk = false;
  }
  const now = deps.now();
  if (memory && now - memory.attemptedAtMs < REFRESH_MS) {
    return view(memory, now);
  }

  let unknownRetried = false;
  for (;;) {
    const outcome = await readOnce(
      deps,
      memory?.catalog ?? null,
      memory?.modules ?? null,
    );
    if (outcome.kind === "retry") {
      if (!unknownRetried) {
        unknownRetried = true;
        if (memory) memory = { ...memory, catalog: null, modules: null };
        continue;
      }
      return rememberError(deps, key, "Объект таблицы РТУ не найден.");
    }
    if (outcome.kind === "ok") {
      const attemptedAtMs = deps.now();
      const snapshot: Snapshot = {
        takenAtMs: attemptedAtMs,
        takenAt: new Date(attemptedAtMs).toISOString(),
        rows: outcome.rows.map((row) => {
          const { switchSeconds, ...rest } = row;
          return {
            ...rest,
            seconds:
              switchSeconds !== null
                ? switchSeconds
                : liveCallSeconds(row.connectedAt, attemptedAtMs),
          };
        }),
        truncated: outcome.truncated,
      };
      memory = {
        key,
        catalog: outcome.catalog,
        modules: outcome.modules,
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
    modules: memory?.key === key ? (memory.modules ?? null) : null,
    snapshot: memory?.key === key ? (memory.snapshot ?? null) : null,
    attemptedAtMs,
    error: detail,
  };
  return view(memory, attemptedAtMs);
}

type ReadOnce =
  | {
      kind: "ok";
      catalog: Catalog;
      modules: ModuleNames | null;
      rows: PreparedRow[];
      truncated: boolean;
    }
  | { kind: "retry" }
  | { kind: "error"; detail: string };

async function readOnce(
  deps: LiveCallDeps,
  catalog: Catalog | null,
  modules: ModuleNames | null,
): Promise<ReadOnce> {
  const ready = catalog ?? (await loadCatalog(deps));
  if ("detail" in ready) {
    return ready.unknown ? { kind: "retry" } : { kind: "error", detail: ready.detail };
  }
  if (ready.source === "modules") return readModules(deps, ready, modules);
  const labelsPromise = loadStateLabels(deps, ready, deps.now());
  try {
    const gate: TalkGate = { omit: omitTalk };
    const selected = await Promise.all([
      selectAllPages(
        deps,
        ready,
        ready.pcommId,
        namesOf(ready.pcomm),
        ready.pcommTalk,
        ready.pcomm.conferenceId.name,
        gate,
      ),
      selectAllPages(
        deps,
        ready,
        ready.puprId,
        namesOf(ready.pupr),
        ready.puprTalk,
        ready.pupr.conferenceId.name,
        gate,
      ),
    ]);
    const pcomm = selected[0];
    const pupr = selected[1];
    if (!pcomm || !pupr)
      return { kind: "error", detail: "Не удалось прочитать текущие вызовы." };
    if (!pcomm.ok || !pupr.ok) {
      const failed = !pcomm.ok ? pcomm : pupr;
      if (!failed.ok && failed.unknown) return { kind: "retry" };
      return {
        kind: "error",
        detail: failed.ok ? "Не удалось прочитать текущие вызовы." : failed.detail,
      };
    }
    const labels = await labelsPromise;
    return {
      kind: "ok",
      catalog: ready,
      modules: null,
      rows: await finishRows(
        deps,
        joinedRows(ready, pcomm.rows, pupr.rows, pcomm.talkFlags, pupr.talkFlags),
        labels,
      ),
      truncated: pcomm.truncated || pupr.truncated,
    };
  } finally {
    await labelsPromise;
  }
}

async function readModules(
  deps: LiveCallDeps,
  ready: Extract<Catalog, { source: "modules" }>,
  cached: ModuleNames | null,
): Promise<ReadOnce> {
  const named = await resolveModules(deps, ready, cached);
  if (named.kind !== "ok") return named;
  const labelsPromise = loadStateLabels(deps, ready, deps.now());
  try {
    const gate: TalkGate = { omit: omitTalk };
    const pcommRows: Array<Record<string, string>> = [];
    const puprRows: Array<Record<string, string>> = [];
    const pcommFlags: boolean[] = [];
    const puprFlags: boolean[] = [];
    let truncated = false;
    for (const name of named.modules.signaling) {
      const selected = await selectAllPages(
        deps,
        ready,
        ready.pcommId,
        namesOf(ready.pcomm),
        ready.pcommTalk,
        ready.pcomm.conferenceId.name,
        gate,
        name,
      );
      if (!selected.ok)
        return selected.unknown
          ? { kind: "retry" }
          : { kind: "error", detail: selected.detail };
      pcommRows.push(...selected.rows);
      pcommFlags.push(...selected.talkFlags);
      truncated = truncated || selected.truncated;
    }
    for (const name of named.modules.scripting) {
      const selected = await selectAllPages(
        deps,
        ready,
        ready.puprId,
        namesOf(ready.pupr),
        ready.puprTalk,
        ready.pupr.conferenceId.name,
        gate,
        name,
      );
      if (!selected.ok)
        return selected.unknown
          ? { kind: "retry" }
          : { kind: "error", detail: selected.detail };
      puprRows.push(...selected.rows);
      puprFlags.push(...selected.talkFlags);
      truncated = truncated || selected.truncated;
    }
    const labels = await labelsPromise;
    return {
      kind: "ok",
      catalog: ready,
      modules: named.modules,
      rows: await finishRows(
        deps,
        joinedRows(ready, pcommRows, puprRows, pcommFlags, puprFlags),
        labels,
      ),
      truncated,
    };
  } finally {
    await labelsPromise;
  }
}

async function resolveModules(
  deps: LiveCallDeps,
  ready: Extract<Catalog, { source: "modules" }>,
  cached: ModuleNames | null,
): Promise<
  | { kind: "ok"; modules: ModuleNames }
  | { kind: "retry" }
  | { kind: "error"; detail: string }
> {
  const now = deps.now();
  if (cached && now - cached.atMs < MODULE_NAMES_MS)
    return { kind: "ok", modules: cached };
  const selected = await selectTable(deps, ready, ready.modulesId, [
    ready.moduleColumn.name,
  ]);
  if (!selected.ok)
    return selected.unknown
      ? { kind: "retry" }
      : { kind: "error", detail: selected.detail };
  if (selected.truncated)
    return { kind: "error", detail: "Список активных модулей обрезан." };
  const chosen = selectCallModules(
    selected.rows.map((row) => row[ready.moduleColumn.name] ?? ""),
  );
  if (!chosen.ok) {
    return {
      kind: "error",
      detail:
        chosen.reason === "many"
          ? "Активных модулей signaling или scripting больше четырёх."
          : chosen.reason === "unexpected"
            ? "Модуль signaling или scripting назван не по шаблону."
            : "Среди активных модулей нет пары signaling и scripting.",
    };
  }
  return {
    kind: "ok",
    modules: { signaling: chosen.signaling, scripting: chosen.scripting, atMs: now },
  };
}

function namesOf(columns: PcommMap | PuprMap): string[] {
  return Object.values(columns).map((column) => column.name);
}

function joinedRows(
  ready: CatalogBase,
  pcommRows: Array<Record<string, string>>,
  puprRows: Array<Record<string, string>>,
  pcommTalk: readonly boolean[],
  puprTalk: readonly boolean[],
): PreparedRow[] {
  return orderLiveCallsByStart(
    joinLiveCalls(
      pcommRows.map((row, index) =>
        sideFrom(row, ready.pcomm, pcommTalk[index] ? ready.pcommTalk : null),
      ),
      puprRows.map((row, index) =>
        sideFrom(row, ready.pupr, puprTalk[index] ? ready.puprTalk : null),
      ),
    ),
  ).map((row, index) => ({
    key: `${row.conferenceId || "none"}:${index}`,
    category: "",
    state: row.state,
    startedAt: row.startedAt,
    connectedAt: row.connectedAt,
    outA: row.outA,
    sideA: row.sideA,
    outB: row.outB,
    sideB: row.sideB,
    seconds: row.seconds,
    sourceName: row.sourceName,
    destName: row.destName,
    dialpeer: row.dialpeer,
    sourceSignal: row.sourceSignal,
    destSignal: row.destSignal,
    tone: null,
    switchSeconds: row.switchSeconds,
  }));
}

async function withSides<T extends LiveCallRow>(
  deps: LiveCallDeps,
  rows: T[],
): Promise<{ rows: T[]; sidesReady: boolean }> {
  const phones = liveCallPhoneKeys(rows);
  if (phones.length === 0)
    return { rows: applyLiveCallSides(rows, new Map()), sidesReady: true };
  try {
    const descriptions = await deps.descriptions(phones);
    return { rows: applyLiveCallSides(rows, descriptions), sidesReady: true };
  } catch {
    return { rows: applyLiveCallSides(rows, new Map()), sidesReady: false };
  }
}

/**
 * Tariff and dial exceptions change rarely. A failed load keeps the previous
 * list and does not drop the calls. The first failure leaves outgoing parking
 * unpainted and is retried on the next snapshot.
 */
async function classificationLists(
  deps: LiveCallDeps,
  now: number,
): Promise<ClassList | { rates: readonly TariffAbcRate[]; exceptions: readonly string[]; loaded: false }> {
  if (classList && now - classList.atMs < MODULE_NAMES_MS) return classList;
  try {
    const [rates, exceptions] = await Promise.all([deps.rates(), deps.exceptions()]);
    classList = { rates, exceptions, atMs: now, loaded: true };
    return classList;
  } catch {
    if (classList) return classList;
    return { rates: [], exceptions: [], loaded: false };
  }
}

async function finishRows(
  deps: LiveCallDeps,
  rows: PreparedRow[],
  labels: ReadonlyMap<string, string> | null,
): Promise<PreparedRow[]> {
  if (rows.length === 0) return [];
  const [sided, lists] = await Promise.all([
    withSides(deps, rows),
    classificationLists(deps, deps.now()),
  ]);
  return sided.rows.map((row) => ({
    ...row,
    category: liveCallCategory(
      row,
      lists.rates,
      lists.exceptions,
      sided.sidesReady,
      lists.loaded,
    ),
    state: presentCallState(row.state, labels),
    tone: liveCallTone(row, lists.rates, lists.exceptions, sided.sidesReady),
  }));
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
    const reason = !objectsPlan.ok
      ? objectsPlan.reason
      : !readsPlan.ok
        ? readsPlan.reason
        : "host";
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
    buildGetObjectsEnvelope(
      objectsPlan.binding,
      deps.account.login,
      deps.account.password,
    ),
  );
  if (!listed.ok) return { detail: listed.detail, unknown: listed.unknown };
  const objects = interpretGetObjects(listed.text, deps.account.password);
  if (objects.kind === "fault") return faultResult(objects.detail);
  if (objects.kind !== "objects")
    return { detail: "Ответ getObjects не разобран.", unknown: false };
  const pcomm = findTransitTable(objects.objects, PCOMM_TABLE);
  const pupr = findTransitTable(objects.objects, PUPR_TABLE);
  if (pcomm.ok && pupr.ok) {
    if (!isRtuObjectId(pcomm.objectId) || !isRtuObjectId(pupr.objectId)) {
      return {
        detail: "Идентификатор таблицы РТУ не подходит для чтения.",
        unknown: false,
      };
    }
    const described = await Promise.all([
      describe(deps, readsPlan.endpoint, readsPlan.describeTable, pcomm.objectId),
      describe(deps, readsPlan.endpoint, readsPlan.describeTable, pupr.objectId),
    ]);
    const mapped = mapCallColumns(described[0], described[1]);
    if (!mapped.ok) return { detail: mapped.detail, unknown: mapped.unknown };
    return {
      source: "summary",
      endpoint: readsPlan.endpoint,
      getObjects: objectsPlan.binding,
      describeTable: readsPlan.describeTable,
      selectRowset: readsPlan.selectRowset,
      getLookup: readsPlan.getLookup,
      pcommId: pcomm.objectId,
      puprId: pupr.objectId,
      pcomm: mapped.pcomm,
      pupr: mapped.pupr,
      pcommTalk: mapped.pcommTalk,
      puprTalk: mapped.puprTalk,
    };
  }
  if (pcomm.ok || pupr.ok || pcomm.reason === "many" || pupr.reason === "many") {
    return { detail: catalogMiss(objects.objects, pcomm, pupr), unknown: false };
  }
  return loadModuleCatalog(deps, objects.objects, objectsPlan.binding, readsPlan);
}

async function loadModuleCatalog(
  deps: LiveCallDeps,
  objects: readonly { objectId: string; title: string; path: string; type: string }[],
  getObjects: GetObjectsBinding,
  readsPlan: {
    endpoint: string;
    describeTable: CallBinding;
    selectRowset: CallBinding;
    getLookup: LookupBinding | null;
  },
): Promise<Catalog | { detail: string; unknown: boolean }> {
  const pcomm = findTransitTemplate(objects, PCOMM_TABLE, PCOMM_TEMPLATE_LEAF);
  const pupr = findTransitTemplate(objects, PUPR_TABLE, PUPR_TEMPLATE_LEAF);
  if (!pcomm.ok || !pupr.ok) {
    return { detail: catalogMiss(objects, pcomm, pupr), unknown: false };
  }
  const modules = findActiveModules(objects);
  if (!modules.ok) {
    return {
      detail:
        modules.reason === "many"
          ? `Каталог РТУ: несколько страниц «${ACTIVE_MODULES_TITLE}».`
          : `Каталог РТУ: нет страницы «${ACTIVE_MODULES_TITLE}».`,
      unknown: false,
    };
  }
  if (
    !isRtuObjectId(pcomm.objectId) ||
    !isRtuObjectId(pupr.objectId) ||
    !isRtuObjectId(modules.objectId)
  ) {
    return {
      detail: "Идентификатор таблицы РТУ не подходит для чтения.",
      unknown: false,
    };
  }
  const pcommColumns = await describe(
    deps,
    readsPlan.endpoint,
    readsPlan.describeTable,
    pcomm.objectId,
  );
  if (!pcommColumns.ok)
    return { detail: pcommColumns.detail, unknown: pcommColumns.unknown };
  const puprColumns = await describe(
    deps,
    readsPlan.endpoint,
    readsPlan.describeTable,
    pupr.objectId,
  );
  if (!puprColumns.ok)
    return { detail: puprColumns.detail, unknown: puprColumns.unknown };
  const moduleColumns = await describe(
    deps,
    readsPlan.endpoint,
    readsPlan.describeTable,
    modules.objectId,
  );
  if (!moduleColumns.ok)
    return { detail: moduleColumns.detail, unknown: moduleColumns.unknown };
  const mapped = mapCallColumns(pcommColumns, puprColumns);
  if (!mapped.ok) return { detail: mapped.detail, unknown: mapped.unknown };
  const moduleMap = mapColumns(
    moduleColumns.columns,
    { module: MODULE_COLUMN },
    ACTIVE_MODULES_TITLE,
  );
  if (!moduleMap.ok) return { detail: moduleMap.detail, unknown: false };
  const names = [
    ...Object.values(mapped.pcomm),
    ...Object.values(mapped.pupr),
    moduleMap.columns.module,
  ].map((column) => column.name);
  if (names.some((name) => !isRtuColumnName(name))) {
    return { detail: "Колонка РТУ имеет неподдерживаемое имя.", unknown: false };
  }
  return {
    source: "modules",
    endpoint: readsPlan.endpoint,
    getObjects,
    describeTable: readsPlan.describeTable,
    selectRowset: readsPlan.selectRowset,
    getLookup: readsPlan.getLookup,
    pcommId: pcomm.objectId,
    puprId: pupr.objectId,
    pcomm: mapped.pcomm,
    pupr: mapped.pupr,
    pcommTalk: mapped.pcommTalk,
    puprTalk: mapped.puprTalk,
    modulesId: modules.objectId,
    moduleColumn: moduleMap.columns.module,
  };
}

function mapCallColumns(
  pcommColumns:
    | { ok: true; columns: SoapColumn[] }
    | { ok: false; detail: string; unknown: boolean }
    | undefined,
  puprColumns:
    | { ok: true; columns: SoapColumn[] }
    | { ok: false; detail: string; unknown: boolean }
    | undefined,
):
  | {
      ok: true;
      pcomm: PcommMap;
      pupr: PuprMap;
      pcommTalk: TalkColumn | null;
      puprTalk: TalkColumn | null;
    }
  | { ok: false; detail: string; unknown: boolean } {
  if (!pcommColumns?.ok || !puprColumns?.ok) {
    const failed = pcommColumns && !pcommColumns.ok ? pcommColumns : puprColumns;
    if (failed && !failed.ok && failed.unknown)
      return { ok: false, detail: failed.detail, unknown: true };
    return {
      ok: false,
      detail:
        failed && !failed.ok ? failed.detail : "Не удалось прочитать описание таблиц.",
      unknown: false,
    };
  }
  const pcommMap = mapColumns(pcommColumns.columns, PCOMM_FIELDS, PCOMM_TABLE);
  const puprMap = mapColumns(puprColumns.columns, PUPR_FIELDS, PUPR_TABLE);
  if (!pcommMap.ok) return { ok: false, detail: pcommMap.detail, unknown: false };
  if (!puprMap.ok) return { ok: false, detail: puprMap.detail, unknown: false };
  const names = [
    ...Object.values(pcommMap.columns),
    ...Object.values(puprMap.columns),
  ].map((column) => column.name);
  if (names.some((name) => !isRtuColumnName(name))) {
    return {
      ok: false,
      detail: "Колонка РТУ имеет неподдерживаемое имя.",
      unknown: false,
    };
  }
  return {
    ok: true,
    pcomm: pcommMap.columns,
    pupr: puprMap.columns,
    pcommTalk: findTalkColumn(pcommColumns.columns, PCOMM_TALK_TITLES),
    puprTalk: findTalkColumn(puprColumns.columns, PUPR_TALK_TITLES),
  };
}

async function describe(
  deps: LiveCallDeps,
  endpoint: string,
  binding: CallBinding,
  objectId: string,
): Promise<
  { ok: true; columns: SoapColumn[] } | { ok: false; detail: string; unknown: boolean }
> {
  let envelope: string;
  try {
    envelope = buildDescribeTableEnvelope(
      binding,
      deps.account.login,
      deps.account.password,
      objectId,
    );
  } catch {
    return {
      ok: false,
      detail: "Идентификатор таблицы РТУ не подходит для чтения.",
      unknown: false,
    };
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

type Selected =
  | { ok: true; rows: Array<Record<string, string>>; truncated: boolean }
  | { ok: false; detail: string; unknown: boolean; fault: boolean };

type Paged =
  | {
      ok: true;
      rows: Array<Record<string, string>>;
      truncated: boolean;
      talkFlags: boolean[];
    }
  | { ok: false; detail: string; unknown: boolean; fault: boolean };

type TalkGate = { omit: boolean };

function pageColumns(
  base: readonly string[],
  talk: TalkColumn | null,
  gate: TalkGate,
): string[] {
  if (gate.omit || !talk || base.includes(talk.name)) return [...base];
  return [...base, talk.name];
}

async function selectAllPages(
  deps: LiveCallDeps,
  catalog: Catalog,
  objectId: string,
  columns: string[],
  talk: TalkColumn | null,
  conferenceColumn: string,
  gate: TalkGate,
  moduleName?: string,
): Promise<Paged> {
  const rows: Array<Record<string, string>> = [];
  const talkFlags: boolean[] = [];
  let previousIds: Set<string> | null = null;
  for (let page = 0; page < MAX_CALL_PAGES; page += 1) {
    const requested = pageColumns(columns, talk, gate);
    const addedTalk = Boolean(
      talk && requested.includes(talk.name) && !columns.includes(talk.name),
    );
    let selected = await selectTable(
      deps,
      catalog,
      objectId,
      requested,
      moduleName,
      page * SELECT_ROW_LIMIT,
    );
    let pageWithTalk = addedTalk;
    if (!selected.ok && selected.fault && addedTalk) {
      const again = await selectTable(
        deps,
        catalog,
        objectId,
        columns,
        moduleName,
        page * SELECT_ROW_LIMIT,
      );
      if (!again.ok) return selected;
      gate.omit = true;
      omitTalk = true;
      selected = again;
      pageWithTalk = false;
    }
    if (!selected.ok) return selected;
    const pageIds = conferenceIdSet(selected.rows, conferenceColumn);
    const decision = decideNextPage({
      pageIndex: page,
      rowCount: selected.rows.length,
      pageIds,
      previousIds,
      pageSize: SELECT_ROW_LIMIT,
      maxPages: MAX_CALL_PAGES,
    });
    if (decision.append) {
      rows.push(...selected.rows);
      for (let index = 0; index < selected.rows.length; index += 1)
        talkFlags.push(pageWithTalk);
    }
    if (decision.action !== "continue") {
      return { ok: true, rows, truncated: decision.truncated, talkFlags };
    }
    previousIds = pageIds;
  }
  return { ok: true, rows, truncated: true, talkFlags };
}

async function selectTable(
  deps: LiveCallDeps,
  catalog: Catalog,
  objectId: string,
  columns: string[],
  moduleName?: string,
  offset = 0,
): Promise<Selected> {
  const unique = [...new Set(columns)];
  let envelope: string;
  try {
    envelope = buildSelectRowsetEnvelope(
      catalog.selectRowset,
      deps.account.login,
      deps.account.password,
      objectId,
      unique,
      moduleName,
      offset,
    );
  } catch {
    return {
      ok: false,
      detail: "Колонка РТУ имеет неподдерживаемое имя.",
      unknown: false,
      fault: false,
    };
  }
  const posted = await postRead(
    deps,
    catalog.endpoint,
    catalog.selectRowset.soapAction,
    envelope,
  );
  if (!posted.ok) {
    return { ok: false, detail: posted.detail, unknown: posted.unknown, fault: false };
  }
  const parsed = interpretSelectRowset(posted.text, deps.account.password);
  if (parsed.kind === "fault") {
    return { ok: false, ...faultResult(parsed.detail), fault: true };
  }
  if (parsed.kind !== "rows") {
    return {
      ok: false,
      detail: "Ответ selectRowset не разобран.",
      unknown: false,
      fault: false,
    };
  }
  return {
    ok: true,
    rows: parsed.rows,
    truncated: parsed.rows.length >= SELECT_ROW_LIMIT,
  };
}

function sideFrom(
  row: Record<string, string>,
  columns: PcommMap | PuprMap,
  talk: TalkColumn | null,
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
  return {
    conferenceId,
    values,
    talk: talk
      ? {
          text: presentTalkSeconds(row[talk.name] ?? ""),
          explicitSeconds: talk.explicitSeconds,
        }
      : null,
  };
}

/**
 * Interface strings for «Состояние вызова». A missing flag, a missing
 * binding, or a failed read leaves the raw key. A success, including an
 * empty list, stays until the catalog account changes. A failure retries
 * once a minute and does not fail the call snapshot.
 */
async function loadStateLabels(
  deps: LiveCallDeps,
  catalog: CatalogBase,
  now: number,
): Promise<ReadonlyMap<string, string> | null> {
  try {
    const column = catalog.pupr.state;
    if (!column.haveLookup || !catalog.getLookup) return null;
    if (!isRtuColumnName(column.name)) return null;
    const key = `${deps.account.origin}\n${deps.account.login}\n${catalog.puprId}\n${column.name}`;
    if (stateLabels && stateLabels.key === key && !stateLabels.failed) return stateLabels.map;
    if (
      stateLabels &&
      stateLabels.key === key &&
      stateLabels.failed &&
      now - stateLabels.atMs < MODULE_NAMES_MS
    ) {
      return null;
    }
    let map: Map<string, string> | null = null;
    try {
      map = await fetchStateLabels(deps, catalog, column.name);
    } catch {
      map = null;
    }
    stateLabels = {
      key,
      map: map ?? new Map(),
      failed: map === null,
      atMs: deps.now(),
    };
    return map;
  } catch {
    return null;
  }
}

async function fetchStateLabels(
  deps: LiveCallDeps,
  catalog: CatalogBase,
  columnName: string,
): Promise<Map<string, string> | null> {
  const binding = catalog.getLookup;
  if (!binding) return null;
  let envelope: string;
  try {
    envelope = buildGetLookupEnvelope(
      binding,
      deps.account.login,
      deps.account.password,
      catalog.puprId,
      columnName,
    );
  } catch {
    return null;
  }
  const posted = await postRead(
    deps,
    catalog.endpoint,
    binding.soapAction,
    envelope,
    WSDL_TIMEOUT_MS,
  );
  if (!posted.ok) return null;
  const parsed = interpretGetLookup(posted.text, deps.account.password);
  if (parsed.kind !== "lookup") return null;
  return stateLabelMap(parsed.pairs);
}

async function postRead(
  deps: LiveCallDeps,
  endpoint: string,
  soapAction: string,
  envelope: string,
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<{ ok: true; text: string } | { ok: false; detail: string; unknown: boolean }> {
  const posted = await rtuExchange({
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
