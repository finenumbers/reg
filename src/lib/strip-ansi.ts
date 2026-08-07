/** CSI / Fe escape sequences used by terminal colorizers. */
const ANSI_ESCAPE_PATTERN =
  // eslint-disable-next-line no-control-regex -- intentional: strip terminal control sequences
  /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|[\]PX^_][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;

/**
 * Remove ANSI / terminal escape sequences from script stdout (TTY mode).
 */
export function stripAnsi(input: string): string {
  return input.replace(ANSI_ESCAPE_PATTERN, "");
}
