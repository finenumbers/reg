import { safeLabel } from "@/modules/vats/names";

export type NamedId = { id: string; name: string };

export const MSG_CREDENTIALS = "Укажите хост, логин и пароль в Настройках ВАТС.";
export const MSG_EMPTY = "Пустой ответ не заменил сохранённый список.";
export const MSG_TRUNCATED = "Ответ обрезан. Сохранённый список не изменён.";
export const MSG_NOT_LIST = "Платформа вернула не список имён.";
export const MSG_NOT_CATALOG = "Платформа вернула не список справочника.";
export const MSG_DOMAIN_LIMIT = "В списке больше 1000 доменов. Снимок не изменён.";
export const MSG_TELNUM_LIMIT = "В списке больше 5000 номеров. Снимок не изменён.";
export const MSG_BUDGET = "Чтение раздела не уложилось в 45 минут. Снимок не изменён.";
export const MSG_SOFT_MANY = "Не прочитано слишком много строк. Снимок не изменён.";
export const MSG_DIALPLANS = "Диал-планы не прочитаны. Домены не обновлены.";
export const MSG_GATEWAYS = "Шлюзы не прочитаны. Номера не обновлены.";
export const MSG_ROUTES = "Маршруты не прочитаны.";

export function msgSoft(count: number): string {
  return `Не прочитано строк: ${count}. Остальные обновлены.`;
}

export function clampNotice(text: string): string {
  const clean = text
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean || /authorization|bearer|basic /i.test(clean)) return "Ошибка загрузки.";
  return clean.length > 240 ? `${clean.slice(0, 240)}…` : clean;
}

export function keptNotice(error: string): string {
  const notice = clampNotice(error);
  if (notice.includes("Снимок не изменён")) return notice;
  return `${notice} Снимок не изменён.`;
}

export function showCell(value: string | null): string {
  if (!value) return "—";
  if (value.length > 300 || /[\u0000-\u001F\u007F]/.test(value)) return "—";
  return value;
}

export function formatSubscribers(count: number | null, limit: number | null): string {
  if (count == null || !Number.isInteger(count) || count < 0) return "—";
  if (limit == null || !Number.isInteger(limit)) return "—";
  if (limit === -1) return `${count} / без лимита`;
  if (limit < 0) return "—";
  return `${count} / ${limit}`;
}

export function formatYesNo(value: boolean | null): string {
  if (value == null) return "—";
  return value ? "Да" : "Нет";
}

/** Id wins when the same token is another row's name. */
export function resolveRef(token: string, catalog: NamedId[]): string | null {
  for (const item of catalog) {
    if (item.id === token) return item.name;
  }
  for (const item of catalog) {
    if (item.name === token) return item.name;
  }
  return null;
}

export function resolveRefs(tokens: string[], catalog: NamedId[]): string[] {
  const names: string[] = [];
  for (const token of tokens) {
    const name = resolveRef(token, catalog);
    if (name) names.push(name);
  }
  return names;
}

export function catalogNames(catalog: NamedId[]): string[] {
  return catalog.map((item) => item.name);
}

/**
 * Objects need a name. A name without an id is kept as its own id.
 * An id without a name is dropped. A plain string is both id and name.
 */
export function parseNamedCatalog(data: unknown): NamedId[] | null {
  if (!Array.isArray(data)) return null;
  const rows: NamedId[] = [];
  for (const item of data) {
    if (typeof item === "string") {
      const label = safeLabel(item);
      if (label) rows.push({ id: label, name: label });
      continue;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? safeLabel(record.name) : null;
    if (!name) continue;
    const id = typeof record.id === "string" ? safeLabel(record.id) : name;
    if (!id) continue;
    rows.push({ id, name });
  }
  return rows;
}

export function compareDomains(left: string, right: string): number {
  const byLocale = left.localeCompare(right, "ru");
  if (byLocale !== 0) return byLocale;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function compareTelnums(left: string, right: string): number {
  const a = BigInt(left);
  const b = BigInt(right);
  if (a < b) return -1;
  if (a > b) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function uniqueInOrder(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}
