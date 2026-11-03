/** Same fills as the phantom and parking rows in «Телефонный трафик». */
export const LIVE_CALL_ROW_CLASS = {
  phantom: "bg-green-200 hover:bg-green-300/90 dark:bg-green-950 dark:hover:bg-green-900",
  parking: "bg-blue-200 hover:bg-blue-300/90 dark:bg-blue-950 dark:hover:bg-blue-900",
} as const;

export type LiveCallTone = keyof typeof LIVE_CALL_ROW_CLASS;
