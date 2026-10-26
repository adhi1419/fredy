/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import React, { useEffect, useState } from 'react';
import { Toast } from '@douyinfe/semi-ui-19';
import { useTranslation } from '../../../services/i18n/i18n.jsx';
import { type AdminEffects, type AdminState, type RunIntervalMinutes } from '../../../services/state/adminState.js';
import { useActions, useSelector } from '../../../services/state/store.js';

interface ScheduleActions {
  admin: AdminEffects;
}

/**
 * How often Fredy searches. Reads the Cloud Scheduler job on mount and writes a new cadence to it
 * the moment one is picked; there is no separate save step because the select *is* the setting and
 * the job reports back what it stored.
 */
export default function RunScheduleControl(): React.JSX.Element {
  const t = useTranslation();
  const actions = useActions() as ScheduleActions;
  const schedule = useSelector((state: AdminState) => state.admin.runSchedule);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    actions.admin.getRunSchedule().catch(() => Toast.error(t('admin.schedule.loadFailed')));
  }, [actions, t]);

  const onChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const minutes = Number(event.target.value) as RunIntervalMinutes;
    setSaving(true);
    try {
      await actions.admin.setRunSchedule(minutes);
      Toast.success(t('admin.schedule.saved', { minutes: String(minutes) }));
    } catch {
      Toast.error(t('admin.schedule.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const choices = schedule?.choices ?? [5, 10, 15, 30, 60];
  const current = schedule?.intervalMinutes ?? null;
  const unavailable = schedule != null && schedule.status === 'unavailable';

  return (
    <section className="monitoring__schedule" aria-labelledby="monitoring-schedule-heading">
      <div className="monitoring__scheduleText">
        <h2 id="monitoring-schedule-heading">{t('admin.schedule.title')}</h2>
        <p>
          {current != null
            ? t('admin.schedule.current', { minutes: String(current) })
            : schedule?.schedule
              ? t('admin.schedule.customCron', { cron: schedule.schedule })
              : t('admin.schedule.help')}
          {unavailable ? ` ${t('admin.schedule.unavailable')}` : ''}
        </p>
      </div>
      <label className="monitoring__scheduleField">
        <span>{t('admin.schedule.every')}</span>
        <select
          className="semi-select monitoring__select"
          aria-label={t('admin.schedule.title')}
          value={current ?? ''}
          disabled={saving || schedule == null || unavailable}
          onChange={onChange}
        >
          {current == null && <option value="">—</option>}
          {choices.map((minutes) => (
            <option key={minutes} value={minutes}>
              {t('admin.schedule.minutes', { minutes: String(minutes) })}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
