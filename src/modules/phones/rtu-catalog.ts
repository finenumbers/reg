/**
 * The RTU page «Оборудование» under the folder «Оборудование».
 * One table holds gateways and endpoints. The object id comes from getObjects.
 */

import { normalizeRtuLabel } from "@/modules/live-calls/columns";
import { isRtuObjectId } from "@/modules/rtu-soap/envelope";

export const EQUIPMENT_TITLE = "Оборудование";
export const EQUIPMENT_FOLDER = "Оборудование";

const PER_MODULE = "Данные по модулям";

export type EquipmentObject = {
  objectId: string;
  title: string;
  path: string;
  type: string;
};

export function findEquipmentTable(
  objects: readonly EquipmentObject[],
): { ok: true; objectId: string } | { ok: false; detail: string } {
  const title = normalizeRtuLabel(EQUIPMENT_TITLE);
  const folder = normalizeRtuLabel(EQUIPMENT_FOLDER);
  const titled = objects.filter(
    (item) => item.type === "table" && normalizeRtuLabel(item.title) === title,
  );
  const hits = titled.filter((item) => {
    if (normalizeRtuLabel(item.path).includes(PER_MODULE)) return false;
    const parts = pathSegments(item.path);
    return parts.includes(folder) && parts[parts.length - 1] === title;
  });
  if (hits.length > 1) {
    return { ok: false, detail: `Несколько таблиц «${EQUIPMENT_TITLE}».` };
  }
  const hit = hits[0];
  if (hit) {
    if (!isRtuObjectId(hit.objectId)) {
      return { ok: false, detail: "Идентификатор таблицы РТУ не подходит для чтения." };
    }
    return { ok: true, objectId: hit.objectId };
  }
  if (titled.length === 0) {
    return { ok: false, detail: `Таблица «${EQUIPMENT_TITLE}» не найдена.` };
  }
  const paths = titled.slice(0, 4).map((item) => item.path.trim() || "пустой путь");
  const more = titled.length > 4 ? ` и ещё ${titled.length - 4}` : "";
  return {
    ok: false,
    detail: `Таблица «${EQUIPMENT_TITLE}» не найдена: заголовков ${titled.length}, пути ${paths.join("; ")}${more}.`,
  };
}

function pathSegments(path: string): string[] {
  return normalizeRtuLabel(path)
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
