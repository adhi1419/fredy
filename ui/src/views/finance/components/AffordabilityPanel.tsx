/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import React from 'react';
import { Button, Select, Spin, Table, Tag, Tooltip, Typography } from '@douyinfe/semi-ui-19';
import { IconSearch } from '@douyinfe/semi-icons';
import { useNavigate } from 'react-router';

import { SegmentPart } from '../../../components/segment/SegmentPart.jsx';
import { FieldLabel } from './ProfileForm.jsx';
import AffordabilityScatter from '../charts/AffordabilityScatter.jsx';
import { VERDICT_COLORS, formatEuro, withAlpha } from '../../../components/cards/chartTheme.js';
import { useSelector, useActions } from '../../../services/state/store.js';
import { useTranslation, useLocale } from '../../../services/i18n/i18n.jsx';
import type { AffordabilityItem, FinanceProfile, Verdict } from '../../../types/finance.js';

import './AffordabilityPanel.less';

const { Text } = Typography;
const SUMMARY_VERDICTS: readonly Verdict[] = ['affordable', 'stretch', 'unaffordable'];

/** A verdict summary bucket the panel renders counts and cheapest prices from. */
interface VerdictBucket {
  total?: number;
  cheapestAffordable?: number | null;
}

/** The affordability payload from POST /api/finance/affordability, as this panel reads it. */
interface AffordabilityData {
  items: AffordabilityItem[];
  skipped: { noPrice: number; incompleteProfile: number };
  summary: {
    affordable: number;
    stretch: number;
    unaffordable: number;
    rent?: VerdictBucket;
    buy?: VerdictBucket;
  };
}

/** The finance store slice this panel reads. */
interface AffordabilityPanelState {
  jobsData: { jobs: Array<{ id: string; name: string; dealType?: string }> };
  finance: { data: AffordabilityData | null; loading: boolean };
}

/** The finance store actions this panel invokes. */
interface AffordabilityPanelActions {
  finance: { getAffordability: (input: { profile: FinanceProfile; filter: { jobId: string | null } }) => void };
}

interface AffordabilityPanelProps {
  profile: FinanceProfile;
}

/**
 * Score every listing the user can see against their finances.
 *
 * This is the issue's stated benefit made concrete: rather than pricing up one house at a
 * time, it answers "which of these can I actually buy, and how long would each take to pay
 * off" for the whole database at once.
 */
