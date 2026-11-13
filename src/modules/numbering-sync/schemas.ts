/**
 * Save body for the SipOut key. An empty token leaves the stored key.
 */

import { z } from "zod";

export const sipoutKeySaveSchema = z
  .object({
    token: z.string().max(4096).optional(),
  })
  .strict();

export type SipoutKeySaveInput = z.infer<typeof sipoutKeySaveSchema>;
