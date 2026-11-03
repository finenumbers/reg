/** Switch civil time. The mask digits are not shifted into another zone. */
export function presentSwitchValue(value: string, mask: string | null): string {
  if (mask === "YMDhms" && /^\d{14}$/.test(value)) {
    return (
      `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)} ` +
      `${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}`
    );
  }
  return value;
}
