/**
 * DID credentials are no longer stored. The call does not read settings and does not
 * open a connection.
 */

import type { DidCredentials } from "@/modules/did/types";

export async function loadDidCredentials(): Promise<DidCredentials | null> {
  return null;
}
