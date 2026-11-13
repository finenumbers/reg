/**
 * One marking working set for an OPRS filter.
 * The same rows the screen paints, read outside the CDR transaction.
 * A failed read is an empty catalog: painted cells stay blank.
 */

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  markingWorkingCte,
  type MarkingPhoneLabelRow,
} from "@/modules/marking/sql";
import type { OprsCatalogLabels } from "@/modules/oprs/derived";

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

function hasText(cells: OprsCatalogLabels): boolean {
  return (
    cells.labelMts !== "" ||
    cells.labelMegafon !== "" ||
    cells.labelBeeline !== "" ||
    cells.labelT2 !== "" ||
    cells.mavMts !== "" ||
    cells.mavMegafon !== "" ||
    cells.mavBeeline !== "" ||
    cells.mavT2 !== ""
  );
}

export async function loadOprsMarkingSnapshot(): Promise<Map<string, OprsCatalogLabels>> {
  try {
    const rows = await prisma.$queryRaw<MarkingPhoneLabelRow[]>`
      WITH ${markingWorkingCte()}
      SELECT
        w.number,
        COALESCE(m."labelMts", '') AS label_mts,
        COALESCE(m."labelMegafon", '') AS label_megafon,
        COALESCE(m."labelBeeline", '') AS label_beeline,
        COALESCE(m."labelT2", '') AS label_t2,
        COALESCE(m."mavMts", '') AS mav_mts,
        COALESCE(m."mavMegafon", '') AS mav_megafon,
        COALESCE(m."mavBeeline", '') AS mav_beeline,
        COALESCE(m."mavT2", '') AS mav_t2
      FROM working w
      LEFT JOIN marking_rows m
        ON m."phoneNumber" = w.number
    `;
    const labels = new Map<string, OprsCatalogLabels>();
    for (const row of rows) {
      const cells = labelsFromRow(row);
      if (!row.number || !hasText(cells)) continue;
      labels.set(row.number, cells);
    }
    return labels;
  } catch (error: unknown) {
    logger.warn("oprs.marking.unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Map();
  }
}
