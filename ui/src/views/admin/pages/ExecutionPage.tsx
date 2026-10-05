/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import type { ReactElement } from 'react';
import { TimePicker, Button, InputNumber, Select } from '@douyinfe/semi-ui-19';
import { IconSave } from '@douyinfe/semi-icons';
import { useOutletContext } from 'react-router';
import { useMemo } from 'react';

import { SegmentPart } from '../../../components/segment/SegmentPart';
import { timeZoneOptions } from '../../../services/time/timeService';
import type { AdminSettingsContext } from '../useAdminSettings.js';

function formatFromTimestamp(ts: number): string {
  const date = new Date(ts);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * @param time HH:mm as the backend stores it.
 */
function formatFromTBackend(time: string | null): number | null {
  if (time == null || time.length === 0) {
    return null;
  }
  const date = new Date();
  const split = time.split(':');
  date.setHours(Number(split[0]));
  date.setMinutes(Number(split[1]));
  return date.getTime();
}

/**
 * How often Fredy searches and within which hours.
 */
export default function ExecutionPage(): ReactElement {
  const { t, form, setField, setWorkingHour, executionDirty, savingExecution, saveExecution } =
    useOutletContext<AdminSettingsContext>();
  const zones = useMemo(() => timeZoneOptions(form.workingHours.timeZone), [form.workingHours.timeZone]);

  return (
    <div className="settingsShell__page">
      <SegmentPart name={t('settings.searchInterval')} helpText={t('settings.searchIntervalHelp')}>
        <InputNumber
          min={5}
          max={1440}
          placeholder={t('settings.searchIntervalPlaceholder')}
          value={form.interval}
          formatter={(value) => `${value}`.replace(/\D/g, '')}
          onChange={(value) => setField('interval', value)}
          suffix={t('settings.searchIntervalSuffix')}
          style={{ maxWidth: 200 }}
        />
      </SegmentPart>

      <SegmentPart name={t('settings.workingHours')} helpText={t('settings.workingHoursHelp')}>
        <div className="settingsShell__timePickerContainer">
          <TimePicker
            format={'HH:mm'}
            insetLabel={t('settings.workingHoursFrom')}
            value={formatFromTBackend(form.workingHours.from) ?? undefined}
            placeholder=""
            onChange={(val) => setWorkingHour('from', val == null ? null : formatFromTimestamp(Number(val)))}
          />
          <TimePicker
            format={'HH:mm'}
            insetLabel={t('settings.workingHoursUntil')}
            value={formatFromTBackend(form.workingHours.to) ?? undefined}
            placeholder=""
            onChange={(val) => setWorkingHour('to', val == null ? null : formatFromTimestamp(Number(val)))}
          />
          {/*
            Searchable rather than a plain list: there are well over four hundred zones, and an
            operator knows the name of theirs. Clearable because an empty value is a real state -
            it means the window follows the server's own zone, which is what every installation did
            before this setting existed.
          */}
          <Select
            filter
            showClear
            optionList={zones}
            value={form.workingHours.timeZone ?? undefined}
            placeholder={t('settings.workingHoursTimeZonePlaceholder')}
            insetLabel={t('settings.workingHoursTimeZone')}
            onChange={(val) => setWorkingHour('timeZone', val == null || val === '' ? null : String(val))}
            style={{ minWidth: 260 }}
          />
        </div>
      </SegmentPart>

      <div className="settingsShell__saveRow">
        <Button
          type="primary"
          theme="solid"
          onClick={saveExecution}
          disabled={!executionDirty}
          loading={savingExecution}
          icon={<IconSave />}
        >
          {t('settings.save')}
        </Button>
      </div>
    </div>
  );
}

ExecutionPage.displayName = 'ExecutionPage';
