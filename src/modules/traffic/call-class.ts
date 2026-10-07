/**
 * Persisted CDR category, type, and status.
 * The SQL CASE in the migration is rendered from the same labels and order.
 */

import { isSideKnown } from "@/modules/enrich/row-flags";
import { MISSING_BILLING_LABEL } from "@/modules/enrich/types";
import { PARKING_DST } from "@/modules/stats/classify";
import { matchTariffAbc, type TariffAbcRate } from "@/modules/traffic/tariff-match";

export const CALL_CATEGORY = {
  outgoing: "Исходящие",
  check: "Проверка",
  unregistered: "Нет регистрации",
  routeError: "Ошибка маршрута",
  incoming: "Входящий",
  phantom: "Фантомный",
  verify: "Проверить",
} as const;

export const CALL_TYPE = {
  local: "Местный",
  intercity: "Междугородный",
  international: "Международный",
  redirect: "Редирект",
  check: "Проверка",
  error: "Ошибка",
  verify: "Проверить",
} as const;

/** Tariff direction prefix for one city. Letter, dot, space. */
export const CITY_DIRECTION_PREFIX = "г. ";

/** Outgoing geography types that stay in the «Успешные» checkbox. Redirect does not. */
export const SUCCESS_CALL_TYPES = [
  CALL_TYPE.local,
  CALL_TYPE.intercity,
  CALL_TYPE.international,
] as const;

/** Literal prefix. `Redirect` and `Service_Redirect_` do not match. No trim. */
const REDIRECT_SRC_PREFIX = "Redirect_";
/** Exact dial object. `Service_Check_1` and `Service_Check ` do not match. */
const CHECK_DP = "Service_Check";
/** Literal prefix, including the space. `Тест`, `Тест_1`, and `тест 1` do not match. No trim. */
const CHECK_SIDE_PREFIX = "Тест ";
const UNREGISTERED_DISCONNECT = "Class4, 1 - Unregistered IP Address";
const ROUTE_ERROR_DISCONNECT = "Class4, 40 - Gateway Is Invalid";
const LOCAL_NUMBER = /^(73|74|78)\d{9}$/;
const NATIONAL_NUMBER = /^(73|74|78|79)\d{9}$/;

export const CALL_STATUS = {
  success: "Успешный",
  failed: "Неуспешный",
  parking: "Паркинг",
} as const;

export type CallClass = {
  category: string;
  type: string;
  status: string;
};

export type CallGeography = "local" | "intercity" | "international";

/** Outgoing geography reads the B-number. Incoming and phantom read the A-number. */
export type CallVector = "outgoing" | "incoming";

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sideUnknownSql(column: "side_a" | "side_b"): string {
  return `${column} IN (${sqlLiteral("")}, ${sqlLiteral(MISSING_BILLING_LABEL)})`;
}

function sideKnownSql(column: "side_a" | "side_b"): string {
  return `${column} NOT IN (${sqlLiteral("")}, ${sqlLiteral(MISSING_BILLING_LABEL)})`;
}

function geographyType(geography: CallGeography): string {
  if (geography === "local") return CALL_TYPE.local;
  if (geography === "international") return CALL_TYPE.international;
  return CALL_TYPE.intercity;
}

function geographyTypeSql(vector: CallVector): string {
  const geography = `cdr_call_geography(bill_ani, bill_dnis, ${sqlLiteral(vector)})`;
  return `CASE ${geography}
      WHEN ${sqlLiteral("local")} THEN ${sqlLiteral(CALL_TYPE.local)}
      WHEN ${sqlLiteral("international")} THEN ${sqlLiteral(CALL_TYPE.international)}
      ELSE ${sqlLiteral(CALL_TYPE.intercity)}
    END`;
}

function isRedirect(srcName: string): boolean {
  return srcName.startsWith(REDIRECT_SRC_PREFIX);
}

function isCheckCall(sideA: string, sideB: string, dpName: string): boolean {
  return (
    dpName === CHECK_DP ||
    sideA.startsWith(CHECK_SIDE_PREFIX) ||
    sideB.startsWith(CHECK_SIDE_PREFIX)
  );
}

function isWinningDisconnect(disconnectCode: string): boolean {
  return (
    disconnectCode === UNREGISTERED_DISCONNECT ||
    disconnectCode === ROUTE_ERROR_DISCONNECT
  );
}

/**
 * Successful parking mark. Redirect and check win over a disconnect code.
 * A disconnect code blocks parking only when it is the category.
 * Both unknown sides without redirect or check stay phantom, not parking.
 */
function isParkingStatus(
  sideA: string,
  sideB: string,
  dstName: string,
  srcName: string,
  disconnectCode: string,
  dpName: string,
): boolean {
  if (dstName !== PARKING_DST) return false;
  if (isRedirect(srcName) || isCheckCall(sideA, sideB, dpName)) return true;
  if (isWinningDisconnect(disconnectCode)) return false;
  if (!isSideKnown(sideA) && !isSideKnown(sideB)) return false;
  return true;
}

