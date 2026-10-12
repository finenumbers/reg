/** App pool only. The migrator process does not use this config. */
export const APP_POOL_LOCK_TIMEOUT_MS = 5000;
export const APP_POOL_CONNECT_TIMEOUT_MS = 10_000;

export function appPoolOptions(connectionString: string): {
  connectionString: string;
  connectionTimeoutMillis: number;
  options: string;
} {
  return {
    connectionString,
    connectionTimeoutMillis: APP_POOL_CONNECT_TIMEOUT_MS,
    options: `-c lock_timeout=${APP_POOL_LOCK_TIMEOUT_MS}`,
  };
}
