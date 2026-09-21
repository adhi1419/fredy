/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * The saved-search (job) domain state and effects used by the aggregate Zustand store.
 *
 * Requests are injected by the aggregate store and use its existing xhr adapter. This keeps the
 * domain responsible for job data and status behavior without creating a second authenticated
 * transport implementation.
 */

export interface Job {
  id: string;
  userId?: string;
  name?: string | null;
  enabled?: boolean;
  blacklist?: unknown[];
  provider?: unknown[];
  notificationAdapter?: unknown[];
  shared_with_user?: string[];
  spatialFilter?: unknown | null;
  specFilter?: unknown | null;
  commuteFilter?: unknown | null;
  dealType?: 'rent' | 'buy' | null;
  autoSendInquiry?: boolean;
  numberOfFoundListings?: number;
  lastRunAt?: number | null;
  /**
   * Number of listings from this search whose external inquiry outcome is unknown and awaiting
   * manual review. The idempotent run contract never retries an unknown outcome blindly, so the
   * saved-search row surfaces this as a warning health line instead of "Ready".
   *
   * Optional and aggregate: the jobs API may not send it yet. When absent the row falls back to the
   * existing run-health line rather than fabricating a count.
   */
  manualReviewCount?: number | null;
  running?: boolean;
  isOnlyShared?: boolean;
  [key: string]: unknown;
}

export interface ShareableUser {
  id: string;
  name: string;
}

export interface JobsDataState {
  jobs: readonly Job[];
  shareableUserList: readonly ShareableUser[];
  totalNumber: number;
  page: number;
  result: readonly Job[];
  [key: string]: unknown;
}

export interface JobsRootState {
  jobsData: JobsDataState;
}

export interface JobsResponse {
  status: number;
  json: unknown;
}

export interface JobsTransport {
  get(url: string): Promise<JobsResponse>;
}

export type JobsQueryStringify = (query: Record<string, unknown>) => string;

export interface JobsStateSetter {
  (updater: (state: JobsRootState) => Partial<JobsRootState>): void;
}

export interface JobsDataQuery {
  page?: number;
  pageSize?: number;
  freeTextFilter?: string | null;
  sortfield?: string | null;
  sortdir?: string;
  filter?: Record<string, unknown>;
}

export interface JobsDataResponse {
  totalNumber?: number;
  page?: number;
  result?: readonly Job[];
  [key: string]: unknown;
}

export interface JobsEffects {
  getJobs(): Promise<void>;
  getJobsData(params?: JobsDataQuery): Promise<void>;
  getSharableUserList(): Promise<void>;
  setJobRunning(jobId: string, running: boolean): void;
}

export function createJobsDataState(): JobsDataState {
  return {
    jobs: [],
    shareableUserList: [],
    totalNumber: 0,
    page: 1,
    result: [],
  };
}

export function createJobsEffects(
  set: JobsStateSetter,
  transport: JobsTransport,
  stringify: JobsQueryStringify,
): JobsEffects {
  return {
    async getJobs() {
      try {
        const response = await transport.get('/api/jobs');
        set((state) => ({
          jobsData: { ...state.jobsData, jobs: Object.freeze(asJobs(response.json)) },
        }));
      } catch (exception) {
        console.error('Error while trying to get resource for api/jobs. Error:', exception);
      }
    },

    async getJobsData({
      page = 1,
      pageSize = 20,
      freeTextFilter = null,
      sortfield = null,
      sortdir = 'asc',
      filter,
    } = {}) {
      try {
        const query = stringify({
          page,
          pageSize,
          freeTextFilter,
          sortfield,
          sortdir,
          ...(filter ?? {}),
        });
        const response = await transport.get(`/api/jobs/data?${query}`);
        set((state) => ({
          jobsData: { ...state.jobsData, ...asJobsDataResponse(response.json) },
        }));
      } catch (exception) {
        console.error('Error while trying to get resource for api/jobs/data. Error:', exception);
      }
    },

    async getSharableUserList() {
      try {
        const response = await transport.get('/api/jobs/shareableUserList');
        set((state) => ({
          jobsData: { ...state.jobsData, shareableUserList: Object.freeze(asShareableUsers(response.json)) },
        }));
      } catch (exception) {
        console.error('Error while trying to get resource for api/jobs. Error:', exception);
      }
    },

    setJobRunning(jobId, running) {
      if (!jobId) return;
      set((state) => {
        const updatedJobs = state.jobsData.jobs.map((job) =>
          job.id === jobId ? { ...job, running: Boolean(running) } : job,
        );
        const updatedResult = state.jobsData.result.map((job) =>
          job.id === jobId ? { ...job, running: Boolean(running) } : job,
        );
        return {
          jobsData: {
            ...state.jobsData,
            jobs: Object.freeze(updatedJobs),
            result: Object.freeze(updatedResult),
          },
        };
      });
    },
  };
}

function asJobs(value: unknown): Job[] {
  return Array.isArray(value) ? (value as Job[]) : [];
}

function asShareableUsers(value: unknown): ShareableUser[] {
  return Array.isArray(value) ? (value as ShareableUser[]) : [];
}

function asJobsDataResponse(value: unknown): JobsDataResponse {
  return isRecord(value) ? (value as JobsDataResponse) : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
