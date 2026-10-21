/** Bump when stored antifraud labels must be recomputed from card text. */
export const AF_LABEL_REVISION = 2;

export const LABEL_DEVICE = "@labels";
export const LABEL_FILE_KEY = "@revision";
export const LABEL_BATCH = 200;

export type LabelMark = {
  revision: number;
  cursor: string;
  done: boolean;
};

export function openLabelMark(raw: unknown): LabelMark {
  if (!raw || typeof raw !== "object") return freshMark();
  const row = raw as { revision?: unknown; cursor?: unknown; done?: unknown };
  if (row.revision !== AF_LABEL_REVISION) return freshMark();
  return {
    revision: AF_LABEL_REVISION,
    cursor: typeof row.cursor === "string" ? row.cursor : "",
    done: row.done === true,
  };
}

export function advanceLabelMark(
  mark: LabelMark,
  ids: readonly string[],
  batchSize: number,
): LabelMark {
  const cursor = ids.at(-1) ?? mark.cursor;
  if (ids.length < batchSize) return { revision: mark.revision, cursor, done: true };
  return { revision: mark.revision, cursor, done: false };
}

function freshMark(): LabelMark {
  return { revision: AF_LABEL_REVISION, cursor: "", done: false };
}
