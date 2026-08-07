/**
 * Fixed Russian column headers matching softswitch export.py / legacy Excel sheets.
 */

export const ENDPOINT_HEADERS = [
  "Название",
  "Описание",
  "Номер оконечного оборудования",
  "Инициирующее устройство",
  "Терминирующее устройство",
  "Регистрация",
  "Зона",
  "ИНИЦ. список адресов",
  "ИНИЦ. порт",
  "ИНИЦ. зона",
  "ИНИЦ. емкость",
  "Входящие группы",
  "ТЕРМ. список адресов",
  "ТЕРМ. порт",
  "ТЕРМ. зона",
  "ТЕРМ. емкость",
  "Регистрационное имя",
  "Регистрационный пароль",
  "Список разрешенных адресов для регистрации",
] as const;

export const GATEWAY_HEADERS = [
  "Название",
  "Описание",
  "Инициирующее устройство",
  "Терминирующее устройство",
  "Протокол сигнализации",
  "ИНИЦ. список адресов",
  "ИНИЦ. порт",
  "ИНИЦ. зона",
  "ИНИЦ. емкость",
  "Входящие группы",
  "ТЕРМ. список адресов",
  "ТЕРМ. порт",
  "ТЕРМ. зона",
  "ТЕРМ. емкость",
] as const;

export type PhoneKind =
  | "gateways"
  | "endpoints_registered"
  | "endpoints_unregistered"
  | "endpoints_error";

export function parsePhoneKind(value: string | null | undefined): PhoneKind {
  if (
    value === "gateways" ||
    value === "endpoints_registered" ||
    value === "endpoints_unregistered" ||
    value === "endpoints_error"
  ) {
    return value;
  }
  return "endpoints_registered";
}

export function isEndpointPhoneKind(kind: PhoneKind): boolean {
  return kind !== "gateways";
}

/** Exact softswitch export values for column «Регистрация». */
export const REGISTRATION_YES = "Да";
export const REGISTRATION_NO = "Нет";
export const REGISTRATION_FIELD = "Регистрация";
export const ENDPOINT_NUMBER_FIELD = "Номер оконечного оборудования";

export type PhoneRowData = Record<string, string>;

export type ParsedPhoneEndpoint = {
  name: string;
  endpointNumber: string | null;
  data: PhoneRowData;
};

export type ParsedPhoneGateway = {
  name: string;
  data: PhoneRowData;
};

export type ParsedPhonesPayload = {
  version: number;
  endpointHeaders: string[];
  gatewayHeaders: string[];
  endpoints: ParsedPhoneEndpoint[];
  gateways: ParsedPhoneGateway[];
};
