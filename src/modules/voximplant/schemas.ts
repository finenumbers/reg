/**
 * Save body for the Voximplant service account. An empty value leaves the stored key.
 */

import { z } from "zod";

export const voximplantAccessSaveSchema = z
  .object({
    credentials: z.string().max(100_000).optional(),
  })
  .strict();

