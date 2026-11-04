import {
  TALK_SECONDS_TITLE,
  normalizeRtuLabel,
  type PcommField,
  type PuprField,
} from "@/modules/live-calls/columns";
import { isRtuColumnName } from "@/modules/rtu-soap/envelope";
import type { SoapColumn } from "@/modules/rtu-soap/response";

const MONITOR = "Мониторинг ПКомм";
const PER_MODULE = "Данные по модулям";

/** Path leaf of the per-module page that carries the ПКомм call fields. */
export const PCOMM_TEMPLATE_LEAF = "Конференции Class 4";
/** Path leaf of the per-module page that carries the ПУпр call fields. */
export const PUPR_TEMPLATE_LEAF = "Вызовы";
/** Summary page whose «Модуль» column names the running modules. */
export const ACTIVE_MODULES_TITLE = "Активные модули";
export const ACTIVE_MODULES_PATH =
  "Подсистема коммутации;Мониторинг ПКомм;Активные модули";

export type CatalogObject = {
  objectId: string;
  title: string;
  path: string;
  type: string;
};

export function findTransitTable(
  objects: readonly CatalogObject[],
  title: string,
): { ok: true; objectId: string } | { ok: false; reason: "none" | "many" } {
  const want = normalizeRtuLabel(title);
  const titled = objects.filter(
    (item) => item.type === "table" && normalizeRtuLabel(item.title) === want,
  );
  const visible = titled.filter(
    (item) => !normalizeRtuLabel(item.path).includes(PER_MODULE),
  );
  const summary = visible.filter((item) =>
    normalizeRtuLabel(item.path).includes(MONITOR),
  );
  const pool =
    summary.length > 0
      ? summary
      : visible.filter((item) => normalizeRtuLabel(item.path) === "");
  return pickShallowest(pool);
}

/**
 * The shared per-module page: the folder segment is followed by an empty
 * module name and the leaf is the whole remainder of the path.
 * A path that already names a module is not this template.
 */
export function findTransitTemplate(
  objects: readonly CatalogObject[],
  title: string,
  leaf: string,
): { ok: true; objectId: string } | { ok: false; reason: "none" | "many" } {
  const want = normalizeRtuLabel(title);
  const wantLeaf = normalizeRtuLabel(leaf);
  const hits = objects.filter(
    (item) =>
      item.type === "table" &&
      normalizeRtuLabel(item.title) === want &&
      isEmptyModuleTemplate(item.path, wantLeaf),
  );
  if (hits.length !== 1)
    return { ok: false, reason: hits.length === 0 ? "none" : "many" };
  const hit = hits[0];
  if (!hit) return { ok: false, reason: "none" };
  return { ok: true, objectId: hit.objectId };
}

/** The one summary page «Активные модули», not a copy under a module folder. */
export function findActiveModules(
  objects: readonly CatalogObject[],
): { ok: true; objectId: string } | { ok: false; reason: "none" | "many" } {
  const title = normalizeRtuLabel(ACTIVE_MODULES_TITLE);
  const path = normalizeRtuLabel(ACTIVE_MODULES_PATH);
  const hits = objects.filter(
    (item) =>
      item.type === "table" &&
      normalizeRtuLabel(item.title) === title &&
      normalizeRtuLabel(item.path) === path,
  );
  if (hits.length !== 1)
    return { ok: false, reason: hits.length === 0 ? "none" : "many" };
  const hit = hits[0];
  if (!hit) return { ok: false, reason: "none" };
  return { ok: true, objectId: hit.objectId };
}

function isEmptyModuleTemplate(path: string, leaf: string): boolean {
  const parts = normalizeRtuLabel(path)
    .split(";")
    .map((part) => part.trim());
  const index = parts.indexOf(PER_MODULE);
  if (index < 0) return false;
  return (
    parts[index + 1] === "" && parts[index + 2] === leaf && index + 2 === parts.length - 1
  );
}

function pickShallowest(
  candidates: readonly CatalogObject[],
): { ok: true; objectId: string } | { ok: false; reason: "none" | "many" } {
  if (candidates.length === 0) return { ok: false, reason: "none" };
  let best = Number.POSITIVE_INFINITY;
  const shallow: CatalogObject[] = [];
  for (const item of candidates) {
    const depth = pathDepth(item.path);
    if (depth < best) {
      best = depth;
      shallow.length = 0;
      shallow.push(item);
    } else if (depth === best) {
      shallow.push(item);
    }
  }
  if (shallow.length === 1 && shallow[0])
    return { ok: true, objectId: shallow[0].objectId };
  return { ok: false, reason: "many" };
}

function pathDepth(path: string): number {
  const text = normalizeRtuLabel(path);
  if (!text) return 0;
  return text.split(";").filter((part) => part.length > 0).length;
}

export type MappedColumn = {
  name: string;
  dataMask: string | null;
  haveLookup: boolean;
};

export function mapColumns<Key extends string>(
  columns: readonly SoapColumn[],
  titles: Record<Key, string>,
  tableTitle: string,
): { ok: true; columns: Record<Key, MappedColumn> } | { ok: false; detail: string } {
  const mapped = {} as Record<Key, MappedColumn>;
  for (const key of Object.keys(titles) as Key[]) {
    const title = titles[key];
    if (!title)
      return { ok: false, detail: `В таблице «${tableTitle}» нет нужной колонки.` };
    const want = normalizeRtuLabel(title);
    const hits = columns.filter((column) => normalizeRtuLabel(column.title) === want);
    const column = hits[0];
    if (hits.length !== 1 || !column) {
      return {
        ok: false,
        detail: `В таблице «${tableTitle}» нет колонки «${title}».`,
      };
    }
    mapped[key] = {
      name: column.name,
      dataMask: column.dataMask,
      haveLookup: column.haveLookup,
    };
  }
  return { ok: true, columns: mapped };
}

export type PcommMap = Record<PcommField, MappedColumn>;
export type PuprMap = Record<PuprField, MappedColumn>;

export type TalkColumn = MappedColumn & { explicitSeconds: boolean };

/**
 * The first listed title that occurs once. No match, two matches, or a name
 * that cannot be sent: skip the column. The call round still succeeds.
 */
export function findTalkColumn(
  columns: readonly SoapColumn[],
  titles: readonly string[],
): TalkColumn | null {
  for (const title of titles) {
    const want = normalizeRtuLabel(title);
    const hits = columns.filter((column) => normalizeRtuLabel(column.title) === want);
    if (hits.length > 1) return null;
    const hit = hits[0];
    if (!hit) continue;
    if (!isRtuColumnName(hit.name)) return null;
    return {
      name: hit.name,
      dataMask: hit.dataMask,
      haveLookup: hit.haveLookup,
      explicitSeconds: want === normalizeRtuLabel(TALK_SECONDS_TITLE),
    };
  }
  return null;
}
