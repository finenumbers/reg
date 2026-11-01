import { requirePagePermission } from "@/modules/auth/guards";
import {
  NumberingClientError,
  NumberingQueryError,
} from "@/modules/numbering-resource/errors";
import { EMPTY_NUMBERING_FILTERS } from "@/modules/numbering-resource/filters";
import {
  listNumberingResource,
  summarizeNumberingResource,
} from "@/modules/numbering-resource/service";
import type {
  ListNumberingResult,
  NumberingSummary,
} from "@/modules/numbering-resource/types";
import { NumberingResourceView } from "@/modules/numbering-resource/ui/numbering-resource-view";

export const dynamic = "force-dynamic";

const EMPTY_LIST: ListNumberingResult = {
  items: [],
  total: 0,
  hasMore: false,
  nextCursor: null,
};

function failureMessage(error: unknown): string {
  if (error instanceof NumberingClientError || error instanceof NumberingQueryError) {
    return error.message;
  }
  return "Не удалось прочитать ресурс нумерации.";
}

export default async function NumberingResourcePage() {
  await requirePagePermission("phones:read");

  const [listSettled, summarySettled] = await Promise.allSettled([
    listNumberingResource({ cursor: null, filters: EMPTY_NUMBERING_FILTERS }),
    summarizeNumberingResource(EMPTY_NUMBERING_FILTERS),
  ]);

  let initial = EMPTY_LIST;
  let initialError: string | null = null;
  if (listSettled.status === "fulfilled") initial = listSettled.value;
  else initialError = failureMessage(listSettled.reason);

  let initialSummary: NumberingSummary | null = null;
  let initialSummaryError: string | null = null;
  if (summarySettled.status === "fulfilled") initialSummary = summarySettled.value;
  else initialSummaryError = failureMessage(summarySettled.reason);

  return (
    <NumberingResourceView
      initial={initial}
      initialError={initialError}
      initialSummary={initialSummary}
      initialSummaryError={initialSummaryError}
    />
  );
}
