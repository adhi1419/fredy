/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { IllustrationNoResult, IllustrationNoResultDark } from '@douyinfe/semi-illustrations';
import { format } from '../../services/time/timeService';
import { Table, Button, Empty, Tag } from '@douyinfe/semi-ui-19';
import { IconDelete, IconEdit } from '@douyinfe/semi-icons';
import { useTranslation, useLocale } from '../../services/i18n/i18n.jsx';

export default function UserTable({ user = [], onUserRemoval, onUserEdit } = {}) {
  const t = useTranslation();
  const locale = useLocale();
  const empty = (
    <Empty
      image={<IllustrationNoResult />}
      darkModeImage={<IllustrationNoResultDark />}
      description={t('users.emptyState')}
    />
  );
  return (
    <Table
      pagination={false}
      empty={empty}
      columns={[
        {
          title: t('users.tableColumnUser'),
          dataIndex: 'username',
          render: (value, record) => (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color: 'var(--f-text)', fontWeight: 500 }}>{value}</span>
              {record.isAdmin && (
                <Tag
                  size="small"
                  style={{
                    background: 'rgb(var(--f-accent-rgb) / 12%)',
                    border: '1px solid rgb(var(--f-accent-rgb) / 35%)',
                    color: 'var(--f-accent)',
                    borderRadius: 9999,
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    padding: '0 8px',
                  }}
                >
                  {t('users.tableAdminBadge')}
                </Tag>
              )}
            </div>
          ),
        },
        {
          title: t('users.tableColumnLastLogin'),
          dataIndex: 'lastLogin',
          render: (value) => (value == null ? '---' : format(value, true, locale)),
        },
        {
          title: t('users.tableColumnJobs'),
          dataIndex: 'numberOfJobs',
        },
        {
          title: '',
          dataIndex: 'tools',
          render: (_, record) => (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button
                style={{
                  background: 'transparent',
                  border: '1px solid rgb(var(--f-error-rgb) / 20%)',
                  color: 'var(--f-error)',
                }}
                icon={<IconDelete />}
                onClick={() => onUserRemoval(record.id)}
              />
              <Button type="primary" theme="solid" icon={<IconEdit />} onClick={() => onUserEdit(record.id)} />
            </div>
          ),
        },
      ]}
      dataSource={user}
    />
  );
}
