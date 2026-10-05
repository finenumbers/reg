/** Text on phone-search toolbars. Absolute 12px, same at every breakpoint. */
export const FILTER_TOOLBAR_TEXT = "text-[12px]";

/**
 * Search field. `md:` is required: Input sets `md:text-sm` (14px from 768px),
 * and an unprefixed `text-[12px]` does not override it.
 */
export const FILTER_TOOLBAR_INPUT = "text-[12px] md:text-[12px]";
