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
  const hits = objects.filter((item) => {
    if (item.type !== "table") return false;
    if (normalizeRtuLabel(item.title) !== want) return false;
    const path = normalizeRtuLabel(item.path);
    return path.includes(MONITOR) && !path.includes(PER_MODULE);
  });
  if (hits.length === 1 && hits[0]) return { ok: true, objectId: hits[0].objectId };
  return { ok: false, reason: hits.length === 0 ? "none" : "many" };
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
