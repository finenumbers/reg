/**
 * Build one catalog workbook from the same rows the screen already shows.
 * Rows are written as each page arrives.
 */

import { formatAmountCell } from "@/lib/amount-format";
import {
  AMOUNT_COLUMNS,
  FREE_NUMBER_COLUMNS,
  FREE_NUMBER_HEADERS,
} from "@/modules/free-numbers/columns";
import { FREE_NUMBERS_EXPORT_BATCH } from "@/modules/free-numbers/query";
import {
  countFreeNumbers,
  listFreeNumbersExportBatch,
} from "@/modules/free-numbers/service";
import type { FreeNumberCursor } from "@/modules/free-numbers/sql";
import {
  AMOUNT_COLUMNS as PURCHASED_AMOUNT_COLUMNS,
  PURCHASED_NUMBER_COLUMNS,
  PURCHASED_NUMBER_HEADERS,
} from "@/modules/purchased-numbers/columns";
import { PURCHASED_NUMBERS_EXPORT_BATCH } from "@/modules/purchased-numbers/query";
import {
  countPurchasedNumbers,
  listPurchasedNumbersExportBatch,
} from "@/modules/purchased-numbers/service";
import type { PurchasedNumberCursor } from "@/modules/purchased-numbers/sql";
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
import type {
  TableExportRequest,
  TableExportRunContext,
} from "@/modules/table-export/job";
import { loadNumberingExportPage } from "@/modules/table-export/page-size";
import {
  drainCursorPages,
  isTableExportCancel,
  pstnRetryDelayMs,
  yieldEventLoop,
} from "@/modules/table-export/pages";
import {
  openStreamingWorkbook,
  TableExportCancelled,
  type StreamCell,
  type StreamColumn,
} from "@/modules/table-export/xlsx-stream";

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

function freeColumns(): StreamColumn[] {
  return FREE_NUMBER_COLUMNS.map((column) => ({
    header: FREE_NUMBER_HEADERS[column],
    text: true,
    align: column === "number" || AMOUNT_COLUMNS.has(column) ? "right" : undefined,
  }));
}

async function writeFree(
  ctx: TableExportRunContext,
  request: Extract<TableExportRequest, { kind: "free" }>,
): Promise<void> {
  const book = openStreamingWorkbook({
    filePath: ctx.filePath,
    sheetName: "Свободные номера",
    columns: freeColumns(),
    signal: ctx.signal,
    onRows: ctx.setWritten,
  });
  try {
    ctx.setTotal(await countFreeNumbers(request.filters, request.phoneQ));
    let cursor: FreeNumberCursor | null = null;
    for (;;) {
      if (ctx.signal.aborted) throw new TableExportCancelled();
      const items = await listFreeNumbersExportBatch({
        filters: request.filters,
        phoneQ: request.phoneQ,
        cursor,
        limit: FREE_NUMBERS_EXPORT_BATCH,
      });
      if (items.length === 0) break;
      for (const row of items) {
        await book.writeRow(
          FREE_NUMBER_COLUMNS.map((column) =>
            AMOUNT_COLUMNS.has(column) ? formatAmountCell(row[column]) : row[column],
          ),
        );
      }
      if (items.length < FREE_NUMBERS_EXPORT_BATCH) break;
      const last = items[items.length - 1];
      if (!last) break;
      const next = { abc: last.abc, number: last.number, id: last.id };
      if (
        cursor &&
        cursor.abc === next.abc &&
        cursor.number === next.number &&
        cursor.id === next.id
      ) {
        break;
      }
      cursor = next;
      await yieldEventLoop();
    }
    await book.finish();
  } catch (error) {
    book.abort();
    throw error;
  }
}

function purchasedColumns(): StreamColumn[] {
  return PURCHASED_NUMBER_COLUMNS.map((column) => ({
    header: PURCHASED_NUMBER_HEADERS[column],
    text: true,
    align: column === "number" || PURCHASED_AMOUNT_COLUMNS.has(column) ? "right" : undefined,
  }));
}

async function writePurchased(
  ctx: TableExportRunContext,
  request: Extract<TableExportRequest, { kind: "purchased" }>,
): Promise<void> {
  const book = openStreamingWorkbook({
    filePath: ctx.filePath,
    sheetName: "Купленные номера",
    columns: purchasedColumns(),
    signal: ctx.signal,
    onRows: ctx.setWritten,
  });
  try {
    ctx.setTotal(await countPurchasedNumbers(request.filters, request.phoneQ));
    let cursor: PurchasedNumberCursor | null = null;
    for (;;) {
      if (ctx.signal.aborted) throw new TableExportCancelled();
      const items = await listPurchasedNumbersExportBatch({
        filters: request.filters,
        phoneQ: request.phoneQ,
        cursor,
        limit: PURCHASED_NUMBERS_EXPORT_BATCH,
      });
      if (items.length === 0) break;
      for (const row of items) {
        await book.writeRow(
          PURCHASED_NUMBER_COLUMNS.map((column) =>
            PURCHASED_AMOUNT_COLUMNS.has(column) ? formatAmountCell(row[column]) : row[column],
          ),
        );
      }
      if (items.length < PURCHASED_NUMBERS_EXPORT_BATCH) break;
      const last = items[items.length - 1];
      if (!last) break;
      const next = { abc: last.abc, number: last.number, id: last.id };
      if (
        cursor &&
        cursor.abc === next.abc &&
        cursor.number === next.number &&
        cursor.id === next.id
      ) {
        break;
      }
      cursor = next;
      await yieldEventLoop();
    }
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
    let pageSize = NUMBERING_EXPORT_PAGE_SIZE;
    await drainCursorPages({
      signal: ctx.signal,
      retryDelayMs: pstnRetryDelayMs,
      load: async (cursor) => {
        const loaded = await loadNumberingExportPage({
          cursor,
          pageSize,
          load: (size) =>
            listNumberingResource(
              { cursor, filters, pageSize: size },
              { signal: ctx.signal, clientIp: ctx.clientIp },
            ),
        });
        pageSize = loaded.pageSize;
        return {
          items: loaded.value.items,
          hasMore: loaded.value.hasMore,
          nextCursor: loaded.value.nextCursor,
        };
      },
      onPage: async (items) => {
        for (const row of items) await book.writeRow(numberingCells(row));
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
  if (ctx.request.kind === "purchased") {
    await writePurchased(ctx, ctx.request);
    return;
  }
  await writeFree(ctx, ctx.request);
}
