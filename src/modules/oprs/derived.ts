/**
 * «Сеть», «Маркировка», and «МАВ» for one OPRS row.
 * The brand word follows the stamped color. The two cells are the matching
 * pair on the marking screen for the exact trimmed A-number. A number that
 * is not on that screen stays blank. A label-read failure leaves the brand
 * and clears both cells.
 */

import { chunkArray, DB_IN_CHUNK } from "@/lib/chunk";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  markingLabelsForPhonesSql,
  type MarkingPhoneLabelRow,
} from "@/modules/marking/sql";
import { loadOprsOperatorToneMap } from "@/modules/oprs/operator-tone-load";
import {
  OPRS_TONE_FIELD,
  oprsOperatorTone,
  type OprsOperatorTone,
  type OprsOperatorToneMap,
} from "@/modules/oprs/operator-tone";
import {
  OPRS_MARKING_COLUMN,
  OPRS_MAV_COLUMN,
  OPRS_NETWORK_COLUMN,
} from "@/modules/traffic/columns";

const NETWORK_LABEL: Record<OprsOperatorTone, string> = {
  red: "МТС",
  green: "Мегафон",
  yellow: "Билайн",
  gray: "Т2",
};

export type OprsCatalogLabels = {
  labelMts: string;
  labelMegafon: string;
  labelBeeline: string;
  labelT2: string;
  mavMts: string;
  mavMegafon: string;
  mavBeeline: string;
  mavT2: string;
};

export function oprsNetworkLabel(tone: OprsOperatorTone | null): string {
  return tone ? NETWORK_LABEL[tone] : "";
}

export function oprsCatalogCells(
  network: string,
  cells: OprsCatalogLabels | undefined,
): { marking: string; mav: string } {
  if (!cells) return { marking: "", mav: "" };
  switch (network) {
    case "МТС":
      return { marking: cells.labelMts, mav: cells.mavMts };
    case "Мегафон":
      return { marking: cells.labelMegafon, mav: cells.mavMegafon };
    case "Билайн":
      return { marking: cells.labelBeeline, mav: cells.mavBeeline };
    case "Т2":
      return { marking: cells.labelT2, mav: cells.mavT2 };
    default:
      return { marking: "", mav: "" };
  }
}

export function stampOprsRow(
  data: Record<string, string>,
  input: {
    blocked: boolean;
    tones: OprsOperatorToneMap;
    labels: ReadonlyMap<string, OprsCatalogLabels>;
  },
): void {
  const tone = input.blocked
    ? null
    : oprsOperatorTone(data.operator_b ?? "", input.tones);
  const network = oprsNetworkLabel(tone);
  const phone = (data.bill_ani ?? "").trim();
  const picked = oprsCatalogCells(
    network,
    network && phone ? input.labels.get(phone) : undefined,
  );
  data[OPRS_TONE_FIELD] = tone ?? "";
  data[OPRS_NETWORK_COLUMN] = network;
  data[OPRS_MARKING_COLUMN] = picked.marking;
  data[OPRS_MAV_COLUMN] = picked.mav;
}

function labelsFromRow(row: MarkingPhoneLabelRow): OprsCatalogLabels {
  return {
    labelMts: row.label_mts,
    labelMegafon: row.label_megafon,
    labelBeeline: row.label_beeline,
    labelT2: row.label_t2,
    mavMts: row.mav_mts,
    mavMegafon: row.mav_megafon,
    mavBeeline: row.mav_beeline,
    mavT2: row.mav_t2,
  };
}

async function readMarkingLabels(
  phones: readonly string[],
): Promise<Map<string, OprsCatalogLabels>> {
  const labels = new Map<string, OprsCatalogLabels>();
  for (const chunk of chunkArray(phones, DB_IN_CHUNK)) {
    const rows = await prisma.$queryRaw<MarkingPhoneLabelRow[]>(
      markingLabelsForPhonesSql(chunk),
    );
    for (const row of rows) labels.set(row.number, labelsFromRow(row));
  }
  return labels;
}

export async function attachOprsDerived(
  items: readonly { blocked?: boolean; data: Record<string, string> }[],
): Promise<void> {
  if (items.length === 0) return;
  const tones = await loadOprsOperatorToneMap();
  const phones = new Set<string>();
  for (const item of items) {
    if (item.blocked) continue;
    const tone = oprsOperatorTone(item.data.operator_b ?? "", tones);
    if (!tone) continue;
    const phone = (item.data.bill_ani ?? "").trim();
    if (phone) phones.add(phone);
  }
  let labels = new Map<string, OprsCatalogLabels>();
  if (phones.size > 0) {
    try {
      labels = await readMarkingLabels([...phones]);
    } catch (error: unknown) {
      logger.warn("oprs.marking.unavailable", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  for (const item of items) {
    stampOprsRow(item.data, { blocked: item.blocked === true, tones, labels });
  }
}
