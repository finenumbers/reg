import {
  normalizeRtuLabel,
  type PcommField,
  type PuprField,
} from "@/modules/live-calls/columns";
import type { SoapColumn } from "@/modules/rtu-soap/response";

const MONITOR = "Мониторинг ПКомм";
const PER_MODULE = "Данные по модулям";

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
  const visible = titled.filter((item) => !normalizeRtuLabel(item.path).includes(PER_MODULE));
  const summary = visible.filter((item) => normalizeRtuLabel(item.path).includes(MONITOR));
  const pool = summary.length > 0 ? summary : visible.filter((item) => normalizeRtuLabel(item.path) === "");
  return pickShallowest(pool);
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
  if (shallow.length === 1 && shallow[0]) return { ok: true, objectId: shallow[0].objectId };
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
};

export function mapColumns<Key extends string>(
  columns: readonly SoapColumn[],
  titles: Record<Key, string>,
  tableTitle: string,
): { ok: true; columns: Record<Key, MappedColumn> } | { ok: false; detail: string } {
  const mapped = {} as Record<Key, MappedColumn>;
  for (const key of Object.keys(titles) as Key[]) {
    const title = titles[key];
    if (!title) return { ok: false, detail: `В таблице «${tableTitle}» нет нужной колонки.` };
    const want = normalizeRtuLabel(title);
    const hits = columns.filter((column) => normalizeRtuLabel(column.title) === want);
    const column = hits[0];
    if (hits.length !== 1 || !column) {
      return {
        ok: false,
        detail: `В таблице «${tableTitle}» нет колонки «${title}».`,
      };
    }
    mapped[key] = { name: column.name, dataMask: column.dataMask };
  }
  return { ok: true, columns: mapped };
}

export type PcommMap = Record<PcommField, MappedColumn>;
export type PuprMap = Record<PuprField, MappedColumn>;
