import type { PermissionCode } from "@/modules/rbac/permissions";

/**
 * Feature module registry — platform core + product modules.
 */

export type FeatureModuleId =
  | "settings"
  | "jobs"
  | "registrations"
  | "phones"
  | "groups"
  | "raw"
  | "traffic"
  | "geography"
  | "operators"
  | "audit"
  | "enrich";

export type FeatureNavGroup = "primary" | "cdr" | "admin";

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
    id: "settings",
    title: "Настройки",
    description: "SSH-профиль, интервал опроса, хранение артефактов",
    href: "/settings",
    navPermission: "settings:write",
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