export default function AffordabilityPanel({ profile }: AffordabilityPanelProps) {
  const t = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const actions = useActions<AffordabilityPanelActions>();

  const jobs = useSelector((state: AffordabilityPanelState) => state.jobsData.jobs);
  const { data, loading } = useSelector((state: AffordabilityPanelState) => state.finance);

  const [jobId, setJobId] = React.useState<string | null>(null);

  // No threshold control any more: the job states whether it is about renting or buying, so
  // there is nothing left for the user to guess at.
  const run = () => actions.finance.getAffordability({ profile, filter: { jobId } });

  const columns = React.useMemo(
    () => [
      {
        title: t('finance.table.listing'),
        dataIndex: 'title',
        render: (title: string, record: AffordabilityItem) => (
          <button className="affordabilityPanel__link" onClick={() => navigate(`/listings/listing/${record.id}`)}>
            {title || t('finance.scatter.untitled')}
          </button>
        ),
      },
      {
        // "Purchase price" over a column of monthly rents is simply wrong, and the table mixes
        // both kinds of row. The heading names what the two have in common - the price as the
        // portal listed it - and each row says underneath which kind of figure it is.
        title: t('finance.table.listedPrice'),
        dataIndex: 'price',
        width: 150,
        sorter: (a?: AffordabilityItem, b?: AffordabilityItem) => (a?.price ?? 0) - (b?.price ?? 0),
        render: (price: number, record: AffordabilityItem) => (
          <div className="affordabilityPanel__stacked">
            <span className="affordabilityPanel__num">{formatEuro(price, locale)}</span>
            <span className="affordabilityPanel__sub">
              {t(record.dealType === 'rent' ? 'finance.table.priceIsColdRent' : 'finance.table.priceIsPurchase')}
            </span>
          </div>
        ),
      },
      {
        // Same idea: a mortgage instalment and a warm rent are both "what leaves the account
        // every month", which is the only comparison that means anything across the two.
        title: t('finance.table.monthlyCost'),
        dataIndex: 'monthlyPayment',
        width: 150,
        sorter: (a?: AffordabilityItem, b?: AffordabilityItem) => (a?.monthlyPayment ?? 0) - (b?.monthlyPayment ?? 0),
        render: (rate: number, record: AffordabilityItem) => (
          <div className="affordabilityPanel__stacked">
            <span className="affordabilityPanel__num">{formatEuro(rate, locale)}</span>
            <span className="affordabilityPanel__sub">
              {t(record.dealType === 'rent' ? 'finance.table.rateIsWarmRent' : 'finance.table.rateIsInstalment')}
            </span>
          </div>
        ),
      },
      {
        // The term at the household's affordable rate. The scenario Tilgung would give the
        // same number for every row, which tells the user nothing.
        title: (
          <Tooltip content={t('finance.table.payoffHelp')}>
            <span>{t('finance.table.payoff')}</span>
          </Tooltip>
        ),
        dataIndex: 'payoffYearsAtBudget',
        width: 110,
        sorter: (a?: AffordabilityItem, b?: AffordabilityItem) =>
          (a?.payoffYearsAtBudget ?? 999) - (b?.payoffYearsAtBudget ?? 999),
        render: (years: number | null | undefined, record: AffordabilityItem) => (
          <span className="affordabilityPanel__num">
            {/* A rental is never "paid off" - leaving the loan wording on it would be nonsense. */}
            {record.dealType === 'rent'
              ? '–'
              : years == null
                ? t('finance.kpi.never')
                : t('finance.kpi.yearsValue', { years: String(years) })}
          </span>
        ),
      },
      {
        // Rent and purchase rows share one table, so each row has to say which it is - a
        // 1.200 EUR rent and a 1.200 EUR flat would otherwise look like the same kind of row,
        // and the user could not tell that each was judged by its own rules.
        title: t('finance.table.dealType'),
        dataIndex: 'dealType',
        width: 110,
        render: (dealType: string | undefined) => (
          <Tag size="small" color={dealType === 'rent' ? 'blue' : 'green'}>
            {t(`finance.dealType.${dealType === 'rent' ? 'rent' : 'buy'}`)}
          </Tag>
        ),
      },
      {
        title: t('finance.table.verdict'),
        dataIndex: 'verdict',
        width: 130,
        render: (verdict: Verdict) => (
          <span
            className="affordabilityPanel__chip"
            style={{
              color: VERDICT_COLORS[verdict],
              backgroundColor: withAlpha(VERDICT_COLORS[verdict], 0.12),
              borderColor: withAlpha(VERDICT_COLORS[verdict], 0.4),
            }}
          >
            {t(`finance.verdict.${verdict}`)}
          </span>
        ),
      },
    ],
    [t, locale, navigate],
  );

  const skippedCount = data ? data.skipped.noPrice + data.skipped.incompleteProfile : 0;
  // The scatter plots price against payoff term, which only exists for a purchase. Rentals are
  // in the table and the counters; putting them on this chart would just pile them on the axis.
  const buyItems = React.useMemo(() => (data?.items ?? []).filter((item) => item.dealType !== 'rent'), [data]);

  return (
    <SegmentPart name={t('finance.panel.title')} helpText={t('finance.panel.help')}>
      <div className="affordabilityPanel__controls">
        <label className="financeField">
          <FieldLabel label={t('finance.panel.job')} help={t('finance.panel.jobHelp')} />
          <Select
            className="financeField__input"
            placeholder={t('finance.panel.allJobs')}
            showClear
            value={jobId}
            onChange={(value) => setJobId(Array.isArray(value) ? null : (value ?? null))}
          >
            {/* The job's own type is spelled out here, because it is what decides which half of
                the profile scores its listings. */}
            {jobs.map((job) => (
              <Select.Option key={job.id} value={job.id}>
                {job.dealType
                  ? `${job.name} (${t(`finance.dealType.${job.dealType === 'rent' ? 'rent' : 'buy'}`)})`
                  : job.name}
              </Select.Option>
            ))}
          </Select>
        </label>

        <Button
          className="affordabilityPanel__run"
          theme="solid"
          type="primary"
          icon={<IconSearch />}
          onClick={run}
          loading={loading}
        >
          {t('finance.panel.run')}
        </Button>
      </div>

      {loading && (
        <div className="affordabilityPanel__loading">
          <Spin />
        </div>
      )}

      {!loading && data && (
        <>
          {/* Spelling out the split is the point: every listing was judged by the rules of its own
              job, so a mixed result is two separate answers rather than one blended one. A caption,
              not an alert - a tinted full-width box made a plain count look like a problem. */}
          <Text type="tertiary" size="small" className="affordabilityPanel__note">
            {t('finance.panel.judgedByJobType', {
              rent: String(data.summary.rent?.total ?? 0),
              buy: String(data.summary.buy?.total ?? 0),
            })}
          </Text>

          <div className="affordabilityPanel__summary">
            {SUMMARY_VERDICTS.map((verdict) => (
              <div className="affordabilityPanel__stat" key={verdict}>
                <span className="affordabilityPanel__stat-value" style={{ color: VERDICT_COLORS[verdict] }}>
                  {data.summary[verdict]}
                </span>
                <span className="affordabilityPanel__stat-label">{t(`finance.verdict.${verdict}`)}</span>
              </div>
            ))}
            {data.summary.buy?.cheapestAffordable != null && (
              <div className="affordabilityPanel__stat">
                <span className="affordabilityPanel__stat-value">
                  {formatEuro(data.summary.buy.cheapestAffordable, locale)}
                </span>
                <span className="affordabilityPanel__stat-label">{t('finance.panel.cheapest')}</span>
              </div>
            )}
            {data.summary.rent?.cheapestAffordable != null && (
              <div className="affordabilityPanel__stat">
                <span className="affordabilityPanel__stat-value">
                  {formatEuro(data.summary.rent.cheapestAffordable, locale)}
                </span>
                <span className="affordabilityPanel__stat-label">{t('finance.panel.cheapestRent')}</span>
              </div>
            )}
          </div>

          {skippedCount > 0 && (
            <Text type="tertiary" size="small" className="affordabilityPanel__note">
              {t('finance.panel.skipped', { count: String(skippedCount) })}
            </Text>
          )}

          {buyItems.length > 0 && <AffordabilityScatter items={buyItems} />}

          <Table
            className="affordabilityPanel__table"
            columns={columns}
            dataSource={data.items}
            rowKey="id"
            size="small"
            // Six columns do not fit a phone. Scrolling inside the table keeps the page itself
            // from scrolling sideways, which would drag the whole layout with it.
            scroll={{ x: 800 }}
            pagination={{ pageSize: 10 }}
          />
        </>
      )}

      {!loading && !data && (
        <Text type="tertiary" size="small">
          {t('finance.panel.idle')}
        </Text>
      )}
    </SegmentPart>
  );
}

AffordabilityPanel.displayName = 'AffordabilityPanel';
