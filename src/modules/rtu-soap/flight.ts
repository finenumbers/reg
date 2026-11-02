let locked = false;

/** One access check at a time in this process. */
export function acquireRtuSoapTest(): boolean {
  if (locked) return false;
  locked = true;
  return true;
}

export function releaseRtuSoapTest(): void {
  locked = false;
}
