/**
 * One JSON object per file row. Phone and the eight labels travel together
 * so a short array cannot attach a label to the next number.
 */

import type { MarkingParsedRow } from "@/modules/marking/parse-xlsx";

export const MARKING_SCREEN_ERROR = "Снимок «Управление РТУ» ещё не собран";
export const MARKING_SET_ERROR = "Файл не совпадает с номерами раздела";
export const MARKING_DUPLICATE_ERROR = "Повтор номера. Снимок не изменён.";
export const MARKING_LOCK_ERROR = "Снимок «Управление РТУ» обновляется. Повторите.";
export const MARKING_READ_ERROR = "Не удалось прочитать набор. Повторите.";

const SAMPLE_LIMIT = 30;

export type MarkingImportField = {
  phone: string;
  labelMts: string | null;
  labelMegafon: string | null;
  labelBeeline: string | null;
  labelT2: string | null;
  mavMts: string | null;
  mavMegafon: string | null;
  mavBeeline: string | null;
  mavT2: string | null;
};

export function markingImportPayload(rows: readonly MarkingParsedRow[]): string {
  const fields: MarkingImportField[] = rows.map((row) => ({
    phone: row.phoneNumber,
    labelMts: row.labelMts,
    labelMegafon: row.labelMegafon,
    labelBeeline: row.labelBeeline,
    labelT2: row.labelT2,
    mavMts: row.mavMts,
    mavMegafon: row.mavMegafon,
    mavBeeline: row.mavBeeline,
    mavT2: row.mavT2,
  }));
  return JSON.stringify(fields);
}

export type MarkingSetStats = {
  workingN: number;
  incomingN: number;
  incomingDistinct: number;
  matched: number;
  missing: readonly string[];
  unknown: readonly string[];
};

/** Messages for a refused import. Counts come from the same snapshot as the samples. */
export function markingSetDetails(stats: MarkingSetStats): string[] {
  if (stats.incomingDistinct !== stats.incomingN) {
    return [MARKING_DUPLICATE_ERROR];
  }
  const missingN = stats.workingN - stats.matched;
  const unknownN = stats.incomingN - stats.matched;
  const details = [`Не хватает в файле: ${missingN}. Нет в разделе: ${unknownN}.`];
  const missing = stats.missing.slice(0, SAMPLE_LIMIT);
  const unknown = stats.unknown.slice(0, SAMPLE_LIMIT);
  for (const phone of missing) {
    details.push(`Номер ${phone} есть в разделе и отсутствует в файле`);
  }
  if (missingN > missing.length) {
    details.push(`И ещё ${missingN - missing.length} номеров нет в файле`);
  }
  for (const phone of unknown) {
    details.push(`Номер ${phone} есть в файле и отсутствует в разделе`);
  }
  if (unknownN > unknown.length) {
    details.push(`И ещё ${unknownN - unknown.length} номеров нет в разделе`);
  }
  return details;
}
