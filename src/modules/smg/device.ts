export const SMG_NO_DATA_DEVICE = "__no_data__";
export const SMG_NO_DATA_LABEL = "Нет данных";

export type SmgDeviceOption = {
  sign: string;
  name: string;
  count: number;
};

export type SmgSignCount = {
  sign: string;
  count: number;
};

export type SmgNodeName = {
  identifier: string | null;
  name: string;
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

function nodeIds(nodes: readonly SmgNodeName[]): Map<string, string> {
  const byId = new Map<string, string>();
  for (const node of nodes) {
    const id = node.identifier?.trim().toLowerCase() ?? "";
    if (!id || byId.has(id)) continue;
    byId.set(id, node.name);
  }
  return byId;
}

/**
 * Menu rows for one month. Node order is the settings order already on `nodes`.
 * A node with no calls is omitted. Unmatched signs, including a blank node,
 * share the last row.
 */
export function foldSmgDevices(
  grouped: readonly SmgSignCount[],
  nodes: readonly SmgNodeName[],
): SmgDeviceOption[] {
  const byId = nodeIds(nodes);
  const counts = new Map<string, number>();
  let noData = 0;
  for (const row of grouped) {
    const key = row.sign.trim().toLowerCase();
    if (!key || !byId.has(key)) {
      noData += row.count;
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + row.count);
  }
  const options: SmgDeviceOption[] = [];
  for (const [id, name] of byId) {
    const count = counts.get(id) ?? 0;
    if (count <= 0) continue;
    options.push({ sign: id, name, count });
  }
  if (noData > 0) {
    options.push({ sign: SMG_NO_DATA_DEVICE, name: SMG_NO_DATA_LABEL, count: noData });
  }
  return options;
}

/**
 * Exact stored signs for one menu value. A known identifier always includes
 * itself, so a new row with that sign is visible before the month census
 * refreshes. An unknown value matches nothing.
 */
export function smgDeviceSigns(
  grouped: readonly SmgSignCount[],
  nodes: readonly SmgNodeName[],
  device: string,
): string[] {
  const requested = device.trim();
  if (!requested) return [];
  const ids = nodeIds(nodes);
  if (requested === SMG_NO_DATA_DEVICE) {
    const signs = new Set<string>([""]);
    for (const row of grouped) {
      const key = row.sign.trim().toLowerCase();
      if (!key || !ids.has(key)) signs.add(row.sign);
    }
    return [...signs];
  }
  const id = requested.toLowerCase();
  if (!ids.has(id)) return [];
  const signs = new Set<string>([id]);
  for (const row of grouped) {
    if (row.sign.trim().toLowerCase() === id) signs.add(row.sign);
  }
  return [...signs];
}
