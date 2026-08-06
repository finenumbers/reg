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
  | "audit"
  | "health";

export type FeatureModuleDefinition = {
  id: FeatureModuleId;
  title: string;
  description: string;
  href?: string;
  navPermission?: PermissionCode;
  status: "scaffold" | "active";
};

export const FEATURE_MODULES: FeatureModuleDefinition[] = [
  {
    id: "phones",
    title: "Телефонные номера",
    description: "Оконечное оборудование и шлюзы через phones.sync",
    href: "/phones",
    navPermission: "phones:read",
    status: "active",
  },
  {
    id: "registrations",
    title: "Регистрации",
    description: "Мониторинг SIP-регистраций через regs.poll",
    href: "/regs",
    navPermission: "regs:read",
    status: "active",
  },
  {
    id: "settings",
    title: "Настройки",
    description: "SSH-профиль, интервал опроса, хранение артефактов",
    href: "/settings",
    navPermission: "settings:write",
    status: "active",
  },
  {
    id: "jobs",
    title: "Задачи",
    description: "История запусков и диагностика",
    href: "/jobs",
    navPermission: "regs:read",
    status: "active",
  },
  {
    id: "audit",
    title: "Аудит",
    description: "Журнал действий администраторов и операторов",
    href: "/audit",
    navPermission: "audit:read",
    status: "active",
  },
];

export function moduleStatusLabel(status: FeatureModuleDefinition["status"]): string {
  switch (status) {
    case "active":
      return "активно";
    case "scaffold":
      return "каркас";
    default:
      return status;
  }
}
