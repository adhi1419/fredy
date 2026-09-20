/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Empty, Table, Button, Typography, Switch } from '@douyinfe/semi-ui-19';
import { IconDelete, IconEdit } from '@douyinfe/semi-icons';
import { useTranslation } from '../../services/i18n/i18n.jsx';
import { sourcePolicyControl } from '../../services/jobs/guidedSearchForm.js';

export default function ProviderTable({
  providerData = [],
  providerMetadata = [],
  policyProfileReady = () => true,
  onRemove,
  onEdit,
  onPolicyChange,
  onCompleteProfile,
} = {}) {
  const t = useTranslation();
  const { Text } = Typography;

  const policyView = (record) =>
    sourcePolicyControl(record, providerMetadata, { profileReady: policyProfileReady(record) });

  return (
    <Table
      pagination={false}
      empty={<Empty description={t('provider.tableEmptyState')} />}
      columns={[
        {
          title: t('provider.tableColumnName'),
          dataIndex: 'name',
        },
        {
          title: t('provider.tableColumnUrl'),
          dataIndex: 'url',
          render: (_, data) => {
            return <Text link={{ href: data.url, target: '_blank' }}>{t('provider.tableOpenProvider')}</Text>;
          },
        },
        {
          title: t('jobs.mutation.policyColumn'),
          dataIndex: 'applicationPolicy',
          render: (_, record) => {
            const control = policyView(record);
            const capability = control.capability;
            const hint =
              control.reason === 'unsupported'
                ? t('jobs.mutation.policyUnsupported')
                : control.reason === 'connection'
                  ? t('jobs.mutation.policyConnection')
                  : control.reason === 'profile'
                    ? t('jobs.mutation.policyProfile')
                    : control.reason === 'listing'
                      ? t('jobs.mutation.policyListing')
                      : t('jobs.mutation.policyAutomatic');

            return (
              <div className="providerTable__policy">
                <div className="providerTable__policyControl">
                  <Switch
                    checked={control.enabled}
                    disabled={control.disabled}
                    aria-label={t('jobs.mutation.policyToggle', { name: record.name })}
                    onChange={(checked) => onPolicyChange?.(record, checked)}
                  />
                  <span>{control.enabled ? t('jobs.mutation.policyOn') : t('jobs.mutation.policyOff')}</span>
                </div>
                <div className="providerTable__policyHint">
                  {capability.connectionRequired && (
                    <Button type="tertiary" size="small" disabled>
                      {t('jobs.mutation.policyConnectAccount')}
                    </Button>
                  )}
                  {control.reason === 'profile' && (
                    <Button type="tertiary" size="small" onClick={() => onCompleteProfile?.(record)}>
                      {t('jobs.mutation.completeInquiryProfile')}
                    </Button>
                  )}
                  <span>{hint}</span>
                </div>
              </div>
            );
          },
        },
        {
          title: '',
          dataIndex: 'tools',
          render: (_, record) => {
            return (
              <div style={{ float: 'right' }}>
                <Button
                  type="secondary"
                  icon={<IconEdit />}
                  aria-label={t('common.edit')}
                  onClick={() => onEdit(record)}
                />
                <div style={{ display: 'inline-block', width: '16px' }} />
                <Button
                  type="danger"
                  icon={<IconDelete />}
                  aria-label={t('common.delete')}
                  onClick={() => onRemove(record.url)}
                />
              </div>
            );
          },
        },
      ]}
      dataSource={providerData}
    />
  );
}
