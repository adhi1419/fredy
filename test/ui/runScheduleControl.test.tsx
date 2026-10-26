/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunSchedule } from '../../ui/src/services/state/adminState.js';

let runSchedule: RunSchedule | null = null;

vi.mock('../../ui/src/services/state/store.js', () => ({
  useActions: () => ({ admin: { getRunSchedule: async () => {}, setRunSchedule: async () => {} } }),
  useSelector: (select: (state: { admin: { runSchedule: RunSchedule | null } }) => unknown) =>
    select({ admin: { runSchedule } }),
}));
vi.mock('../../ui/src/services/i18n/i18n.jsx', () => ({
  useTranslation: () => (key: string, params?: Record<string, string>) =>
    params ? `${key}(${Object.values(params).join(',')})` : key,
}));
vi.mock('@douyinfe/semi-ui-19', () => ({ Toast: { success: () => {}, error: () => {} } }));

const { default: RunScheduleControl } = await import('../../ui/src/views/admin/pages/RunScheduleControl.js');

const available = (intervalMinutes: RunSchedule['intervalMinutes'], schedule: string): RunSchedule => ({
  status: 'available',
  intervalMinutes,
  schedule,
  timeZone: 'Etc/UTC',
  choices: [5, 10, 15, 30, 60],
});

const render = () => renderToStaticMarkup(<RunScheduleControl />);

beforeEach(() => {
  runSchedule = null;
});

describe('RunScheduleControl rendering', () => {
  it('shows the current cadence, preselects it and offers only the fixed choices', () => {
    runSchedule = available(15, '*/15 * * * *');
    const html = render();
    expect(html).toContain('admin.schedule.current(15)');
    expect(html).toContain('<option value="15" selected="">');
    expect(html.match(/<option/g)).toHaveLength(5);
    expect(html).not.toContain('disabled');
  });

  it('is disabled until the job has been read', () => {
    const html = render();
    expect(html).toContain('admin.schedule.help');
    expect(html).toContain('disabled=""');
  });

  it('shows a hand-edited cron instead of a wrong number and lets the admin replace it', () => {
    runSchedule = available(null, '30 2 * * *');
    const html = render();
    expect(html).toContain('admin.schedule.customCron(30 2 * * *)');
    expect(html).toContain('<option value="" selected="">');
    expect(html).not.toContain('disabled');
  });

  it('explains when Google Cloud could not be read and does not offer a write', () => {
    runSchedule = { ...available(15, '*/15 * * * *'), status: 'unavailable', reason: 'Cloud Scheduler API 403' };
    const html = render();
    expect(html).toContain('admin.schedule.unavailable');
    expect(html).toContain('disabled=""');
  });
});
