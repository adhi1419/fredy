/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Empty, Button, Switch, Tag } from '@douyinfe/semi-ui-19';
import { IconDelete, IconEdit } from '@douyinfe/semi-icons';
import { labelWithFlags } from '../../../../../services/countryFlags.js';
import {
  mergeProviderCapability,
  sourcePolicyControl,
  type GuidedProviderSource,
  type ProviderMetadata,
} from '../../../../../services/jobs/guidedSearchForm.js';
import { DEFAULT_COUNTRIES } from '../../../../../components/map/countryBounds.js';
import { getSafeProviderUrl, normalizeHost } from '../../../../../services/jobs/providerUrl.js';
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

/**
 * A compact, scannable label for a provider search URL in the Edit Search view.
 *
 * Raw search URLs run to hundreds of characters and wrapped across the card. The card now shows the
 * host only (the readable "which provider" part) and keeps the full URL in the link's title/aria so
 * nothing is lost. A URL that will not parse falls back to a middle-truncated form of the raw text.
 */
export function providerUrlLabel(url: string | null | undefined): string | null {
  if (url == null || String(url).trim().length === 0) return null;
  const host = normalizeHost(url);
  if (host != null) return host;
  const raw = String(url).trim();
  if (raw.length <= 42) return raw;
  return `${raw.slice(0, 24)}…${raw.slice(-14)}`;
}

function policyHintKey(reason: ReturnType<typeof sourcePolicyControl>['reason']): string {
  switch (reason) {
    case 'unsupported':
      return 'jobs.mutation.policyUnsupported';
    case 'connection':
      return 'jobs.mutation.policyConnection';
    case 'profile':
      return 'jobs.mutation.policyProfile';
    case 'listing':
      return 'jobs.mutation.policyListing';
    default:
      return 'jobs.mutation.policyAutomatic';
  }
}

function providerIdentity(
  source: GuidedProviderSource,
  provider: ProviderMetadata | null,
  t: Translation,
): { label: string; countries: readonly string[] } {
  const name = provider?.name ?? source.name ?? source.id ?? t('provider.tableColumnName');
  const declaredCountries = provider?.countries;
  const countries =
    Array.isArray(declaredCountries) && declaredCountries.length > 0 ? declaredCountries : DEFAULT_COUNTRIES;
  return { label: labelWithFlags({ name, countries }), countries };
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
        const profileReady = policyProfileReady(displaySource);
        const providerIdentityView = providerIdentity(displaySource, provider, t);
        const providerName = providerIdentityView.label;
        const countryCodes = providerIdentityView.countries.map((country) => country.toUpperCase()).join(', ');
        const safeProviderUrl = getSafeProviderUrl(displaySource.url, provider);
        const capabilityLabel = policy.capability.automatic
          ? t('jobs.mutation.policyAutomatic')
          : t('jobs.mutation.policyUnsupported');
        const key = `${displaySource.id ?? displaySource.url ?? 'provider'}-${index}`;

        return (
          <article
            className="providerChoiceCards__card"
            data-provider-id={displaySource.id ?? displaySource.url}
            key={key}
          >
            <header className="providerChoiceCards__header">
              <div className="providerChoiceCards__identity">
                <h3>
                  <span
                    className="providerChoiceCards__countryCode"
                    aria-label={t('jobs.mutation.providerCountries', { countries: countryCodes })}
                  >
                    {countryCodes}
                  </span>
                  {providerName}
                </h3>
                <p>{t('provider.tableColumnName')}</p>
              </div>
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

            <dl className="providerChoiceCards__details">
              <div>
                <dt>{t('provider.tableColumnUrl')}</dt>
                <dd>
                  {safeProviderUrl ? (
                    <a
                      className="providerChoiceCards__urlLink"
                      href={safeProviderUrl}
                      title={displaySource.url ?? undefined}
                      aria-label={t('jobs.mutation.viewUrlOpenAria', { url: String(displaySource.url ?? '') })}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {providerUrlLabel(displaySource.url) ?? displaySource.url}
                    </a>
                  ) : (
                    <span className="providerChoiceCards__urlLabel" title={displaySource.url ?? undefined}>
                      {providerUrlLabel(displaySource.url) ?? displaySource.url ?? t('common.na')}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt>{t('jobs.mutation.policyColumn')}</dt>
                <dd className="providerChoiceCards__readiness">
                  {policy.reason === 'unsupported' ? (
                    <span className="providerChoiceCards__unsupportedStatus" role="status">
                      {t('jobs.mutation.policyUnsupportedStatus')}
                    </span>
                  ) : (
                    <>
                      <Tag color="green">{capabilityLabel}</Tag>
                      <Tag color={policy.capability.connectionRequired ? 'orange' : 'green'}>
                        {policy.capability.connectionRequired
                          ? t('jobs.mutation.policyConnection')
                          : t('jobs.mutation.policyConnectionReady')}
                      </Tag>
                      <Tag color={profileReady ? 'green' : 'orange'}>
                        {profileReady ? t('jobs.mutation.policyProfileReady') : t('jobs.mutation.policyProfile')}
                      </Tag>
                    </>
                  )}
                </dd>
              </div>
            </dl>

            {policy.reason !== 'unsupported' && (
              <div className="providerChoiceCards__policy">
                <div className="providerChoiceCards__policyControl">
                  <Switch
                    checked={policy.enabled}
                    disabled={policy.disabled}
                    aria-label={t('jobs.mutation.policyToggle', { name: providerName })}
                    onChange={(checked) => onPolicyChange(displaySource, checked)}
                  />
                  <span>{policy.enabled ? t('jobs.mutation.policyOn') : t('jobs.mutation.policyOff')}</span>
                </div>
                <div className="providerChoiceCards__policyHint">
                  <span>{t(policyHintKey(policy.reason))}</span>
                  {policy.capability.connectionRequired === true && (
                    <Button type="tertiary" size="small" disabled>
                      {t('jobs.mutation.policyConnectAccount')}
                    </Button>
                  )}
                  {policy.reason === 'profile' && (
                    <Button type="tertiary" size="small" onClick={() => onCompleteProfile(displaySource)}>
                      {t('jobs.mutation.completeInquiryProfile')}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
