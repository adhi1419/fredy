/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import type { ReactElement } from 'react';
import { Button, Input, InputNumber } from '@douyinfe/semi-ui-19';
import { IconSave } from '@douyinfe/semi-icons';
import { useOutletContext } from 'react-router';

import { SegmentPart } from '../../../components/segment/SegmentPart';
import type { AdminSettingsContext } from '../useAdminSettings.js';

/**
 * How the instance runs: the port it listens on, where it thinks it lives, how long a session
 * lasts, and how long offline listings are kept.
 */
export default function SystemPage(): ReactElement {
  const { t, form, setField, systemDirty, savingSystem, saveSystem } = useOutletContext<AdminSettingsContext>();

  return (
    <div className="settingsShell__page">
      <SegmentPart name={t('settings.port')} helpText={t('settings.portHelp')}>
        <InputNumber
          min={0}
          max={99999}
          placeholder={t('settings.portPlaceholder')}
          value={form.port}
          formatter={(value) => `${value}`.replace(/\D/g, '')}
          onChange={(value) => setField('port', value)}
          style={{ maxWidth: 160 }}
        />
      </SegmentPart>

      <SegmentPart name={t('settings.baseUrl')} helpText={t('settings.baseUrlHelp')}>
        <Input
          type="text"
          placeholder={t('settings.baseUrlPlaceholder')}
          value={form.baseUrl}
          onChange={(value) => setField('baseUrl', value)}
        />
      </SegmentPart>

      <SegmentPart name={t('settings.listingRetention')} helpText={t('settings.listingRetentionHelp')}>
        <InputNumber
          min={0}
          max={365}
          placeholder={t('settings.listingRetentionPlaceholder')}
          value={form.listingRetentionDays}
          formatter={(value) => `${value}`.replace(/\D/g, '')}
          onChange={(value) => setField('listingRetentionDays', value)}
          suffix={t('settings.listingRetentionSuffix')}
          style={{ maxWidth: 200 }}
        />
      </SegmentPart>

      <div className="settingsShell__saveRow">
        <Button
          type="primary"
          theme="solid"
          onClick={saveSystem}
          disabled={!systemDirty}
          loading={savingSystem}
          icon={<IconSave />}
        >
          {t('settings.save')}
        </Button>
      </div>
    </div>
  );
}

SystemPage.displayName = 'SystemPage';
