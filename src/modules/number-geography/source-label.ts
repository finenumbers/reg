/**
 * «Источник» on «География номеров».
 * Free-number rows keep the shared provider label.
 */

import { displayProviderCode } from "@/modules/free-numbers/format";

export const FINENUMBERS_PROVIDER_CODE = "finenumbers";
export const GEOGRAPHY_MANUAL_SOURCE = "Вручную";

/** DID provider code as stored on a geography snapshot row. */
export function geographyProviderLabel(code: string): string {
  const trimmed = code.trim();
  if (trimmed.toLowerCase() === FINENUMBERS_PROVIDER_CODE) return GEOGRAPHY_MANUAL_SOURCE;
  const label = displayProviderCode(trimmed);
  if (label.trim().toLowerCase() === FINENUMBERS_PROVIDER_CODE)
    return GEOGRAPHY_MANUAL_SOURCE;
  return label;
}
