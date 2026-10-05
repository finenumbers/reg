import { FILTER_TOOLBAR_INPUT } from "@/components/filter-toolbar";
import { Input } from "@/components/ui/input";

const PLACEHOLDER = "Телефонный номер";

type Props = {
  id: string;
  value: string;
  onChange: (value: string) => void;
};

/** Width is the placeholder plus equal horizontal padding. Typed text scrolls inside. */
export function PhoneSearchInput({ id, value, onChange }: Props) {
  return (
    <div className="relative inline-grid h-8 shrink-0">
      <span
        aria-hidden
        className={`invisible col-start-1 row-start-1 h-8 w-max border border-transparent px-2.5 py-1 whitespace-nowrap ${FILTER_TOOLBAR_INPUT}`}
      >
        {PLACEHOLDER}
      </span>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={PLACEHOLDER}
        aria-label={PLACEHOLDER}
        autoComplete="off"
        className={`absolute top-0 left-0 h-full w-full ${FILTER_TOOLBAR_INPUT}`}
      />
    </div>
  );
}
