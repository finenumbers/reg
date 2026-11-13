/**
 * Walk the open OPRS snapshot into an xlsx. Keyset, no OFFSET, no PSTN lookup.
 */

import type { ColumnFilters } from "@/components/column-filters/types";
import { prisma } from "@/lib/db";
import type { CdrMonth } from "@/modules/traffic/cdr-month";
import type { TrafficRowFlags } from "@/modules/traffic/row-flags";
import { trafficListOrderBy, type TimeSort } from "@/modules/traffic/traffic-sort";
import { OPRS_LIST_SELECT, oprsRowData, type OprsListRow } from "@/modules/oprs/row";
import {
  assertOprsExportRowCount,
  OPRS_EXPORT_PAGE_SIZE,
  writeOprsSheet,
} from "@/modules/oprs/xlsx-export";
import { withOprsTimeout } from "@/modules/oprs/timeout";
import { buildOprsWhere, type OprsCursor } from "@/modules/oprs/where";

async function readGuiUrl(): Promise<string> {
  const setting = await prisma.appSetting.findUnique({
    where: { id: 1 },
    select: { voipmonitorGuiUrl: true },
  });
  return setting?.voipmonitorGuiUrl?.trim() ?? "";
}

export async function writeOprsExport(input: {
  month: CdrMonth;
  phoneQ: string;
  filters: ColumnFilters;
  flags: TrafficRowFlags;
  timeSort: TimeSort | null;
  snapshot: Date;
  filePath: string;
}): Promise<number> {
  const base = {
    year: input.month.year,
    month: input.month.month,
    filters: input.filters,
    phoneQ: input.phoneQ,
    flags: input.flags,
    snapshot: input.snapshot,
    timeSort: input.timeSort,
  };
  const total = await withOprsTimeout((tx) =>
    tx.cdrRecord.count({
      where: buildOprsWhere({ ...base, cursor: null }),
    }),
  );
  assertOprsExportRowCount(total);
  const guiUrl = await readGuiUrl();
  const orderBy = trafficListOrderBy(input.timeSort);
  return writeOprsSheet({
    filePath: input.filePath,
    eachRow: async (visit) => {
      let cursor: OprsCursor | null = null;
      for (;;) {
        const rows: OprsListRow[] = await withOprsTimeout((tx) =>
          tx.cdrRecord.findMany({
            where: buildOprsWhere({ ...base, cursor }),
            orderBy,
            take: OPRS_EXPORT_PAGE_SIZE,
            select: OPRS_LIST_SELECT,
          }),
        );
        if (rows.length === 0) break;
        const links = await prisma.cdrVoipmonitorLink.findMany({
          where: { cdrRecordId: { in: rows.map((row) => row.id) } },
          select: { cdrRecordId: true, voipmonitorLegs: true },
        });
        const linkById = new Map(links.map((link) => [link.cdrRecordId, link]));
        for (const row of rows) {
          await visit(oprsRowData(row, linkById.get(row.id), guiUrl));
        }
        const last = rows[rows.length - 1]!;
        cursor = { cdrDate: last.cdrDate, cdrId: last.cdrId };
        if (rows.length < OPRS_EXPORT_PAGE_SIZE) break;
      }
    },
  });
}
