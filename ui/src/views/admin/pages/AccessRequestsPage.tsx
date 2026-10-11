/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Toast } from '@douyinfe/semi-ui-19';
import { SegmentPart } from '../../../components/segment/SegmentPart.jsx';
import { useTranslation, useLocale } from '../../../services/i18n/i18n.jsx';
import { useActions, useSelector } from '../../../services/state/store';
import { orderAccessRequests, type AdminEffects, type AdminState } from '../../../services/state/adminState.js';
import './AccessRequestsPage.less';

interface AccessRequestActions {
  admin: AdminEffects;
}

/**
 * The operator's queue: every Google account that signed in without being on the allowlist.
 * Approve writes the allowlist entry (never admin); decline keeps the row so the account cannot
 * re-queue itself; remove forgets a declined one.
 */
export default function AccessRequestsPage(): ReactNode {
  const t = useTranslation();
  const locale = useLocale();
  const actions = useActions<AccessRequestActions>();
  const requests = useSelector((state: AdminState) => state.admin.accessRequests);
  const loaded = useSelector((state: AdminState) => state.admin.accessRequestsLoaded);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void actions.admin.getAccessRequests().catch(() => Toast.error(t('admin.accessRequests.loadFailed')));
  }, [actions, t]);

  const run = async (email: string, effect: (email: string) => Promise<void>, doneKey: string) => {
    setBusy(email);
    try {
      await effect(email);
      Toast.success(t(doneKey, { email }));
    } catch {
      Toast.error(t('admin.accessRequests.actionFailed'));
    } finally {
      setBusy(null);
    }
  };

  const formatDate = (ms: number) =>
    new Date(ms).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });

  const ordered = orderAccessRequests(requests);
  const pendingCount = requests.filter((request) => request.status === 'pending').length;

  return (
    <SegmentPart
      name={t('admin.accessRequests.title')}
      helpText={t('admin.accessRequests.help')}
      className="accessRequests"
    >
      {loaded && ordered.length === 0 && <p className="accessRequests__empty">{t('admin.accessRequests.empty')}</p>}
      {ordered.length > 0 && (
        <ul className="accessRequests__list" aria-label={t('admin.accessRequests.listLabel', { count: pendingCount })}>
          {ordered.map((request) => {
            const declined = request.status === 'declined';
            const isBusy = busy === request.email;
            return (
              <li
                key={request.email}
                className={`accessRequests__row${declined ? ' accessRequests__row--declined' : ''}`}
              >
                <div className="accessRequests__who">
                  <strong>{request.displayName || request.email}</strong>
                  {request.displayName && <span>{request.email}</span>}
                </div>
                <div className="accessRequests__meta">
                  <span>{t('admin.accessRequests.requestedOn', { date: formatDate(request.requestedAt) })}</span>
                  {declined && <span className="accessRequests__status">{t('admin.accessRequests.declined')}</span>}
                </div>
                <div className="accessRequests__actions">
                  <Button
                    type="primary"
                    theme="solid"
                    size="small"
                    loading={isBusy}
                    disabled={busy != null}
                    onClick={() =>
                      run(request.email, actions.admin.approveAccessRequest, 'admin.accessRequests.approved')
                    }
                  >
                    {t('admin.accessRequests.approve')}
                  </Button>
                  {declined ? (
                    <Button
                      type="tertiary"
                      size="small"
                      disabled={busy != null}
                      onClick={() =>
                        run(request.email, actions.admin.removeAccessRequest, 'admin.accessRequests.removed')
                      }
                    >
                      {t('admin.accessRequests.remove')}
                    </Button>
                  ) : (
                    <Button
                      type="tertiary"
                      size="small"
                      disabled={busy != null}
                      onClick={() =>
                        run(request.email, actions.admin.declineAccessRequest, 'admin.accessRequests.declinedDone')
                      }
                    >
                      {t('admin.accessRequests.decline')}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SegmentPart>
  );
}

AccessRequestsPage.displayName = 'AccessRequestsPage';
