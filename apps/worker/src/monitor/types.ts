export type CheckOutcome = {
  status: 'up' | 'down' | 'unknown';
  latencyMs: number | null;
  error: string | null;
  httpStatus: number | null;
  attempts: number;
};
