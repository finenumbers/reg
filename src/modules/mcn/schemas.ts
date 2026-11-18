/**
 * Save body for the MCN Telecom token. An empty value leaves the stored key.
 */

import { z } from "zod";

export const mcnAccessSaveSchema = z
  .object({
    token: z.string().max(4096).optional(),
  })
  .strict();

