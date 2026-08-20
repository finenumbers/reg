/**
 * Registrations module — shared types for API/UI.
 */

export type RegistrationListItem = {
  phone: string;
  /** From phone_endpoints.data["Описание"] when endpoint number matches */
  description: string | null;
  status: "Registered" | "Unregistered";
  ip: string | null;
  port: number | null;
  country: string | null;
  city: string | null;
  isp: string | null;
  lastSeenAt: string | null;
  lastChangedAt: string | null;
};

export type RegistrationHistoryItem = {
  id: string;
  phone: string;
  oldStatus: string | null;
  newStatus: string;
  oldIp: string | null;
  newIp: string | null;
  oldPort: number | null;
  newPort: number | null;
  changedAt: string;
};

export type RegsPollStatus = {
  lastJobStatus: "success" | "failed" | "running" | "never" | null;
  lastError: string | null;
  lastFinishedAt: string | null;
  pollEnabled: boolean;
};
