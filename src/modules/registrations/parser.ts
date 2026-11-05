/**
 * Registration row carried from the RTU API read into apply.
 */

export type RegStatusValue = "Registered" | "Unregistered";

export type ParsedRegistrationRow = {
  phone: string;
  status: RegStatusValue;
  ip: string | null;
  port: number | null;
  /** RTU «Агент пользователя». */
  userAgent: string | null;
  /** Unused by apply. Kept so the API mapper can leave it empty. */
  rawLine: string;
};
