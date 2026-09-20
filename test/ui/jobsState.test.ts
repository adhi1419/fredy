/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it, vi } from 'vitest';

import { createJobsDataState, createJobsEffects, type JobsStateSetter } from '../../ui/src/services/state/jobsState.js';

function setup() {
  const state = { jobsData: createJobsDataState() };
  const get = vi.fn();
  const stringify = vi.fn(() => 'encoded-query');
  const set: JobsStateSetter = (updater) => Object.assign(state, updater(state));
  const effects = createJobsEffects(set, { get }, stringify);
  return { state, get, stringify, effects };
}

const job = {
  id: 'job-1',
  name: 'Berlin search',
  enabled: true,
  provider: [{ id: 'immoscout', url: 'https://example.test/search' }],
  notificationAdapter: [{ configuredAdapterId: 'channel-1' }],
  shared_with_user: [],
  running: false,
};

describe('jobs state domain', () => {
  it('starts with the aggregate store saved-search fields', () => {
    expect(createJobsDataState()).toEqual({
      jobs: [],
      shareableUserList: [],
      totalNumber: 0,
      page: 1,
      result: [],
    });
  });

  it('loads the saved-search list through the existing endpoint', async () => {
    const { state, get, effects } = setup();
    get.mockResolvedValue({ status: 200, json: [job] });

    await effects.getJobs();

    expect(get).toHaveBeenCalledWith('/api/jobs');
    expect(state.jobsData.jobs).toEqual([job]);
    expect(Object.isFrozen(state.jobsData.jobs)).toBe(true);
  });

  it('keeps pagination, sorting, filtering, and response fields intact', async () => {
    const { state, get, stringify, effects } = setup();
    const response = { totalNumber: 1, page: 3, result: [job] };
    get.mockResolvedValue({ status: 200, json: response });

    await effects.getJobsData({
      page: 3,
      pageSize: 12,
      freeTextFilter: 'berlin',
      sortfield: 'name',
      sortdir: 'desc',
      filter: { activityFilter: false },
    });

    expect(stringify).toHaveBeenCalledWith({
      page: 3,
      pageSize: 12,
      freeTextFilter: 'berlin',
      sortfield: 'name',
      sortdir: 'desc',
      activityFilter: false,
    });
    expect(get).toHaveBeenCalledWith('/api/jobs/data?encoded-query');
    expect(state.jobsData).toMatchObject(response);
  });

  it('loads the shareable-user list through its existing endpoint', async () => {
    const { state, get, effects } = setup();
    const users = [{ id: 'user-2', name: 'Other user' }];
    get.mockResolvedValue({ status: 200, json: users });

    await effects.getSharableUserList();

    expect(get).toHaveBeenCalledWith('/api/jobs/shareableUserList');
    expect(state.jobsData.shareableUserList).toEqual(users);
    expect(Object.isFrozen(state.jobsData.shareableUserList)).toBe(true);
  });

  it('updates running status in both the full list and current page', () => {
    const { state, effects } = setup();
    const secondJob = { ...job, id: 'job-2', running: false };
    state.jobsData.jobs = [job, secondJob];
    state.jobsData.result = [job];

    effects.setJobRunning('job-1', true);

    expect(state.jobsData.jobs).toEqual([{ ...job, running: true }, secondJob]);
    expect(state.jobsData.result).toEqual([{ ...job, running: true }]);
    expect(Object.isFrozen(state.jobsData.jobs)).toBe(true);
    expect(Object.isFrozen(state.jobsData.result)).toBe(true);
  });
});
