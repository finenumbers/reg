/**
 * Mask catalog — paged list of the current XLSX snapshot.
 */

import { prisma } from "@/lib/db";

export type MaskListItem = {
  id: string;
  digitLength: number;
  category: string;
  abc: string | null;
  mask: string;
  maskType: string | null;
  premium: string | null;
  purchase: string | null;
};

export type ListMasksResult = {
  items: MaskListItem[];
  total: number;
  page: number;
  pageSize: number;
  loadedAt: string | null;
  filename: string | null;
  rowCount: number;
};

const maskSelect = {
  id: true,
  digitLength: true,
  category: true,
  abc: true,
  mask: true,
  maskType: true,
  premium: true,
  purchase: true,
} as const;

export async function listNumberMasks(opts: {
  page?: number;
  pageSize?: number;
}): Promise<ListMasksResult> {
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 100));
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const skip = (page - 1) * pageSize;

  const [total, state, rows] = await Promise.all([
    prisma.numberMask.count(),
    prisma.numberMaskImportState.findUnique({ where: { id: 1 } }),
    prisma.numberMask.findMany({
      orderBy: { sortIndex: "asc" },
      skip,
      take: pageSize,
      select: maskSelect,
    }),
  ]);

  return {
    items: rows,
    total,
    page,
    pageSize,
    loadedAt: state?.loadedAt?.toISOString() ?? null,
    filename: state?.filename ?? null,
    rowCount: state?.rowCount ?? total,
  };
}
