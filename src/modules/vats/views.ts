export type VatsSettingsView = {
  baseUrl: string;
  login: string;
  hasPassword: boolean;
};

export type VatsCatalogs = {
  gateways: string[];
  routes: string[];
  dialplans: string[];
};
