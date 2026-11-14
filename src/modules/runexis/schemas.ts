/**
 * Save body for the Runexis login. An empty password leaves the stored password.
 */

import { z } from "zod";

export const runexisAccessSaveSchema = z
  .object({
    email: z.string().trim().min(1).max(320).email(),
    password: z.string().max(4096).optional(),
  })
  .strict();

export type RunexisAccessSaveInput = z.infer<typeof runexisAccessSaveSchema>;
