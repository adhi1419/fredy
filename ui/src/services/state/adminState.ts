/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/** One row of `access_requests`, as the API returns it. */
export interface AccessRequest {
  email: string;
  displayName: string | null;
  uid: string;
  requestedAt: number;
  status: 'pending' | 'declined';
  decidedAt: number | null;
}

export interface MonitoringCounters {
  newListings: number;
  providerConfirmed: number;
  manualApplied: number;
  retryableFailures: number;
  terminalFailures: number;
  unknownFailures: number;
  notAttempted: number;
}

export interface MonitoringBucket {
  start: number;
  end: number;
  activeListings: number;
  counters: MonitoringCounters;
  sampled: boolean;
}

export interface MonitoringCostValue {
  status: 'available' | 'estimated' | 'not-configured' | 'unavailable';
  amount: number | null;
  currency: string | null;
  through?: number | null;
  basedOnActualThrough?: number | null;
  reason?: string;
}

export interface MonitoringOverview {
  generatedAt: number;
  range: { start: number; end: number; monthStart: number };
  filters: {
    jobs: readonly { id: string; name: string }[];
    providers: readonly { id: string; name: string }[];
  };
  cost: {
    project: { actual: MonitoringCostValue; estimate: MonitoringCostValue };
    runtime: { actual: MonitoringCostValue; estimate: MonitoringCostValue };
  };
  consumption: {
    status: string;
    reason?: string | null;
    cloudRun: { requests: number; billableInstanceSeconds: number; vCpuSeconds: number; gibibyteSeconds: number };
    firestore: { reads: number; writes: number; deletes: number; storageBytes: number };
  };
  buckets: readonly MonitoringBucket[];
  overhead: {
    providerPass: { reads: number; writesNormally: number; writesWhenActiveCountChanges: number };
    refresh: { rollupReads: number; externalApiCalls: number };
  };
}

export interface MonitoringRun {
  id: string;
  executionId: string;
  jobId: string;
  jobName: string;
  providerId: string;
  providerName: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  outcome: string;
  errorType: string | null;
  counters: MonitoringCounters;
}

export type MonitoringListingStatus =
  'provider-confirmed' | 'manual-applied' | 'retryable' | 'terminal' | 'unknown' | 'not-attempted' | 'stored-only';

/** One listing-level result returned for a selected monitoring bucket. */
export interface MonitoringListingOutcome {
  listingId: string;
  happenedAt: number;
  jobId: string;
  jobName: string;
  providerId: string;
  providerName: string;
  stored: boolean;
  outcome: MonitoringListingStatus;
  reason: string | null;
  title: string | null;
  providerUrl: string | null;
}

export type MonitoringListing = MonitoringListingOutcome;

export type MonitoringGranularity = 'provider' | 'listing';
/** The default ledger view keeps the existing provider-run table first. */
export const DEFAULT_MONITORING_GRANULARITY: MonitoringGranularity = 'provider';

/** Switches the selected ledger between provider runs and listing outcomes. */
export function toggleMonitoringGranularity(value: MonitoringGranularity): MonitoringGranularity {
  return value === 'provider' ? 'listing' : 'provider';
}

/** Returns the internal route for a listing detail page. */
export function monitoringListingPath(listingId: string): string {
  return `/listings/listing/${encodeURIComponent(listingId)}`;
}

/** Uses the localized fallback for listings removed before the ledger was read. */
export function monitoringListingTitle(listing: Pick<MonitoringListing, 'title'>, unavailable: string): string {
  return listing.title ?? unavailable;
}

/** Detects application failures recorded inside an otherwise completed provider run. */
export function monitoringRunHasFailures(run: Pick<MonitoringRun, 'counters'>): boolean {
  const { retryableFailures, terminalFailures, unknownFailures } = run.counters;
  return retryableFailures + terminalFailures + unknownFailures > 0;
}

/** Returns the display outcome for a run, including failures hidden by a completed status. */
export function monitoringRunOutcome(run: MonitoringRun): string {
  if (run.outcome === 'completed' && monitoringRunHasFailures(run)) return 'completed-with-issues';
  return run.errorType ?? run.outcome;
}

export interface MonitoringQuery {
  start: number;
  end: number;
  monthStart?: number;
  jobId?: string | null;
  providerId?: string | null;
}

/** The cadences the admin Schedule control offers, in minutes; mirrors the API's fixed list. */
export type RunIntervalMinutes = 5 | 10 | 15 | 30 | 60;

/** How often the hosted scheduler triggers a search, as read from the Cloud Scheduler job. */
export interface RunSchedule {
  status: 'available' | 'unavailable';
  /** Null when the job carries a cron expression Fredy did not write. */
  intervalMinutes: RunIntervalMinutes | null;
  schedule: string | null;
  timeZone: string | null;
  choices: readonly RunIntervalMinutes[];
  reason?: string;
}

