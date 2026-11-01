const YANDEX_MAPS_PREFIX = "https://yandex.ru/maps/?text=";
const DADATA_PARTY_PREFIX = "https://dadata.ru/find/party/";

/** Browsers reject very long hrefs. Keep a margin under common limits. */
export const YANDEX_MAPS_URL_MAX_LENGTH = 2000;

/** Yandex search link. The address is only a query value. */
export function yandexMapsUrl(address: string | null | undefined): string | null {
  const text = address?.trim();
  if (!text) return null;
  const url = `${YANDEX_MAPS_PREFIX}${encodeURIComponent(text)}`;
  if (url.length > YANDEX_MAPS_URL_MAX_LENGTH) return null;
  if (!url.startsWith(YANDEX_MAPS_PREFIX)) return null;
  return url;
}

/** Public DaData company card. Only a 10-digit or 12-digit INN. */
export function dadataPartyUrl(inn: string | null | undefined): string | null {
  const digits = inn?.trim() ?? "";
  if (!/^\d{10}$/.test(digits) && !/^\d{12}$/.test(digits)) return null;
  return `${DADATA_PARTY_PREFIX}${digits}`;
}
