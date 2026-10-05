/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Empty, Button, Switch } from '@douyinfe/semi-ui-19';
import { IconAlertTriangle, IconDelete, IconEdit, IconExternalOpen, IconTickCircle } from '@douyinfe/semi-icons';
import { labelWithFlags } from '../../../../../services/countryFlags.js';
import {
  mergeProviderCapability,
  sourcePolicyControl,
  type GuidedProviderSource,
  type ProviderMetadata,
} from '../../../../../services/jobs/guidedSearchForm.js';
import { DEFAULT_COUNTRIES } from '../../../../../components/map/countryBounds.js';
import { getSafeProviderUrl, providerUrlLabel } from '../../../../../services/jobs/providerUrl.js';
import { useTranslation } from '../../../../../services/i18n/i18n.jsx';

interface ProviderChoiceCardsProps {
  providerData: readonly GuidedProviderSource[];
  providerMetadata: readonly ProviderMetadata[];
  policyProfileReady: (source: GuidedProviderSource) => boolean;
  onPolicyChange: (source: GuidedProviderSource, enabled: boolean) => void;
  onRemove: (providerUrl?: string) => void;
  onEdit: (source: GuidedProviderSource) => void;
  onCompleteProfile: (source: GuidedProviderSource) => void;
}

type Translation = (key: string, variables?: Record<string, string | number>) => string;

/** The one-line status the card shows for automatic inquiries, keyed by why they may be unavailable. */
function policyStatusKey(reason: ReturnType<typeof sourcePolicyControl>['reason']): string {
  switch (reason) {
    case 'unsupported':
      return 'jobs.mutation.policyUnsupportedStatus';
    case 'connection':
      return 'jobs.mutation.policyConnectionStatus';
    case 'profile':
      return 'jobs.mutation.policyProfileStatus';
    default:
      return 'jobs.mutation.policyAvailableStatus';
  }
}

function providerLabel(source: GuidedProviderSource, provider: ProviderMetadata | null, t: Translation): string {
  const name = provider?.name ?? source.name ?? source.id ?? t('provider.tableColumnName');
  const declaredCountries = provider?.countries;
  const countries =
    Array.isArray(declaredCountries) && declaredCountries.length > 0 ? declaredCountries : DEFAULT_COUNTRIES;
  return labelWithFlags({ name, countries });
}

export default function ProviderChoiceCards({
  providerData,
  providerMetadata,
  policyProfileReady,
  onPolicyChange,
  onRemove,
  onEdit,
  onCompleteProfile,
}: ProviderChoiceCardsProps) {
  const t = useTranslation();

  if (providerData.length === 0) {
    return <Empty description={t('provider.tableEmptyState')} />;
  }

  return (
    <div className="providerChoiceCards" aria-label={t('jobs.mutation.sectionProviders')}>
      {providerData.map((source, index) => {
        const merged = mergeProviderCapability(source, providerMetadata);
        const displaySource = merged.source;
        const policy = sourcePolicyControl(displaySource, providerMetadata, {
          profileReady: policyProfileReady(displaySource),
        });
        const provider = policy.provider;
        const providerName = providerLabel(displaySource, provider, t);
        const safeProviderUrl = getSafeProviderUrl(displaySource.url, provider);
        const urlLabel = providerUrlLabel(displaySource.url) ?? t('common.na');
        const available = policy.reason === null || policy.reason === 'listing';
        const key = `${displaySource.id ?? displaySource.url ?? 'provider'}-${index}`;

        return (
          <article
            className="providerChoiceCards__card"
            data-provider-id={displaySource.id ?? displaySource.url}
            key={key}
          >
            <header className="providerChoiceCards__header">
              <h3 className="providerChoiceCards__name">{providerName}</h3>
              <div className="providerChoiceCards__actions" aria-label={providerName}>
                <Button
                  icon={<IconEdit aria-hidden="true" />}
                  aria-label={`${t('common.edit')}: ${providerName}`}
                  onClick={() => onEdit(displaySource)}
                />
                <Button
                  type="danger"
                  icon={<IconDelete aria-hidden="true" />}
                  aria-label={`${t('common.delete')}: ${providerName}`}
                  onClick={() => onRemove(displaySource.url)}
                />
              </div>
            </header>

            {safeProviderUrl ? (
              <a
                className="providerChoiceCards__url"
                href={safeProviderUrl}
                title={displaySource.url ?? undefined}
                aria-label={t('jobs.mutation.viewUrlOpenAria', { url: String(displaySource.url ?? '') })}
                target="_blank"
                rel="noreferrer noopener"
              >
                <span className="providerChoiceCards__urlText">{urlLabel}</span>
                <IconExternalOpen aria-hidden="true" />
              </a>
            ) : (
              <span className="providerChoiceCards__url" title={displaySource.url ?? undefined}>
                <span className="providerChoiceCards__urlText">{urlLabel}</span>
              </span>
            )}

            <p
              className={`providerChoiceCards__status providerChoiceCards__status--${available ? 'ok' : 'warn'}`}
              role="status"
            >
              {available ? <IconTickCircle aria-hidden="true" /> : <IconAlertTriangle aria-hidden="true" />}
              <span>{t(policyStatusKey(policy.reason))}</span>
              {policy.reason === 'profile' && (
                <button
                  type="button"
                  className="providerChoiceCards__statusLink"
                  onClick={() => onCompleteProfile(displaySource)}
                >
                  {t('jobs.mutation.completeInquiryProfile')}
                </button>
              )}
            </p>

            {policy.reason !== 'unsupported' && (
              <label className="providerChoiceCards__policyControl">
                <Switch
                  checked={policy.enabled}
                  disabled={policy.disabled}
                  aria-label={t('jobs.mutation.policyToggle', { name: providerName })}
                  onChange={(checked) => onPolicyChange(displaySource, checked)}
                />
                <span>{t('jobs.mutation.policyConsent', { name: providerName })}</span>
              </label>
            )}
          </article>
        );
      })}
    </div>
  );
}