/**
 * Local, intercity, or international.
 * One city is the longest ABC of each number, same direction, starting with «г. ».
 * The far number is the B-number for outgoing calls and the A-number for incoming and phantom.
 */
export function classifyCallGeography(
  billAni: string,
  billDnis: string,
  rates: readonly TariffAbcRate[],
  vector: CallVector = "outgoing",
): CallGeography {
  const ani = billAni.trim();
  const dnis = billDnis.trim();
  const far = vector === "incoming" ? ani : dnis;
  if (LOCAL_NUMBER.test(ani) && LOCAL_NUMBER.test(dnis)) {
    const directionA = matchTariffAbc(ani, rates)?.direction;
    const directionB = matchTariffAbc(dnis, rates)?.direction;
    if (
      directionA &&
      directionA === directionB &&
      directionA.startsWith(CITY_DIRECTION_PREFIX)
    ) {
      return "local";
    }
  }
  if (!NATIONAL_NUMBER.test(far)) return "international";
  return "intercity";
}

/** Category CASE. Embedded verbatim in the migration function body. */
export function renderCallCategoryCaseSql(): string {
  const parking = `dst_name = ${sqlLiteral(PARKING_DST)}`;
  const check = `dp_name = ${sqlLiteral(CHECK_DP)} OR starts_with(side_a, ${sqlLiteral(CHECK_SIDE_PREFIX)}) OR starts_with(side_b, ${sqlLiteral(CHECK_SIDE_PREFIX)})`;
  const sideA = sideKnownSql("side_a");
  return `CASE
    WHEN starts_with(src_name, ${sqlLiteral(REDIRECT_SRC_PREFIX)}) THEN ${sqlLiteral(CALL_CATEGORY.outgoing)}
    WHEN ${check} THEN ${sqlLiteral(CALL_CATEGORY.check)}
    WHEN disconnect_code_string = ${sqlLiteral(UNREGISTERED_DISCONNECT)} THEN ${sqlLiteral(CALL_CATEGORY.unregistered)}
    WHEN disconnect_code_string = ${sqlLiteral(ROUTE_ERROR_DISCONNECT)} THEN ${sqlLiteral(CALL_CATEGORY.routeError)}
    WHEN ${parking} AND ${sideUnknownSql("side_a")} AND ${sideUnknownSql("side_b")} THEN ${sqlLiteral(CALL_CATEGORY.phantom)}
    WHEN ${sideA} THEN ${sqlLiteral(CALL_CATEGORY.outgoing)}
    WHEN ${sideUnknownSql("side_a")} AND ${sideKnownSql("side_b")} THEN ${sqlLiteral(CALL_CATEGORY.incoming)}
    ELSE ${sqlLiteral(CALL_CATEGORY.verify)}
  END`;
}

/** Type CASE. Embedded verbatim in the migration function body. */
export function renderCallTypeCaseSql(): string {
  const parking = `dst_name = ${sqlLiteral(PARKING_DST)}`;
  const check = `dp_name = ${sqlLiteral(CHECK_DP)} OR starts_with(side_a, ${sqlLiteral(CHECK_SIDE_PREFIX)}) OR starts_with(side_b, ${sqlLiteral(CHECK_SIDE_PREFIX)})`;
  const disconnect = `disconnect_code_string IN (${sqlLiteral(UNREGISTERED_DISCONNECT)}, ${sqlLiteral(ROUTE_ERROR_DISCONNECT)})`;
  const sideA = sideKnownSql("side_a");
  const phantom = `${parking} AND ${sideUnknownSql("side_a")} AND ${sideUnknownSql("side_b")}`;
  const incoming = `${sideUnknownSql("side_a")} AND ${sideKnownSql("side_b")}`;
  return `CASE
    WHEN starts_with(src_name, ${sqlLiteral(REDIRECT_SRC_PREFIX)}) THEN ${sqlLiteral(CALL_TYPE.redirect)}
    WHEN ${check} THEN ${sqlLiteral(CALL_TYPE.check)}
    WHEN ${disconnect} THEN ${sqlLiteral(CALL_TYPE.error)}
    WHEN ${phantom} THEN ${geographyTypeSql("incoming")}
    WHEN ${sideA} THEN ${geographyTypeSql("outgoing")}
    WHEN ${incoming} THEN ${geographyTypeSql("incoming")}
    ELSE ${sqlLiteral(CALL_TYPE.verify)}
  END`;
}

