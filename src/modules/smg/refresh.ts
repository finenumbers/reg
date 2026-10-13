export type SmgRefreshDecision = {
  reload: boolean;
  since: string | null;
};

/**
 * A poll with no baseline never reloads. `baselineEmpty` is the page that
 * rendered before any completed smg.import. A failed status leaves the cursor.
 * `changed` is true only when an import inserted rows or bad lines.
 */
export function decideSmgRefresh(input: {
  ok: boolean;
  since: string | null;
  cursor: string | null;
  changed: boolean;
  baselineEmpty?: boolean;
}): SmgRefreshDecision {
  if (!input.ok) return { reload: false, since: input.since };
  const hasBaseline = input.since != null || input.baselineEmpty === true;
  return {
    reload: hasBaseline && input.changed,
    since: input.cursor ?? input.since,
  };
}
