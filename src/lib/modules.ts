import type { PermissionCode } from "@/modules/rbac/permissions";

/**
 * Feature module registry — platform core + product modules.
 */

export type FeatureModuleId =
  | "auth"
  | "users"
  | "rbac"
  | "settings"
  | "ssh"
  | "actions"
  | "jobs"
  | "registrations"
  | "phones"
  | "groups"
  | "audit"
  | "health";

type FeatureModuleDefinition = {
  id: FeatureModuleId;
  title: string;
  description: string;
  href?: string;
  navPermission?: PermissionCode;
};

export const FEATURE_MODULES: FeatureModuleDefinition[] = [
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
    id: "registrations",
    title: "Регистрации",
    description: "Мониторинг SIP-регистраций через regs.poll",
    href: "/regs",
    navPermission: "regs:read",
  },
  {
    id: "settings",
    title: "Настройки",
    description: "SSH-профиль, интервал опроса, хранение артефактов",
    href: "/settings",
    navPermission: "settings:write",
  },
  {
    id: "jobs",
    title: "Задачи",
    description: "История запусков и диагностика",
    href: "/jobs",
    navPermission: "regs:read",
  },
  {
    id: "audit",
    title: "Аудит",
    description: "Журнал действий администраторов и операторов",
    href: "/audit",
    navPermission: "audit:read",
  },
];
