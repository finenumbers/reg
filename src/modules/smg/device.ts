export type SmgDeviceOption = {
  sign: string;
  count: number;
};

/**
 * Keep the requested node when it is in this month's list.
 * Otherwise the first row, which the query already ordered.
 * An empty list selects nothing: the page must not fall open onto every gateway.
 */
export function pickSmgDevice(
  devices: readonly { sign: string }[],
  requested: string | undefined,
): string {
  const name = requested?.trim() ?? "";
  if (name && devices.some((device) => device.sign === name)) return name;
  return devices[0]?.sign ?? "";
}
