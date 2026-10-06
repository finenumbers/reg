/**
 * Tariff catalog — paged list of the current XLSX snapshot.
 */

import { prisma } from "@/lib/db";
import { formatTariffDecimal } from "@/modules/tariffs/parse-xlsx";

export type TariffListItem = {
  id: string;
  direction: string;
  abc: string;
  price: string;
  cost: string;
};

export type ListTariffsResult = {
  items: TariffListItem[];
  total: number;
  page: number;
  pageSize: number;
  loadedAt: string | null;
  filename: string | null;
  rowCount: number;
};

export async function listTariffRates(opts: {
  page?: number;
  pageSize?: number;
}): Promise<ListTariffsResult> {
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 100));
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const skip = (page - 1) * pageSize;

  const [total, state, rows] = await Promise.all([
    prisma.tariffRate.count(),
    prisma.tariffImportState.findUnique({ where: { id: 1 } }),
    prisma.tariffRate.findMany({
      orderBy: { sortIndex: "asc" },
      skip,
      take: pageSize,
      select: {
        id: true,
        direction: true,
        abc: true,
        price: true,
        cost: true,
      },
    }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      direction: row.direction,
      abc: row.abc,
      price: formatTariffDecimal(row.price.toString()),
      cost: formatTariffDecimal(row.cost.toString()),
    })),
    total,
    page,
    pageSize,
    loadedAt: state?.loadedAt?.toISOString() ?? null,
    filename: state?.filename ?? null,
    rowCount: state?.rowCount ?? total,
  };
}
