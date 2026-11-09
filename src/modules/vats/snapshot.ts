export type StoredNameList = {
  origin: string;
  names: string[];
};

/**
 * An empty or unreadable list never replaces a non-empty one, including a list
 * read from another host. That older list stays stored and is hidden in the UI.
 */
export function nextNameList(
  stored: StoredNameList | null,
  origin: string,
  names: string[] | null,
): StoredNameList | null {
  if (names == null) return stored;
  if (names.length === 0 && stored && stored.names.length > 0) return stored;
  return { origin, names };
}

export function keptPreviousList(
  stored: StoredNameList | null,
  names: string[] | null,
): boolean {
  return names != null && names.length === 0 && Boolean(stored && stored.names.length > 0);
}
