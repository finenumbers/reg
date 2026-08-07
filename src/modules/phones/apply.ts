/**
 * Replace phone_endpoints / phone_gateways with the full export.py snapshot.
 * Empty arrays are a valid empty snapshot (wipe previous rows) when the
 * caller has already passed integrity gates.
 */

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { ParsedPhonesPayload } from "@/modules/phones/types";

const APPLY_TX = { maxWait: 10_000, timeout: 180_000 } as const;
const CREATE_BATCH = 500;

export type ApplyPhonesResult = {
  endpointCount: number;
  gatewayCount: number;
};

async function createManyBatched<T extends object>(
  createMany: (args: { data: T[] }) => Promise<unknown>,
  rows: T[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += CREATE_BATCH) {
    await createMany({ data: rows.slice(i, i + CREATE_BATCH) });
  }
}

export async function applyPhonesSnapshot(
  payload: ParsedPhonesPayload,
  jobRunId: string,
  syncedAt: Date = new Date(),
): Promise<ApplyPhonesResult> {
  await prisma.$transaction(
    async (tx) => {
      await tx.phoneEndpoint.deleteMany({});
      await tx.phoneGateway.deleteMany({});

      if (payload.endpoints.length > 0) {
        await createManyBatched(
          (args) => tx.phoneEndpoint.createMany(args),
          payload.endpoints.map((row) => ({
            name: row.name,
            endpointNumber: row.endpointNumber,
            data: row.data as Prisma.InputJsonValue,
            lastSyncedAt: syncedAt,
            lastJobRunId: jobRunId,
          })),
        );
      }

      if (payload.gateways.length > 0) {
        await createManyBatched(
          (args) => tx.phoneGateway.createMany(args),
          payload.gateways.map((row) => ({
            name: row.name,
            data: row.data as Prisma.InputJsonValue,
            lastSyncedAt: syncedAt,
            lastJobRunId: jobRunId,
          })),
        );
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
    },
    APPLY_TX,
  );

  return {
    endpointCount: payload.endpoints.length,
    gatewayCount: payload.gateways.length,
  };
}
