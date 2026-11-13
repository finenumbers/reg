/**
 * Save body for one numbering source. The route chooses the columns.
 */

import { z } from "zod";

export const numberingSourceSaveSchema = z
  .object({
    baseUrl: z.string().max(2048),
    token: z.string().max(4096).optional(),
  })
  .strict();

export type NumberingSourceSaveInput = z.infer<typeof numberingSourceSaveSchema>;

export type NumberingSourceView = {
  baseUrl: string | null;
  hasToken: boolean;
};

export type NumberingLoadView = {
  free: NumberingSourceView;
  purchased: NumberingSourceView;
};

/** Columns written for the free-number source. A null ciphertext leaves the stored token. */
export function freeSourceWrite(origin: string | null, ciphertext: string | null) {
  return {
    freeNumbersSourceBaseUrl: origin,
    ...(ciphertext ? { freeNumbersSourceTokenCiphertext: ciphertext } : {}),
  };
}

/** Columns written for the purchased-number source. A null ciphertext leaves the stored token. */
export function purchasedSourceWrite(origin: string | null, ciphertext: string | null) {
  return {
    purchasedNumbersSourceBaseUrl: origin,
    ...(ciphertext ? { purchasedNumbersSourceTokenCiphertext: ciphertext } : {}),
  };
}

/** Audit meta. The token string is not a field. */
export function numberingLoadAuditMeta(baseUrl: string | null, tokenReplaced: boolean) {
  return { baseUrl, tokenReplaced };
}
