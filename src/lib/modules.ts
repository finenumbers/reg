import type { PermissionCode } from "@/modules/rbac/permissions";

/**
 * Feature module registry — platform core + product modules.
 */

export type FeatureModuleId =
  | "settings"
  | "tariffs"
  | "exceptions"
  | "jobs"
  | "registrations"
  | "phones"
  | "groups"
  | "raw"
  | "traffic"
  | "geography"
  | "operators"
  | "audit"
  | "enrich"
  | "stats"
  | "detail"
  | "smg"
  | "smg-traffic"
  | "smg-syslog"
  | "antifraud";

export type FeatureNavGroup = "primary" | "cdr" | "smg" | "analytics" | "admin";

type FeatureModuleDefinition = {
  id: FeatureModuleId;
  title: string;
  description: string;
  href?: string;
  navPermission?: PermissionCode;
  navGroup?: FeatureNavGroup;
};

export const EXTERNAL_NAV_LINKS = [
  {
    id: "did-free-numbers",
    title: "Свободные номера",
    href: "https://did.finenumbers.com/",
  },
  {
    id: "pstn-numbering",
    title: "Ресурс нумерации",
    href: "https://pstn.finenumbers.com/",
  },
] as const;

export const FEATURE_MODULES: FeatureModuleDefinition[] = [
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
    id: "enrich",
    title: "Обогатить данные",
    description: "Обогащение CDR: описания, PSTN и GeoIP → XLSX",
    href: "/enrich",
    navPermission: "phones:read",
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
    title: "АнтиФрод",
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
    id: "settings",
    title: "Настройки",
    description: "SSH-профиль, интервал опроса, месяцы CDR",
    href: "/settings",
    navPermission: "settings:write",
    navGroup: "admin",
  },
  {
    id: "tariffs",
    title: "Тарификация",
    description: "Направления, ABC, цена и себестоимость из XLSX",
    href: "/tariffs",
    navPermission: "phones:read",
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
