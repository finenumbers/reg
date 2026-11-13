const inflightUsers = new Set<string>();
let inflightCount = 0;

export const BDPN_PROCESS_LIMIT = 2;

export type BdpnFlight = "ok" | "user" | "process";

/** One outbound check per user, and at most two in this process. */
export function acquireBdpnLookup(userId: string): BdpnFlight {
  if (inflightUsers.has(userId)) return "user";
  if (inflightCount >= BDPN_PROCESS_LIMIT) return "process";
  inflightUsers.add(userId);
  inflightCount += 1;
  return "ok";
}

export function releaseBdpnLookup(userId: string): void {
  if (!inflightUsers.delete(userId)) return;
  inflightCount = Math.max(0, inflightCount - 1);
}

/** Test helper. */
export function resetBdpnFlight(): void {
  inflightUsers.clear();
  inflightCount = 0;
}