/** Status CASE. Embedded verbatim in the migration function body. */
export function renderCallStatusCaseSql(): string {
  const parking = `dst_name = ${sqlLiteral(PARKING_DST)}`;
  const redirectOrCheck = `starts_with(src_name, ${sqlLiteral(REDIRECT_SRC_PREFIX)}) OR dp_name = ${sqlLiteral(CHECK_DP)} OR starts_with(side_a, ${sqlLiteral(CHECK_SIDE_PREFIX)}) OR starts_with(side_b, ${sqlLiteral(CHECK_SIDE_PREFIX)})`;
  const disconnect = `disconnect_code_string IN (${sqlLiteral(UNREGISTERED_DISCONNECT)}, ${sqlLiteral(ROUTE_ERROR_DISCONNECT)})`;
  const bothUnknown = `${sideUnknownSql("side_a")} AND ${sideUnknownSql("side_b")}`;
  return `CASE
    WHEN elapsed_time = ${sqlLiteral("")} THEN ${sqlLiteral(CALL_STATUS.failed)}
    WHEN ${parking} AND (${redirectOrCheck}) THEN ${sqlLiteral(CALL_STATUS.parking)}
    WHEN ${parking} AND (${disconnect} OR (${bothUnknown})) THEN ${sqlLiteral(CALL_STATUS.success)}
    WHEN ${parking} THEN ${sqlLiteral(CALL_STATUS.parking)}
    ELSE ${sqlLiteral(CALL_STATUS.success)}
  END`;
}

export function classifyCallCategory(
  sideA: string,
  sideB: string,
  dstName: string,
  srcName = "",
  disconnectCode = "",
  dpName = "",
): string {
  if (isRedirect(srcName)) return CALL_CATEGORY.outgoing;
  if (isCheckCall(sideA, sideB, dpName)) return CALL_CATEGORY.check;
  if (disconnectCode === UNREGISTERED_DISCONNECT) return CALL_CATEGORY.unregistered;
  if (disconnectCode === ROUTE_ERROR_DISCONNECT) return CALL_CATEGORY.routeError;
  const a = isSideKnown(sideA);
  const b = isSideKnown(sideB);
  const parking = dstName === PARKING_DST;
  if (parking && !a && !b) return CALL_CATEGORY.phantom;
  if (a) return CALL_CATEGORY.outgoing;
  if (!a && b) return CALL_CATEGORY.incoming;
  return CALL_CATEGORY.verify;
}

export function classifyCallType(
  sideA: string,
  sideB: string,
  dstName: string,
  srcName = "",
  disconnectCode = "",
  dpName = "",
  billAni = "",
  billDnis = "",
  rates: readonly TariffAbcRate[] = [],
): string {
  if (isRedirect(srcName)) return CALL_TYPE.redirect;
  if (isCheckCall(sideA, sideB, dpName)) return CALL_TYPE.check;
  if (isWinningDisconnect(disconnectCode)) return CALL_TYPE.error;
  const a = isSideKnown(sideA);
  const b = isSideKnown(sideB);
  const parking = dstName === PARKING_DST;
  if (parking && !a && !b) {
    return geographyType(classifyCallGeography(billAni, billDnis, rates, "incoming"));
  }
  if (a) return geographyType(classifyCallGeography(billAni, billDnis, rates, "outgoing"));
  if (!a && b) {
    return geographyType(classifyCallGeography(billAni, billDnis, rates, "incoming"));
  }
  return CALL_TYPE.verify;
}

/**
 * Raw elapsed_time. Exactly "" is failed; "0" and any other text are success.
 * Non-empty parking, including redirect and check, is «Паркинг».
 */
export function classifyCallStatus(
  elapsedTime: string,
  sideA = "",
  sideB = "",
  dstName = "",
  srcName = "",
  disconnectCode = "",
  dpName = "",
): string {
  if (elapsedTime === "") return CALL_STATUS.failed;
  if (isParkingStatus(sideA, sideB, dstName, srcName, disconnectCode, dpName)) {
    return CALL_STATUS.parking;
  }
  return CALL_STATUS.success;
}

/**
 * Upload XLSX rows have integer seconds and no raw elapsed_time.
 * Missing elapsed_time is not an empty duration, so parking still applies.
 */
export function classifyExportStatus(
  elapsedTime: string | undefined,
  sideA = "",
  sideB = "",
  dstName = "",
  srcName = "",
  disconnectCode = "",
  dpName = "",
): string {
  if (elapsedTime === "") return CALL_STATUS.failed;
  if (isParkingStatus(sideA, sideB, dstName, srcName, disconnectCode, dpName)) {
    return CALL_STATUS.parking;
  }
  return CALL_STATUS.success;
}

export function classifyCall(
  sideA: string,
  sideB: string,
  dstName: string,
  elapsedTime: string,
  srcName = "",
  disconnectCode = "",
  dpName = "",
  billAni = "",
  billDnis = "",
  rates: readonly TariffAbcRate[] = [],
): CallClass {
  return {
    category: classifyCallCategory(sideA, sideB, dstName, srcName, disconnectCode, dpName),
    type: classifyCallType(
      sideA,
      sideB,
      dstName,
      srcName,
      disconnectCode,
      dpName,
      billAni,
      billDnis,
      rates,
    ),
    status: classifyCallStatus(
      elapsedTime,
      sideA,
      sideB,
      dstName,
      srcName,
      disconnectCode,
      dpName,
    ),
  };
}