export interface AdminState {
  admin: {
    accessRequests: readonly AccessRequest[];
    accessRequestsLoaded: boolean;
    monitoring: MonitoringOverview | null;
    monitoringRuns: readonly MonitoringRun[];
    /** Listing-level outcomes are absent until the first selected bucket is loaded. */
    monitoringListings?: readonly MonitoringListing[];
    /** True when storage or response bounds omitted older listing outcomes. */
    monitoringListingsTruncated?: boolean;
    monitoringLoaded: boolean;
    /** Null until the Schedule control has read the Cloud Scheduler job. */
    runSchedule: RunSchedule | null;
  };
}

export interface AdminResponse<T> {
  status: number;
  json: T;
}

export interface AdminTransport {
  get<T>(url: string): Promise<AdminResponse<T>>;
  post<T>(url: string, data: unknown): Promise<AdminResponse<T>>;
  delete<T>(url: string): Promise<AdminResponse<T>>;
}

export interface AdminStateSetter {
  (updater: (state: AdminState) => Partial<AdminState>): void;
}

export interface AdminEffects {
  getAccessRequests(): Promise<void>;
  approveAccessRequest(email: string): Promise<void>;
  declineAccessRequest(email: string): Promise<void>;
  removeAccessRequest(email: string): Promise<void>;
  getMonitoring(query: MonitoringQuery): Promise<void>;
  getMonitoringRuns(query: MonitoringQuery): Promise<void>;
  getRunSchedule(): Promise<void>;
  /** Writes the cadence to the Cloud Scheduler job and stores what the job reports back. */
  setRunSchedule(intervalMinutes: RunIntervalMinutes): Promise<void>;
}

export function createAdminState(): AdminState {
  return {
    admin: {
      accessRequests: [],
      accessRequestsLoaded: false,
      monitoring: null,
      monitoringRuns: [],
      monitoringLoaded: false,
      runSchedule: null,
    },
  };
}

/** Pending first (oldest at the top), declined after. */
export function orderAccessRequests(requests: readonly AccessRequest[]): AccessRequest[] {
  const rank = (request: AccessRequest) => (request.status === 'pending' ? 0 : 1);
  return [...requests].sort((a, b) => rank(a) - rank(b) || a.requestedAt - b.requestedAt);
}

const ACCESS_BASE = '/api/admin/access-requests';
const MONITORING_BASE = '/api/admin/monitoring';
export const SCHEDULE_PATH = '/api/admin/schedule';

export function accessRequestPath(email: string, action?: 'approve' | 'decline'): string {
  const base = `${ACCESS_BASE}/${encodeURIComponent(email)}`;
  return action ? `${base}/${action}` : base;
}

export function monitoringPath(query: MonitoringQuery, runs = false): string {
  const params = new URLSearchParams({ start: String(query.start), end: String(query.end) });
  if (query.monthStart != null) params.set('monthStart', String(query.monthStart));
  if (query.jobId) params.set('jobId', query.jobId);
  if (query.providerId) params.set('providerId', query.providerId);
  return `${MONITORING_BASE}${runs ? '/runs' : ''}?${params.toString()}`;
}

export function createAdminEffects(set: AdminStateSetter, transport: AdminTransport): AdminEffects {
  async function getAccessRequests(): Promise<void> {
    const response = await transport.get<{ requests: readonly AccessRequest[] }>(ACCESS_BASE);
    set((state) => ({
      admin: { ...state.admin, accessRequests: [...response.json.requests], accessRequestsLoaded: true },
    }));
  }

  return {
    getAccessRequests,
    async approveAccessRequest(email) {
      await transport.post(accessRequestPath(email, 'approve'), {});
      await getAccessRequests();
    },
    async declineAccessRequest(email) {
      await transport.post(accessRequestPath(email, 'decline'), {});
      await getAccessRequests();
    },
    async removeAccessRequest(email) {
      await transport.delete(accessRequestPath(email));
      await getAccessRequests();
    },
    async getMonitoring(query) {
      const response = await transport.get<MonitoringOverview>(monitoringPath(query));
      set((state) => ({ admin: { ...state.admin, monitoring: response.json, monitoringLoaded: true } }));
    },
    async getMonitoringRuns(query) {
      const response = await transport.get<{
        runs: readonly MonitoringRun[];
        listings: readonly MonitoringListingOutcome[];
        listingsTruncated?: boolean;
      }>(monitoringPath(query, true));
      set((state) => ({
        admin: {
          ...state.admin,
          monitoringRuns: [...response.json.runs],
          monitoringListings: [...(response.json.listings ?? [])],
          monitoringListingsTruncated: response.json.listingsTruncated === true,
        },
      }));
    },
    async getRunSchedule() {
      const response = await transport.get<RunSchedule>(SCHEDULE_PATH);
      set((state) => ({ admin: { ...state.admin, runSchedule: response.json } }));
    },
    async setRunSchedule(intervalMinutes) {
      const response = await transport.post<RunSchedule>(SCHEDULE_PATH, { intervalMinutes });
      set((state) => ({ admin: { ...state.admin, runSchedule: response.json } }));
    },
  };
}
