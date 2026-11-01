"use client";

import { useCallback, useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { emptyPhoneMask } from "@/modules/numbering-resource/format";
import { cn } from "@/lib/utils";

const SLOT_COUNT = 10;
const EMPTY = "_";

type Props = {
  labelledBy: string;
  value: string;
  onChange: (value: string) => void;
};

function slotsOf(value: string): string[] {
  const source = value.length === SLOT_COUNT ? value : emptyPhoneMask();
  return source.split("").map((char) => (/\d/.test(char) ? char : EMPTY));
}

export function PhoneMaskInput({ labelledBy, value, onChange }: Props) {
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

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
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

  const renderSlot = (index: number) => {
    const filled = slots[index] !== EMPTY;
    return (
      <input
        key={index}
        ref={(el) => {
          inputRefs.current[index] = el;
        }}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={1}
        aria-label={`Цифра ${index + 1}`}
        value={filled ? slots[index] : ""}
        placeholder="X"
        onChange={(event) => handleSlotChange(index, event.target.value)}
        onKeyDown={(event) => handleKeyDown(index, event)}
        onFocus={(event) => event.currentTarget.select()}
        className={cn(
          "border-input placeholder:text-muted-foreground/40 focus-visible:ring-ring h-7 min-w-0 flex-1 rounded border text-center text-xs shadow-sm focus-visible:ring-1 focus-visible:outline-none",
          filled ? "bg-yellow-200/80 text-black" : "bg-background",
        )}
      />
    );
  };

  return (
    <div
      className="w-full min-w-0"
      role="group"
      aria-labelledby={labelledBy}
      onPaste={handlePaste}
    >
      <div className="flex w-full items-center gap-px text-sm leading-none tabular-nums">
        <span className="text-muted-foreground shrink-0 px-0.5 text-sm" aria-hidden>
          (
        </span>
        {renderSlot(0)}
        {renderSlot(1)}
        {renderSlot(2)}
        <span
          className="text-muted-foreground mr-0.5 shrink-0 px-0.5 text-sm"
          aria-hidden
        >
          )
        </span>
        {renderSlot(3)}
        {renderSlot(4)}
        {renderSlot(5)}
        <span className="text-muted-foreground shrink-0 px-0.5 text-sm" aria-hidden>
          -
        </span>
        {renderSlot(6)}
        {renderSlot(7)}
        <span className="text-muted-foreground shrink-0 px-0.5 text-sm" aria-hidden>
          -
        </span>
        {renderSlot(8)}
        {renderSlot(9)}
      </div>
    </div>
  );
}
