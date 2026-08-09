/**
 * RTU import conversion types (ephemeral XLSX → CSV, nothing persisted).
 */

export type RtuConvertIssue = {
  /** Human-readable Russian detail for the web UI */
  message: string;
};

export type RtuSheetKind = "endpoints" | "gateways";

export type RtuSourceRow = {
  sheet: RtuSheetKind;
  /** 1-based Excel row number (header is 1) */
  rowNumber: number;
  values: Record<string, string>;
};

export type RtuConvertSuccess = {
  ok: true;
  csv: string;
  endpointCount: number;
  gatewayCount: number;
};

export type RtuConvertFailure = {
  ok: false;
  error: string;
  details: string[];
};

export type RtuConvertResult = RtuConvertSuccess | RtuConvertFailure;

export type RtuImportDefaults = {
  /** Column names in CSV order (may contain duplicate labels). */
  headers: string[];
  /** Parallel default cell values (same length as headers). */
  defaultValues: string[];
};
