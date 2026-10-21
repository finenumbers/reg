export type ParkingKeyStatus = {
  configured: boolean;
  fingerprint: string | null;
  algo: string | null;
  host: string;
  username: string;
  logPath: string;
};
