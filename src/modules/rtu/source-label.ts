/**
 * «Источник» on «Управление РТУ».
 * The label is the purchased-catalog provider code.
 */

export const FINENUMBERS_PROVIDER_CODE = "finenumbers";
export const GEOGRAPHY_MANUAL_SOURCE = "Вручную";

const PROVIDER_LABELS: Record<string, string> = {
  sipout: "SipOut",
  runexis: "Runexis",
  uis: "UIS",
  aurora: "Aurora Telecom",
  finenumbers: "Finenumbers",
  exolve: "Exolve",
  voximplant: "Voximplant",
  mcn: "MCN Telecom",
  didww: "DIDWW",
  twilio: "Twilio",
};

/** Stored DID provider code, with the known catalog names. */
export function displayProviderCode(code: string): string {
  return PROVIDER_LABELS[code] ?? code;
}

/** DID provider code as stored on a geography snapshot row. */
export function geographyProviderLabel(code: string): string {
  const trimmed = code.trim();
  if (trimmed.toLowerCase() === FINENUMBERS_PROVIDER_CODE) return GEOGRAPHY_MANUAL_SOURCE;
  const label = displayProviderCode(trimmed);
  if (label.trim().toLowerCase() === FINENUMBERS_PROVIDER_CODE)
    return GEOGRAPHY_MANUAL_SOURCE;
  return label;
}
