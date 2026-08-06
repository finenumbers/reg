/**
 * Replace phone_endpoints / phone_gateways snapshot from parsed export.py payload.
 */

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { ParsedPhonesPayload } from "@/modules/phones/types";

export type ApplyPhonesResult = {
  endpointCount: number;
  gatewayCount: number;
};

export async function applyPhonesSnapshot(
  payload: ParsedPhonesPayload,
  jobRunId: string,
  syncedAt: Date = new Date(),
): Promise<ApplyPhonesResult> {
  await prisma.$transaction(async (tx) => {
    await tx.phoneEndpoint.deleteMany({});
    await tx.phoneGateway.deleteMany({});

    if (payload.endpoints.length > 0) {
      await tx.phoneEndpoint.createMany({
        data: payload.endpoints.map((row) => ({
          name: row.name,
          endpointNumber: row.endpointNumber,
          data: row.data as Prisma.InputJsonValue,
          lastSyncedAt: syncedAt,
          lastJobRunId: jobRunId,
        })),
      });
    }

    if (payload.gateways.length > 0) {
      await tx.phoneGateway.createMany({
        data: payload.gateways.map((row) => ({
          name: row.name,
          data: row.data as Prisma.InputJsonValue,
          lastSyncedAt: syncedAt,
          lastJobRunId: jobRunId,
        })),
      });
    }

    await tx.phoneImportState.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        endpointCount: payload.endpoints.length,
        gatewayCount: payload.gateways.length,
        headersEndpoints: payload.endpointHeaders as Prisma.InputJsonValue,
        headersGateways: payload.gatewayHeaders as Prisma.InputJsonValue,
        lastSyncedAt: syncedAt,
        lastJobRunId: jobRunId,
      },
      update: {
        endpointCount: payload.endpoints.length,
        gatewayCount: payload.gateways.length,
        headersEndpoints: payload.endpointHeaders as Prisma.InputJsonValue,
        headersGateways: payload.gatewayHeaders as Prisma.InputJsonValue,
        lastSyncedAt: syncedAt,
        lastJobRunId: jobRunId,
      },
    });
  });

  return {
    endpointCount: payload.endpoints.length,
    gatewayCount: payload.gateways.length,
  };
}
