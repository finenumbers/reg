export * from "@/modules/settings/schemas";
export {
  getSettingsView,
  getDisplayTimezone,
  updateSettings,
  replaceSshPrivateKey,
  replaceGeoipApiKey,
  replacePstnApiKey,
  replaceFtpPassword,
  replaceVoipmonitorPassword,
  replaceRtuSoapPassword,
  replaceZabbixPassword,
} from "@/modules/settings/service";
