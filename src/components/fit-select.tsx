import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const SIZER =
  "invisible col-start-1 row-start-1 h-8 w-max border border-transparent py-0 pr-8 pl-2.5 whitespace-nowrap";

export type FitSelectOption = {
  value: string;
  label: string;
};

type Props = {
  id: string;
  value: string;
  options: readonly FitSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  "aria-label": string;
  textClassName: string;
};

/**
 * Closed width is the widest option in pixels, plus the left padding and the
 * arrow slot. The select is out of flow so its native arrow gutter cannot grow it.
 */
export function FitSelect({
  id,
  value,
  options,
  onChange,
  disabled,
  "aria-label": ariaLabel,
  textClassName,
}: Props) {
  return (
    <div className={cn("relative inline-grid h-8 shrink-0", disabled && "opacity-60")}>
      {options.map((option) => (
        <span key={option.value} aria-hidden className={cn(SIZER, textClassName)}>
          {option.label}
        </span>
      ))}
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "border-border bg-background focus-visible:border-ring focus-visible:ring-ring/50 absolute top-0 left-0 h-full w-full appearance-none rounded-lg border py-0 pr-8 pl-2.5 outline-none focus-visible:ring-3",
          textClassName,
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon
        aria-hidden
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-2 z-10 size-4 -translate-y-1/2"
      />
    </div>
  );
}
