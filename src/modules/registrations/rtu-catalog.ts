/**
 * Summary pages «Регистрации (ПКомм)» and «Регистрации (ПУпр)».
 * The object id comes from getObjects. Titles are the interface names.
 */

import { normalizeRtuLabel } from "@/modules/live-calls/columns";
import { isRtuObjectId } from "@/modules/rtu-soap/envelope";

export const PCOMM_REGISTRATIONS_TITLE = "Регистрации (ПКомм)";
export const PUPR_REGISTRATIONS_TITLE = "Регистрации (ПУпр)";
export const REGISTRATIONS_MONITOR = "Мониторинг ПКомм";
export const REGISTRATION_ID_TITLE = "ID регистрации";
export const REGISTRATION_NAME_TITLE = "Имя";
export const REGISTRATION_ALIASES_TITLE = "Алиасы";
export const REGISTRATION_ADDRESS_TITLE = "Адрес";
export const REGISTRATION_STATE_TITLE = "Состояние";
export const REGISTRATION_END_TITLE = "Время окончания регистрации";
export const REGISTRATION_AGENT_TITLE = "Агент пользователя";

const PER_MODULE = "Данные по модулям";
/** Per-module page leaf. The object title stays «Регистрации (ПКомм)» or «Регистрации (ПУпр)». */
const TEMPLATE_LEAF = "Регистрации";

export type RegistrationObject = {
  objectId: string;
  title: string;
  path: string;
  type: string;
};

export type RegistrationTableHit = {
  ok: true;
  objectId: string;
  source: "summary" | "template";
};

export function findRegistrationTable(
  objects: readonly RegistrationObject[],
  title: string,
): RegistrationTableHit | { ok: false; detail: string } {
  const want = normalizeRtuLabel(title);
  const monitor = normalizeRtuLabel(REGISTRATIONS_MONITOR);
  const titled = objects.filter(
    (item) => item.type === "table" && normalizeRtuLabel(item.title) === want,
  );
  const summary = titled.filter((item) => {
    if (normalizeRtuLabel(item.path).includes(PER_MODULE)) return false;
    const parts = pathSegments(item.path);
    return parts.includes(monitor) && parts[parts.length - 1] === want;
  });
  if (summary.length > 1) {
    return { ok: false, detail: `Несколько таблиц «${title}».` };
  }
  const summaryHit = summary[0];
  if (summaryHit) return accept(summaryHit, "summary");

  const templates = titled.filter((item) => isSharedRegistrationTemplate(item.path));
  if (templates.length > 1) {
    return { ok: false, detail: `Несколько таблиц «${title}».` };
  }
  const templateHit = templates[0];
  if (templateHit) return accept(templateHit, "template");
  if (titled.length === 0) {
    return { ok: false, detail: `Таблица «${title}» не найдена.` };
  }
  const paths = titled.slice(0, 4).map((item) => item.path.trim() || "пустой путь");
  const more = titled.length > 4 ? ` и ещё ${titled.length - 4}` : "";
  return {
    ok: false,
    detail: `Таблица «${title}» не найдена: заголовков ${titled.length}, пути ${paths.join("; ")}${more}.`,
  };
}

function accept(
  hit: RegistrationObject,
  source: "summary" | "template",
): RegistrationTableHit | { ok: false; detail: string } {
  if (!isRtuObjectId(hit.objectId)) {
    return { ok: false, detail: "Идентификатор таблицы РТУ не подходит для чтения." };
  }
  return { ok: true, objectId: hit.objectId, source };
}

function isSharedRegistrationTemplate(path: string): boolean {
  const parts = normalizeRtuLabel(path)
    .split(";")
    .map((part) => part.trim());
  const index = parts.indexOf(PER_MODULE);
  if (index < 0 || !parts.includes(normalizeRtuLabel(REGISTRATIONS_MONITOR))) return false;
  return (
    parts[index + 1] === "" &&
    parts[index + 2] === TEMPLATE_LEAF &&
    index + 2 === parts.length - 1
  );
}

function pathSegments(path: string): string[] {
  return normalizeRtuLabel(path)
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
