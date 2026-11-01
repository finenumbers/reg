/**
 * Build one catalog workbook from the same GET the screen already uses.
 * Rows are written as each page arrives.
 */

import { loadDidCredentials } from "@/modules/did/credentials";
import { didNotConfigured, listDidNumbers } from "@/modules/did/client";
import { DID_LIST_TIMEOUT_MS } from "@/modules/did/types";
import { FREE_NUMBER_COLUMNS, FREE_NUMBER_HEADERS } from "@/modules/free-numbers/columns";
import { mapFreeNumberRow, type FreeNumberRow } from "@/modules/free-numbers/format";
import {
  NUMBERING_COLUMNS,
  NUMBERING_HEADERS,
  type NumberingColumn,
} from "@/modules/numbering-resource/columns";
import {
  NUMBERING_EXPORT_PAGE_SIZE,
  type NumberingFilters,
} from "@/modules/numbering-resource/filters";
import {
  listNumberingResource,
  summarizeNumberingResource,
} from "@/modules/numbering-resource/service";
import type { NumberingRow } from "@/modules/numbering-resource/types";
import {
  PURCHASED_NUMBER_COLUMNS,
  PURCHASED_NUMBER_HEADERS,
} from "@/modules/purchased-numbers/columns";
import {
  mapPurchasedNumberRow,
  type PurchasedNumberRow,
} from "@/modules/purchased-numbers/format";
import type {
  TableExportRequest,
  TableExportRunContext,
} from "@/modules/table-export/job";
import {
  didRetryDelayMs,
  drainCursorPages,
  drainOffsetPages,
  isTableExportCancel,
  pstnRetryDelayMs,
} from "@/modules/table-export/pages";
import {
  openStreamingWorkbook,
  type StreamCell,
  type StreamColumn,
} from "@/modules/table-export/xlsx-stream";

const CATALOG_PAGE_SIZE = 200;

const NUMBERING_STREAM: Record<NumberingColumn, StreamColumn> = {
  abc: { header: NUMBERING_HEADERS.abc, text: true },
  rangeStart: { header: NUMBERING_HEADERS.rangeStart, bold: true },
  rangeEnd: { header: NUMBERING_HEADERS.rangeEnd, bold: true },
  capacity: { header: NUMBERING_HEADERS.capacity, align: "right" },
  operator: { header: NUMBERING_HEADERS.operator, text: true },
  garTerritory: { header: NUMBERING_HEADERS.garTerritory, text: true },
  legalAddress: { header: NUMBERING_HEADERS.legalAddress, text: true },
  inn: { header: NUMBERING_HEADERS.inn, text: true, align: "right" },
  uvrAntifraud: { header: NUMBERING_HEADERS.uvrAntifraud, align: "right" },
};

function textColumns(
  columns: readonly string[],
  headers: Record<string, string>,
): StreamColumn[] {
  return columns.map((column) => ({ header: headers[column] ?? column, text: true }));
}

function catalogCells(
  columns: readonly string[],
  row: Record<string, string>,
): StreamCell[] {
  return columns.map((column) => row[column] ?? "");
}

function numberingCells(row: NumberingRow): StreamCell[] {
  return NUMBERING_COLUMNS.map((column) => {
    if (column === "legalAddress") return row.legalAddress ?? "";
    if (column === "uvrAntifraud") return row.uvrAntifraud;
    return row[column];
  });
}

function numberingHasFilter(filters: NumberingFilters): boolean {
  return (
    filters.phoneNumber.length > 0 ||
    filters.abc.length > 0 ||
    filters.operator.length > 0 ||
    filters.garTerritory.length > 0 ||
    filters.inn.length > 0 ||
    filters.uvrAntifraud.length > 0
  );
}

async function writeCatalog(
  kind: "free" | "purchased",
  ctx: TableExportRunContext,
  request: Extract<TableExportRequest, { kind: "free" | "purchased" }>,
): Promise<void> {
  const creds = await loadDidCredentials();
  if (!creds) throw didNotConfigured();
  const columns = kind === "free" ? FREE_NUMBER_COLUMNS : PURCHASED_NUMBER_COLUMNS;
  const headers = kind === "free" ? FREE_NUMBER_HEADERS : PURCHASED_NUMBER_HEADERS;
  const mapRow = kind === "free" ? mapFreeNumberRow : mapPurchasedNumberRow;
  const book = openStreamingWorkbook({
    filePath: ctx.filePath,
    sheetName: kind === "free" ? "Свободные номера" : "Купленные номера",
    columns: textColumns(columns, headers),
    signal: ctx.signal,
    onRows: ctx.setWritten,
  });
  try {
    await drainOffsetPages({
      signal: ctx.signal,
      pageSize: CATALOG_PAGE_SIZE,
      retryDelayMs: didRetryDelayMs,
      onTotal: (total) => ctx.setTotal(total >= 0 ? total : null),
      load: (page) =>
        listDidNumbers(
          kind,
          {
            page,
            pageSize: CATALOG_PAGE_SIZE,
            filters: request.filters,
            phoneQ: request.phoneQ,
          },
          creds,
          DID_LIST_TIMEOUT_MS,
          ctx.signal,
        ),
      onPage: (items) => {
        for (const raw of items) {
          const row = mapRow(raw);
          if (!row) continue;
          book.writeRow(catalogCells(columns, row as FreeNumberRow & PurchasedNumberRow));
        }
      },
    });
    await book.finish();
  } catch (error) {
    book.abort();
    throw error;
  }
}

async function writeNumbering(
  ctx: TableExportRunContext,
  filters: NumberingFilters,
): Promise<void> {
  try {
    const summary = await summarizeNumberingResource(filters, {
      signal: ctx.signal,
      clientIp: ctx.clientIp,
    });
    const count = numberingHasFilter(filters)
      ? summary.filtered.rangeCount
      : summary.global.rangeCount;
    ctx.setTotal(count);
  } catch (error) {
    if (isTableExportCancel(error, ctx.signal)) throw error;
    ctx.setTotal(null);
  }

  const book = openStreamingWorkbook({
    filePath: ctx.filePath,
    sheetName: "Ресурс нумерации",
    columns: NUMBERING_COLUMNS.map((column) => NUMBERING_STREAM[column]),
    signal: ctx.signal,
    onRows: ctx.setWritten,
  });
  try {
    await drainCursorPages({
      signal: ctx.signal,
      retryDelayMs: pstnRetryDelayMs,
      load: async (cursor) => {
        const page = await listNumberingResource(
          { cursor, filters, pageSize: NUMBERING_EXPORT_PAGE_SIZE },
          { signal: ctx.signal, clientIp: ctx.clientIp },
        );
        return {
          items: page.items,
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
        };
      },
      onPage: (items) => {
        for (const row of items) book.writeRow(numberingCells(row));
      },
    });
    await book.finish();
  } catch (error) {
    book.abort();
    throw error;
  }
}

export async function executeTableExport(ctx: TableExportRunContext): Promise<void> {
  if (ctx.request.kind === "numbering") {
    await writeNumbering(ctx, ctx.request.filters);
    return;
  }
  await writeCatalog(ctx.request.kind, ctx, ctx.request);
}
