/**
 * Which syslog nodes may narrow the three antifraud dashboard charts.
 * The list is the Settings checkbox plus a non-empty identifier.
 * A node address never becomes SQL text.
 */

import { canonicalIpv4 } from "@/modules/smg-syslog/ip";
import {
  isAntifraudChartSeries,
  type DashboardSeriesId,
} from "@/modules/dashboard/series";

export const ALL_ANTIFRAUD_NODES_LABEL = "Все узлы Eltex SMG-1016M";
export const DASHBOARD_NODE_REJECTED = "Этот узел не участвует в АнтиФроде.";

export type DashboardNodeParse = { ok: true; ip: string | null } | { ok: false };

export function isAntifraudChartNode(node: {
  antifraudEnabled: boolean;
  identifier: string | null;
}): boolean {
  return node.antifraudEnabled && Boolean(node.identifier);
}

/** Cache and in-flight key. An empty node stays the series id used before filtering. */
export function dashboardCallsCacheKey(series: string, nodeIp: string | null): string {
  return nodeIp ? `${series}\n${nodeIp}` : series;
}

export function antifraudChartNodeWhere() {
  return {
    antifraudEnabled: true,
    AND: [{ identifier: { not: null } }, { identifier: { not: "" } }],
  };
}

/**
 * Missing or blank means every node. A non-antifraud series ignores the parameter.
 * Anything that is not a canonical IPv4 is rejected before a query.
 */
export function parseDashboardAntifraudNode(
  series: DashboardSeriesId,
  raw: string | null,
): DashboardNodeParse {
  if (!isAntifraudChartSeries(series)) return { ok: true, ip: null };
  if (raw == null || raw.trim() === "") return { ok: true, ip: null };
  const ip = canonicalIpv4(raw);
  if (!ip) return { ok: false };
  return { ok: true, ip };
}
