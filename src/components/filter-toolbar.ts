/** Text on phone-search toolbars. Absolute 13px, same at every breakpoint. */
export const FILTER_TOOLBAR_TEXT = "text-[13px]";

/**
 * Search field. `md:` is required: Input sets `md:text-sm` (14px from 768px),
 * and an unprefixed `text-[13px]` does not override it.
 */
export const FILTER_TOOLBAR_INPUT = "text-[13px] md:text-[13px]";
