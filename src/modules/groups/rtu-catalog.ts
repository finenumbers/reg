/**
 * The RTU page «Входящие группы» under the folder «Оборудование».
 * The object id comes from getObjects. Titles are the interface names.
 */

import { normalizeRtuLabel } from "@/modules/live-calls/columns";
import type { ParsedRoutingGroup } from "@/modules/groups/parse";
import { isRtuObjectId } from "@/modules/rtu-soap/envelope";

export const INCOMING_GROUPS_TITLE = "Входящие группы";
export const INCOMING_GROUPS_FOLDER = "Оборудование";
export const INCOMING_GROUP_ID_TITLE = "ID";
export const INCOMING_GROUP_NAME_TITLE = "Название";

const PER_MODULE = "Данные по модулям";

export type IncomingGroupObject = {
  objectId: string;
  title: string;
  path: string;
  type: string;
};

export function findIncomingGroupsTable(
  objects: readonly IncomingGroupObject[],
): { ok: true; objectId: string } | { ok: false; detail: string } {
  const title = normalizeRtuLabel(INCOMING_GROUPS_TITLE);
  const folder = normalizeRtuLabel(INCOMING_GROUPS_FOLDER);
  const titled = objects.filter(
    (item) => item.type === "table" && normalizeRtuLabel(item.title) === title,
  );
  const hits = titled.filter((item) => {
    if (normalizeRtuLabel(item.path).includes(PER_MODULE)) return false;
    const parts = pathSegments(item.path);
    return parts.includes(folder) && parts[parts.length - 1] === title;
  });
  if (hits.length > 1) {
    return { ok: false, detail: `Несколько таблиц «${INCOMING_GROUPS_TITLE}».` };
  }
  const hit = hits[0];
  if (hit) {
    if (!isRtuObjectId(hit.objectId)) {
      return { ok: false, detail: "Идентификатор таблицы РТУ не подходит для чтения." };
    }
    return { ok: true, objectId: hit.objectId };
  }
  if (titled.length === 0) {
    return { ok: false, detail: `Таблица «${INCOMING_GROUPS_TITLE}» не найдена.` };
  }
  const paths = titled.slice(0, 4).map((item) => item.path.trim() || "пустой путь");
  const more = titled.length > 4 ? ` и ещё ${titled.length - 4}` : "";
  return {
    ok: false,
    detail: `Таблица «${INCOMING_GROUPS_TITLE}» не найдена: заголовков ${titled.length}, пути ${paths.join("; ")}${more}.`,
  };
}

function pathSegments(path: string): string[] {
  return normalizeRtuLabel(path)
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** A complete current list. An empty list is a complete list. */
export function acceptIncomingGroups(
  groups: readonly ParsedRoutingGroup[],
): { ok: true; groups: ParsedRoutingGroup[] } | { ok: false; detail: string } {
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const accepted: ParsedRoutingGroup[] = [];
  for (const group of groups) {
    const externalId = group.externalId.trim();
    const name = group.name.trim();
    if (!externalId) return { ok: false, detail: "Пустой ID." };
    if (!name) return { ok: false, detail: "Пустое название." };
    if (name.includes(";")) {
      return { ok: false, detail: `В названии «${name}» есть точка с запятой.` };
    }
    if (seenIds.has(externalId)) {
      return { ok: false, detail: `Повтор ID «${externalId}».` };
    }
    if (seenNames.has(name)) {
      return { ok: false, detail: `Повтор названия «${name}».` };
    }
    seenIds.add(externalId);
    seenNames.add(name);
    accepted.push({ externalId, name });
  }
  return { ok: true, groups: accepted };
}
