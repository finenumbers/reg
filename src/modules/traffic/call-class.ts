/**
 * Persisted CDR category and status.
 * The SQL CASE in the migration is rendered from the same labels and order.
 */

import { isSideKnown } from "@/modules/enrich/row-flags";
import { MISSING_BILLING_LABEL } from "@/modules/enrich/types";
import { PARKING_DST } from "@/modules/stats/classify";

export const CALL_CATEGORY = {
  redirect: "Редирект",
  check: "Проверка",
  unregistered: "Нет регистрации",
  routeError: "Ошибка маршрута",
  outgoing: "Исходящий звонок",
  incoming: "Входящий звонок",
  internal: "Внутренний звонок",
  phantom: "Фантомный трафик",
  incomingParking: "Входящий паркинг",
  outgoingParking: "Исходящий паркинг",
  error: "Ошибка",
} as const;

/** Literal prefix. `Redirect` and `Service_Redirect_` do not match. No trim. */
const REDIRECT_SRC_PREFIX = "Redirect_";
/** Exact dial object. `Service_Check_1` and `Service_Check ` do not match. */
const CHECK_DP = "Service_Check";
/** Literal prefix, including the space. `Тест`, `Тест_1`, and `тест 1` do not match. No trim. */
const CHECK_SIDE_PREFIX = "Тест ";
const UNREGISTERED_DISCONNECT = "Class4, 1 - Unregistered IP Address";
const ROUTE_ERROR_DISCONNECT = "Class4, 40 - Gateway Is Invalid";

export const CALL_STATUS = {
  success: "Успешный",
  failed: "Неуспешные",
} as const;

export type CallClass = {
  category: string;
  status: string;
};

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sideUnknownSql(column: "side_a" | "side_b"): string {
  return `${column} IN (${sqlLiteral("")}, ${sqlLiteral(MISSING_BILLING_LABEL)})`;
}

function sideKnownSql(column: "side_a" | "side_b"): string {
  return `${column} NOT IN (${sqlLiteral("")}, ${sqlLiteral(MISSING_BILLING_LABEL)})`;
}

/** Category CASE. Embedded verbatim in the migration function body. */
export function renderCallCategoryCaseSql(): string {
  const parking = `dst_name = ${sqlLiteral(PARKING_DST)}`;
  const check = `dp_name = ${sqlLiteral(CHECK_DP)} OR starts_with(side_a, ${sqlLiteral(CHECK_SIDE_PREFIX)}) OR starts_with(side_b, ${sqlLiteral(CHECK_SIDE_PREFIX)})`;
  return `CASE
    WHEN starts_with(src_name, ${sqlLiteral(REDIRECT_SRC_PREFIX)}) THEN ${sqlLiteral(CALL_CATEGORY.redirect)}
    WHEN ${check} THEN ${sqlLiteral(CALL_CATEGORY.check)}
    WHEN disconnect_code_string = ${sqlLiteral(UNREGISTERED_DISCONNECT)} THEN ${sqlLiteral(CALL_CATEGORY.unregistered)}
    WHEN disconnect_code_string = ${sqlLiteral(ROUTE_ERROR_DISCONNECT)} THEN ${sqlLiteral(CALL_CATEGORY.routeError)}
    WHEN ${parking} AND ${sideUnknownSql("side_a")} AND ${sideUnknownSql("side_b")} THEN ${sqlLiteral(CALL_CATEGORY.phantom)}
    WHEN ${parking} AND ${sideUnknownSql("side_a")} AND ${sideKnownSql("side_b")} THEN ${sqlLiteral(CALL_CATEGORY.incomingParking)}
    WHEN ${parking} AND ${sideKnownSql("side_a")} THEN ${sqlLiteral(CALL_CATEGORY.outgoingParking)}
    WHEN ${sideKnownSql("side_a")} AND ${sideUnknownSql("side_b")} THEN ${sqlLiteral(CALL_CATEGORY.outgoing)}
    WHEN ${sideUnknownSql("side_a")} AND ${sideKnownSql("side_b")} THEN ${sqlLiteral(CALL_CATEGORY.incoming)}
    WHEN ${sideKnownSql("side_a")} AND ${sideKnownSql("side_b")} THEN ${sqlLiteral(CALL_CATEGORY.internal)}
    ELSE ${sqlLiteral(CALL_CATEGORY.error)}
  END`;
}

/** Status CASE. Embedded verbatim in the migration function body. */
export function renderCallStatusCaseSql(): string {
  return `CASE WHEN elapsed_time = ${sqlLiteral("")} THEN ${sqlLiteral(CALL_STATUS.failed)} ELSE ${sqlLiteral(CALL_STATUS.success)} END`;
}

export function classifyCallCategory(
  sideA: string,
  sideB: string,
  dstName: string,
  srcName = "",
  disconnectCode = "",
  dpName = "",
): string {
  if (srcName.startsWith(REDIRECT_SRC_PREFIX)) return CALL_CATEGORY.redirect;
  if (
    dpName === CHECK_DP ||
    sideA.startsWith(CHECK_SIDE_PREFIX) ||
    sideB.startsWith(CHECK_SIDE_PREFIX)
  ) {
    return CALL_CATEGORY.check;
  }
  if (disconnectCode === UNREGISTERED_DISCONNECT) return CALL_CATEGORY.unregistered;
  if (disconnectCode === ROUTE_ERROR_DISCONNECT) return CALL_CATEGORY.routeError;
  const a = isSideKnown(sideA);
  const b = isSideKnown(sideB);
  const parking = dstName === PARKING_DST;
  if (parking && !a && !b) return CALL_CATEGORY.phantom;
  if (parking && !a && b) return CALL_CATEGORY.incomingParking;
  if (parking && a) return CALL_CATEGORY.outgoingParking;
  if (a && !b) return CALL_CATEGORY.outgoing;
  if (!a && b) return CALL_CATEGORY.incoming;
  if (a && b) return CALL_CATEGORY.internal;
  return CALL_CATEGORY.error;
}

/** Raw elapsed_time. Exactly "" is failed; "0" and any other text are success. */
export function classifyCallStatus(elapsedTime: string): string {
  return elapsedTime === "" ? CALL_STATUS.failed : CALL_STATUS.success;
}

/**
 * Upload XLSX rows have integer seconds and no raw elapsed_time.
 * Missing elapsed_time is not an empty duration.
 */
export function classifyExportStatus(elapsedTime: string | undefined): string {
  if (elapsedTime === undefined) return CALL_STATUS.success;
  return classifyCallStatus(elapsedTime);
}

export function classifyCall(
  sideA: string,
  sideB: string,
  dstName: string,
  elapsedTime: string,
  srcName = "",
  disconnectCode = "",
  dpName = "",
): CallClass {
  return {
    category: classifyCallCategory(
      sideA,
      sideB,
      dstName,
      srcName,
      disconnectCode,
      dpName,
    ),
    status: classifyCallStatus(elapsedTime),
  };
}
