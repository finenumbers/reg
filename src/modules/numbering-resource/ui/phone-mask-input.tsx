"use client";

import { useCallback, useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { FILTER_TOOLBAR_INPUT, FILTER_TOOLBAR_TEXT } from "@/components/filter-toolbar";
import { emptyPhoneMask } from "@/modules/numbering-resource/format";
import { cn } from "@/lib/utils";

const SLOT_COUNT = 10;
const EMPTY = "_";

type Props = {
  id: string;
  value: string;
  onChange: (value: string) => void;
};

function slotsOf(value: string): string[] {
  const source = value.length === SLOT_COUNT ? value : emptyPhoneMask();
  return source.split("").map((char) => (/\d/.test(char) ? char : EMPTY));
}

export function PhoneMaskInput({ id, value, onChange }: Props) {
  const slots = slotsOf(value);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const emit = useCallback(
    (next: string[]) => {
      onChange(next.join(""));
    },
    [onChange],
  );

  const focusSlot = (index: number) => {
    const el = inputRefs.current[index];
    if (!el) return;
    el.focus();
    el.select();
  };

  const handleSlotChange = (index: number, raw: string) => {
    const digit = raw.replace(/\D/g, "").slice(-1);
    const next = [...slots];
    next[index] = digit || EMPTY;
    emit(next);
    if (digit && index < SLOT_COUNT - 1) focusSlot(index + 1);
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && slots[index] === EMPTY && index > 0) {
      event.preventDefault();
      const next = [...slots];
      next[index - 1] = EMPTY;
      emit(next);
      focusSlot(index - 1);
      return;
    }
    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      focusSlot(index - 1);
      return;
    }
    if (event.key === "ArrowRight" && index < SLOT_COUNT - 1) {
      event.preventDefault();
      focusSlot(index + 1);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = event.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, SLOT_COUNT);
    if (!pasted) return;
    const next = [...slots];
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i]!;
    emit(next);
    focusSlot(Math.min(pasted.length, SLOT_COUNT - 1));
  };

  const groups = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7],
    [8, 9],
  ];

  return (
    <div className={cn("flex items-center gap-2", FILTER_TOOLBAR_TEXT)}>
      <label htmlFor={id} className="shrink-0">
        Найти номер
      </label>
      <div className="flex items-center gap-1">
        {groups.map((group, groupIndex) => (
          <div key={group.join("-")} className="flex items-center gap-0.5">
            {groupIndex > 0 ? (
              <span className="text-muted-foreground px-0.5" aria-hidden>
                {groupIndex === 1 ? "" : "-"}
              </span>
            ) : null}
            {group.map((index) => (
              <input
                key={index}
                id={index === 0 ? id : undefined}
                ref={(el) => {
                  inputRefs.current[index] = el;
                }}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={1}
                aria-label={`Цифра ${index + 1}`}
                value={slots[index] === EMPTY ? "" : slots[index]}
                placeholder="X"
                onChange={(event) => handleSlotChange(index, event.target.value)}
                onKeyDown={(event) => handleKeyDown(index, event)}
                onPaste={handlePaste}
                onFocus={(event) => event.currentTarget.select()}
                className={cn(
                  FILTER_TOOLBAR_INPUT,
                  "border-input bg-background placeholder:text-muted-foreground/40 focus-visible:ring-ring h-7 w-6 rounded border text-center shadow-sm focus-visible:ring-1 focus-visible:outline-none",
                )}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
