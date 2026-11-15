/**
 * Save body for the UIS key. An empty token leaves the stored key.
 */

import { z } from "zod";

export const uisAccessSaveSchema = z
  .object({
    token: z.string().max(4096).optional(),
  })
  .strict();

export type UisAccessSaveInput = z.infer<typeof uisAccessSaveSchema>;
