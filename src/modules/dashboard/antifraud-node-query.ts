/**
 * Database reads for the antifraud node menu.
 * Kept out of antifraud-nodes.ts so the dashboard client cannot import Prisma.
 */

import { prisma } from "@/lib/db";
import {
  antifraudChartNodeWhere,
  isAntifraudChartNode,
} from "@/modules/dashboard/antifraud-nodes";
import type { DashboardAntifraudNode } from "@/modules/dashboard/types";

export async function listAntifraudChartNodes(): Promise<DashboardAntifraudNode[]> {
  return prisma.smgSyslogNode.findMany({
    where: antifraudChartNodeWhere(),
    select: { ip: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function antifraudChartNodeAllowed(ip: string): Promise<boolean> {
  const node = await prisma.smgSyslogNode.findUnique({
    where: { ip },
    select: { antifraudEnabled: true, identifier: true },
  });
  return node != null && isAntifraudChartNode(node);
}
