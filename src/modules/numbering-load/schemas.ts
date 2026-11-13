/**
 * Save body for the SipOut key. An empty token leaves the stored key.
 */

import { z } from "zod";
import { SIPOUT_ORIGIN } from "@/modules/sipout/url";

export const sipoutKeySaveSchema = z
  .object({
    token: z.string().max(4096).optional(),
  })
  .strict();

export type SipoutKeySaveInput = z.infer<typeof sipoutKeySaveSchema>;

export type NumberingLoadView = {
  host: typeof SIPOUT_ORIGIN;
  hasKey: boolean;
};
