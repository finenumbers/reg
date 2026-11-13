/** The lease moved or the walk was cancelled before publish. */
export class SyncLost extends Error {
  constructor() {
    super("sync lost");
    this.name = "SyncLost";
  }
}

/** Another walk still holds a fresh lease. */
export class SyncBusy extends Error {
  constructor() {
    super("sync busy");
    this.name = "SyncBusy";
  }
}
