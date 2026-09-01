import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { logger } from "@/lib/logger";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const POOL_CONNECT_TIMEOUT_MS = 10_000;

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to initialize Prisma");
  }
  const adapter = new PrismaPg(
    { connectionString, connectionTimeoutMillis: POOL_CONNECT_TIMEOUT_MS },
    {
      onPoolError: (error) => {
        logger.warn("prisma.pool_error", { error: error.message });
      },
      onConnectionError: (error) => {
        logger.warn("prisma.connection_error", { error: error.message });
      },
    },
  );
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

/**
 * Shared Prisma client. Lazy so `next build` can import modules without DATABASE_URL.
 * Auth models come from Better Auth CLI generation; domain models live alongside them.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = globalForPrisma.prisma ?? createPrismaClient();
    if (process.env.NODE_ENV !== "production") {
      globalForPrisma.prisma = client;
    } else if (!globalForPrisma.prisma) {
      globalForPrisma.prisma = client;
    }
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
