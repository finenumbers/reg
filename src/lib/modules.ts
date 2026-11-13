import type { PermissionCode } from "@/modules/rbac/permissions";

/**
 * Feature module registry — platform core + product modules.
 */

export type FeatureModuleId =
  | "settings"
  | "masks"
  | "marking"
  | "tariffs"
  | "exceptions"
  | "jobs"
  | "registrations"
  | "phones"
  | "groups"
  | "rtu"
  | "free-numbers"
  | "numbering-resource"
  | "raw"
  | "live-calls"
  | "traffic"
  | "geography"
  | "operators"
  | "audit"
  | "stats"
  | "detail"
  | "smg"
  | "smg-traffic"
  | "smg-syslog"
  | "antifraud"
  | "vats-domains"
  | "vats-telnums"
  | "vats-settings";

export type FeatureNavGroup =
  | "primary"
  | "cdr"
  | "smg"
  | "vats"
  | "analytics"
  | "links"
  | "catalog"
  | "admin";

type FeatureModuleDefinition = {
  id: FeatureModuleId;
  title: string;
  description: string;
  href?: string;
  navPermission?: PermissionCode;
  navGroup?: FeatureNavGroup;
};

export const FEATURE_MODULES: FeatureModuleDefinition[] = [
  {
    id: "rtu",
    title: "Управление РТУ",
    description: "Учётные записи оконечного оборудования софтсвитча",
    href: "/rtu",
    navPermission: "phones:read",
  },
  {
    id: "marking",
    title: "Маркировка и МАВ",
    description: "Клиент, номер, маркировка и МАВ операторов из XLSX",
    href: "/marking",
    navPermission: "phones:read",
  },
  {
    id: "registrations",
    title: "Регистрации",
    description: "Мониторинг SIP-регистраций через regs.poll",
    href: "/regs",
    navPermission: "regs:read",
  },
  {
    id: "phones",
    title: "Телефонные номера",
    description: "Оконечное оборудование и шлюзы через phones.sync",
    href: "/phones",
    navPermission: "phones:read",
  },
  {
    id: "groups",
    title: "Входящие группы",
    description: "Справочник routing groups с softswitch (только просмотр)",
    href: "/groups",
    navPermission: "phones:read",
  },
  {
    id: "free-numbers",
    title: "Свободные номера",
    description: "Каталог свободных номеров DID",
    href: "/free-numbers",
    navPermission: "phones:read",
    navGroup: "links",
  },
  {
    id: "numbering-resource",
    title: "Ресурс нумерации",
    description: "Текущий ресурс нумерации PSTN",
    href: "/numbering-resource",
    navPermission: "phones:read",
    navGroup: "links",
  },
  {
    id: "live-calls",
    title: "Текущие звонки",
    description: "Снимок текущих транзитных вызовов РТУ",
    href: "/live-calls",
    navPermission: "phones:read",
    navGroup: "cdr",
  },
  {
    id: "traffic",
    title: "Телефонный трафик",
    description: "Сокращённая таблица CDR из локальной БД",
    href: "/traffic",
    navPermission: "phones:read",
    navGroup: "cdr",
  },
  {
    id: "operators",
    title: "Операторы связи",
    description: "Сигнальные адреса и провайдеры из сырых CDR",
    href: "/operators",
    navPermission: "phones:read",
    navGroup: "cdr",
  },
  {
    id: "geography",
    title: "География звонков",
    description: "Стороны, операторы и география номеров из сырых CDR",
    href: "/geography",
    navPermission: "phones:read",
    navGroup: "cdr",
  },
  {
    id: "raw",
    title: "Сырые данные",
    description: "Полный дамп CDR софтсвитча из локальной БД",
    href: "/raw",
    navPermission: "phones:read",
    navGroup: "cdr",
  },
  {
    id: "smg-traffic",
    title: "Трафик SMG",
    description: "Сокращённая таблица CDR шлюзов Eltex SMG-1016M",
    href: "/smg/traffic",
    navPermission: "phones:read",
    navGroup: "smg",
  },
  {
    id: "smg",
    title: "Данные SMG",
    description: "Полный дамп CDR цифровых шлюзов Eltex SMG-1016M из локальной БД",
    href: "/smg",
    navPermission: "phones:read",
    navGroup: "smg",
  },
  {
    id: "antifraud",
    title: "Ошибки АнтиФрод",
    description: "Журнал Access-Request с Radius Parking",
    href: "/antifraud",
    navPermission: "phones:read",
    navGroup: "smg",
  },
  {
    id: "smg-syslog",
    title: "Архивы Syslog",
    description: "Журнал Syslog шлюзов Eltex SMG-1016M",
    href: "/smg/syslog",
    navPermission: "phones:read",
    navGroup: "smg",
  },
  {
    id: "vats-domains",
    title: "Домены ВАТС",
    description: "Имена доменов облачной АТС",
    href: "/vats",
    navPermission: "vats:read",
    navGroup: "vats",
  },
  {
    id: "vats-telnums",
    title: "Номера ВАТС",
    description: "Имена номеров облачной АТС",
    href: "/vats/telnums",
    navPermission: "vats:read",
    navGroup: "vats",
  },
  {
    id: "vats-settings",
    title: "Настройки ВАТС",
    description: "Хост и ключ платформы облачной АТС",
    href: "/vats/settings",
    navPermission: "vats:write",
    navGroup: "vats",
  },
  {
    id: "detail",
    title: "Детализация",
    description: "Звонки и минуты по клиентам каталога номеров",
    href: "/detail",
    navPermission: "phones:read",
    navGroup: "analytics",
  },
  {
    id: "stats",
    title: "Статистика",
    description: "Саммари звонков и минут по SIP-транкам и технологическим платформам",
    href: "/stats",
    navPermission: "phones:read",
    navGroup: "analytics",
  },
  {
    id: "masks",
    title: "Маски и типы",
    description: "Разрядность, категория, ABC и маска из XLSX",
    href: "/masks",
    navPermission: "phones:read",
    navGroup: "catalog",
  },
  {
    id: "tariffs",
    title: "Тарификация",
    description: "Направления, ABC, цена и себестоимость из XLSX",
    href: "/tariffs",
    navPermission: "phones:read",
    navGroup: "catalog",
  },
  {
    id: "settings",
    title: "Настройки",
    description: "SSH-профиль, интервал опроса, месяцы CDR",
    href: "/settings",
    navPermission: "settings:write",
    navGroup: "admin",
  },
  {
    id: "exceptions",
    title: "Исключения",
    description:
      "Цифровые ABC, которые без своего кода в тарифе помечают звонок как ошибку",
    href: "/exceptions",
    navPermission: "phones:read",
    navGroup: "admin",
  },
  {
    id: "jobs",
    title: "Задачи",
    description: "История запусков и диагностика",
    href: "/jobs",
    navPermission: "regs:read",
    navGroup: "admin",
  },
  {
    id: "audit",
    title: "Аудит",
    description: "Журнал действий администраторов и операторов",
    href: "/audit",
    navPermission: "audit:read",
    navGroup: "admin",
  },
];
