import { gapRuns } from "@/modules/dashboard/antifraud-series";

/** Full-height wash for minutes that have no value. The rects do not take the pointer. */
export function ChartGapBands({ missing }: { missing: readonly boolean[] }) {
  return gapRuns(missing).map((run) => (
    <rect
      key={`${run.from}-${run.to}`}
      x={run.from}
      y={0}
      width={run.to - run.from}
      height={100}
      className="text-red-600 dark:text-red-400"
      fill="currentColor"
      fillOpacity={0.28}
      stroke="none"
      pointerEvents="none"
    />
  ));
}
