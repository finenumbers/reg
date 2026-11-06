import { CATEGORY_FIELD } from "@/modules/phones/category";
import type { EquipmentIdentity } from "@/modules/phones/rtu-rows";
import { SUPPLIER_FIELD } from "@/modules/phones/supplier";
import {
  STATUS_ACTIVE,
  STATUS_BLOCKED,
  STATUS_FIELD,
  type PhoneRowData,
} from "@/modules/phones/types";

const IGNORED = new Set<string>([STATUS_FIELD, SUPPLIER_FIELD, CATEGORY_FIELD]);

export type ActivationStatus = typeof STATUS_ACTIVE | typeof STATUS_BLOCKED;

/**
 * The second equipment read confirms the write.
 * Exactly one primary key may change «Запись активна», and only that row's status.
 */
export function confirmActivationDiff(input: {
  before: readonly EquipmentIdentity[];
  after: readonly EquipmentIdentity[];
  pk: string;
  fromWire: "0" | "1";
  toWire: "0" | "1";
  fromStatus: ActivationStatus;
  toStatus: ActivationStatus;
}): { ok: true } | { ok: false; detail: string } {
  const beforeMap = index(input.before);
  const afterMap = index(input.after);
  if (!beforeMap || !afterMap) {
    return {
      ok: false,
      detail:
        "Повторная загрузка увидела повтор ключа оборудования. Повторная запись не отправлена.",
    };
  }
  if (!sameKeys(beforeMap, afterMap)) {
    return {
      ok: false,
      detail:
        "Повторная загрузка увидела другой состав оборудования. Повторная запись не отправлена.",
    };
  }
  const beforeRow = beforeMap.get(input.pk);
  const afterRow = afterMap.get(input.pk);
  if (
    !beforeRow ||
    !afterRow ||
    beforeRow.kind !== "endpoint" ||
    afterRow.kind !== "endpoint"
  ) {
    return {
      ok: false,
      detail: "Повторная загрузка не нашла эту строку. Повторная запись не отправлена.",
    };
  }
  if (beforeRow.name !== afterRow.name || beforeRow.number !== afterRow.number) {
    return {
      ok: false,
      detail:
        "Повторная загрузка увидела другое название или номер этой строки. Повторная запись не отправлена.",
    };
  }
  if (
    beforeRow.rawActive !== input.fromWire ||
    beforeRow.activation !== input.fromStatus ||
    afterRow.rawActive !== input.toWire ||
    afterRow.activation !== input.toStatus
  ) {
    return {
      ok: false,
      detail:
        "Повторная загрузка не увидела смену статуса этой строки. Повторная запись не отправлена.",
    };
  }
  if (!sameEndpointFields(beforeRow.endpoint, afterRow.endpoint)) {
    return {
      ok: false,
      detail:
        "Повторная загрузка увидела изменение других полей этой строки. Повторная запись не отправлена.",
    };
  }
  for (const [pk, row] of beforeMap) {
    if (pk === input.pk) continue;
    const next = afterMap.get(pk);
    if (!next || next.rawActive !== row.rawActive) {
      return {
        ok: false,
        detail:
          "Повторная загрузка увидела смену «Запись активна» не только у этого номера. Повторная запись не отправлена.",
      };
    }
  }
  return { ok: true };
}

function index(
  rows: readonly EquipmentIdentity[],
): Map<string, EquipmentIdentity> | null {
  const map = new Map<string, EquipmentIdentity>();
  for (const row of rows) {
    if (!row.pk || map.has(row.pk)) return null;
    map.set(row.pk, row);
  }
  return map;
}

function sameKeys(
  before: Map<string, EquipmentIdentity>,
  after: Map<string, EquipmentIdentity>,
): boolean {
  if (before.size !== after.size) return false;
  for (const pk of before.keys()) {
    if (!after.has(pk)) return false;
  }
  return true;
}

function sameEndpointFields(
  before: PhoneRowData | null,
  after: PhoneRowData | null,
): boolean {
  if (!before || !after) return false;
  const keys = new Set<string>();
  for (const key of Object.keys(before)) {
    if (!IGNORED.has(key)) keys.add(key);
  }
  for (const key of Object.keys(after)) {
    if (!IGNORED.has(key)) keys.add(key);
  }
  for (const key of keys) {
    if ((before[key] ?? "") !== (after[key] ?? "")) return false;
  }
  return true;
}
