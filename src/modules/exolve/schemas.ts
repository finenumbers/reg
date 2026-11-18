/**
 * Save body for the MTS Exolve key. An empty token leaves the stored key.
 */

import { z } from "zod";

export const exolveAccessSaveSchema = z
  .object({
    token: z.string().max(4096).optional(),
  })
  .strict();

