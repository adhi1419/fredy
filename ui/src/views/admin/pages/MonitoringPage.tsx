/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { ReactNode } from 'react';
import { Button, Toast } from '@douyinfe/semi-ui-19';
import { CHART_COLORS } from '../../../components/cards/chartTheme.js';
import { useLocale, useTranslation } from '../../../services/i18n/i18n.jsx';
import {
  type AdminEffects,
  type AdminState,
  type MonitoringBucket,
  type MonitoringCostValue,
  type MonitoringListing,
  type MonitoringQuery,
  type MonitoringRun,
  DEFAULT_MONITORING_GRANULARITY,
  monitoringListingPath,
  monitoringListingTitle,
  monitoringRunOutcome,
  type MonitoringGranularity,
} from '../../../services/state/adminState.js';
import { useActions, useSelector } from '../../../services/state/store.js';
import MonitoringChart, { type MonitoringSeries } from './MonitoringChart.jsx';
import RunScheduleControl from './RunScheduleControl.jsx';
import { monitoringDailyBuckets, monitoringRangeFor, type MonitoringRangeKey } from './monitoringTime.js';
import './MonitoringPage.less';

type Granularity = 'hourly' | 'daily';
type ChartKey = 'active' | 'new' | 'success' | 'failure';

interface MonitoringActions {
  admin: AdminEffects;
}

function costText(value: MonitoringCostValue, locale: string, unavailable: string): string {
  if (value.amount == null || value.currency == null) return unavailable;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: value.currency,
    maximumFractionDigits: 2,
  }).format(value.amount);
}

function compact(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function bytes(value: number, locale: string): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1024 ** 3)} GiB`;
}

function runOutcomeClass(run: MonitoringRun): string {
  const outcome = monitoringRunOutcome(run);
  if (outcome === 'completed') return 'monitoring__ok';
  if (outcome === 'completed-with-issues') return 'monitoring__warn';
  return run.errorType ? 'monitoring__error' : 'monitoring__warn';
}

function listingOutcomeClass(outcome: MonitoringListing['outcome']): string {
  if (outcome === 'provider-confirmed' || outcome === 'manual-applied') return 'monitoring__ok';
  if (outcome === 'terminal') return 'monitoring__error';
  return 'monitoring__warn';
}

function listingOutcomeKey(outcome: MonitoringListing['outcome']): string {
  return `admin.monitoring.listingOutcome.${outcome}`;
}

/** Admin-only Monitoring dashboard, matching the approved expandable-ledger mock. */
export default function MonitoringPage(): ReactNode {
  const t = useTranslation();
  const locale = useLocale();
  const actions = useActions<MonitoringActions>();
  const overview = useSelector((state: AdminState) => state.admin.monitoring);
  const runs = useSelector((state: AdminState) => state.admin.monitoringRuns);
  const listings = useSelector((state: AdminState) => state.admin.monitoringListings ?? []);
  const listingsTruncated = useSelector((state: AdminState) => state.admin.monitoringListingsTruncated === true);
  const [range, setRange] = useState<MonitoringRangeKey>('7d');
  const [granularity, setGranularity] = useState<Granularity>('hourly');
  const [ledgerGranularity, setLedgerGranularity] = useState<MonitoringGranularity>(DEFAULT_MONITORING_GRANULARITY);
  const [jobId, setJobId] = useState('');
  const [providerId, setProviderId] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [runsLoading, setRunsLoading] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [selectedChart, setSelectedChart] = useState<ChartKey>('new');
  const [ledgerOpen, setLedgerOpen] = useState(true);

  const query = useMemo(
    () => ({ ...monitoringRangeFor(range), jobId: jobId || null, providerId: providerId || null }),
    [range, jobId, providerId, refreshVersion],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await actions.admin.getMonitoring(query);
    } catch {
      Toast.error(t('admin.monitoring.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [actions, query, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const buckets = useMemo(
    () => (granularity === 'daily' ? monitoringDailyBuckets(overview?.buckets ?? []) : [...(overview?.buckets ?? [])]),
    [granularity, overview?.buckets],
  );

  const labels = useMemo(
    () =>
      buckets.map((bucket) =>
        new Intl.DateTimeFormat(
          locale,
          granularity === 'hourly'
            ? { weekday: 'short', hour: '2-digit', minute: '2-digit' }
            : { month: 'short', day: 'numeric' },
        ).format(bucket.start),
      ),
    [buckets, granularity, locale],
  );

  const loadRuns = useCallback(
    async (index: number, chart: ChartKey) => {
      const bucket = buckets[index];
      if (bucket == null) return;
      setSelectedIndex(index);
      setSelectedChart(chart);
      setLedgerOpen(true);
      setRunsLoading(true);
      try {
        await actions.admin.getMonitoringRuns({
          start: bucket.start,
          end: bucket.end,
          jobId: jobId || null,
          providerId: providerId || null,
        });
      } catch {
        Toast.error(t('admin.monitoring.runsFailed'));
      } finally {
        setRunsLoading(false);
      }
    },
    [actions, buckets, jobId, providerId, t],
  );

  useEffect(() => {
    if (buckets.length === 0) return;
    const latest = buckets.length - 1;
    void loadRuns(latest, selectedChart);
  }, [overview?.generatedAt, granularity]);

  const series = useMemo<Record<ChartKey, MonitoringSeries[]>>(
    () => ({
      active: [
        {
          label: t('admin.monitoring.series.active'),
          color: CHART_COLORS.ACCENT,
          data: buckets.map((b) => b.activeListings),
        },
      ],
      new: [
        {
          label: t('admin.monitoring.series.stored'),
          color: CHART_COLORS.BLUE,
          data: buckets.map((b) => b.counters.newListings),
        },
      ],
      success: [
        {
          label: t('admin.monitoring.series.confirmed'),
          color: CHART_COLORS.SUCCESS,
          data: buckets.map((b) => b.counters.providerConfirmed),
        },
        {
          label: t('admin.monitoring.series.manual'),
          color: CHART_COLORS.BLUE,
          data: buckets.map((b) => b.counters.manualApplied),
        },
      ],
      failure: [
        {
          label: t('admin.monitoring.series.retryable'),
          color: CHART_COLORS.WARNING,
          data: buckets.map((b) => b.counters.retryableFailures),
        },
        {
          label: t('admin.monitoring.series.terminal'),
          color: CHART_COLORS.ERROR,
          dash: [5, 3],
          data: buckets.map((b) => b.counters.terminalFailures),
        },
        {
          label: t('admin.monitoring.series.unknown'),
          color: CHART_COLORS.PURPLE,
          dash: [2, 3],
          data: buckets.map((b) => b.counters.unknownFailures),
        },
      ],
    }),
    [buckets, t],
  );

  const selected = selectedIndex == null ? null : (buckets[selectedIndex] ?? null);
  const selectedLabel =
    selected == null
      ? ''
      : new Intl.DateTimeFormat(locale, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: granularity === 'hourly' ? '2-digit' : undefined,
          minute: granularity === 'hourly' ? '2-digit' : undefined,
        }).format(selected.start);
  const notAttempted = buckets.reduce((sum, bucket) => sum + bucket.counters.notAttempted, 0);
  const unavailable = t('admin.monitoring.notConfigured');
  const cost = overview?.cost;
  const consumption = overview?.consumption;

  const charts: Array<{ key: ChartKey; title: string; subtitle: string; footnote?: string }> = [
    { key: 'active', title: t('admin.monitoring.active'), subtitle: t('admin.monitoring.activeHelp') },
    { key: 'new', title: t('admin.monitoring.new'), subtitle: t('admin.monitoring.newHelp') },
    { key: 'success', title: t('admin.monitoring.success'), subtitle: t('admin.monitoring.successHelp') },
    {
      key: 'failure',
      title: t('admin.monitoring.failure'),
      subtitle: t('admin.monitoring.failureHelp'),
      footnote: t('admin.monitoring.notAttemptedCount', { count: String(notAttempted) }),
    },
  ];

  return (
    <div className="monitoring">
      <div className="monitoring__titleRow">
        <h2>{t('admin.monitoring.title')}</h2>
        <span className="monitoring__updated">
          {overview
            ? t('admin.monitoring.updated', { time: new Date(overview.generatedAt).toLocaleTimeString(locale) })
            : ''}
        </span>
      </div>
      <p className="monitoring__intro">{t('admin.monitoring.intro')}</p>

      <div className="monitoring__controls">
        <select
          className="semi-select monitoring__select"
          aria-label={t('admin.monitoring.range')}
          value={range}
          onChange={(event) => setRange(event.target.value as MonitoringRangeKey)}
        >
          <option value="24h">{t('admin.monitoring.range24h')}</option>
          <option value="7d">{t('admin.monitoring.range7d')}</option>
          <option value="30d">{t('admin.monitoring.range30d')}</option>
          <option value="mtd">{t('admin.monitoring.rangeMtd')}</option>
        </select>
        <Button
          theme={granularity === 'hourly' ? 'solid' : 'borderless'}
          type="primary"
          onClick={() => setGranularity('hourly')}
        >
          {t('admin.monitoring.hourly')}
        </Button>
        <Button
          theme={granularity === 'daily' ? 'solid' : 'borderless'}
          type="primary"
          onClick={() => setGranularity('daily')}
        >
          {t('admin.monitoring.daily')}
        </Button>
        <select
          className="semi-select monitoring__select"
          aria-label={t('admin.monitoring.searchFilter')}
          value={jobId}
          onChange={(event) => setJobId(event.target.value)}
        >
          <option value="">{t('admin.monitoring.allSearches')}</option>
          {overview?.filters.jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {job.name}
            </option>
          ))}
        </select>
        <select
          className="semi-select monitoring__select"
          aria-label={t('admin.monitoring.providerFilter')}
          value={providerId}
          onChange={(event) => setProviderId(event.target.value)}
        >
          <option value="">{t('admin.monitoring.allProviders')}</option>
          {overview?.filters.providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </select>
        <Button
          className="monitoring__refresh"
          loading={loading}
          onClick={() => setRefreshVersion((value) => value + 1)}
        >
          {t('admin.monitoring.refresh')}
        </Button>
      </div>

      <RunScheduleControl />

      <section className="monitoring__costs">
        <header className="monitoring__costHeader">
          <h2>{t('admin.monitoring.monthCost')}</h2>
          <span className="monitoring__billingNote">{t('admin.monitoring.billingLag')}</span>
        </header>
        <div className="monitoring__costGrid">
          {(
            [
              [t('admin.monitoring.projectActual'), cost?.project.actual],
              [t('admin.monitoring.projectEstimate'), cost?.project.estimate],
              [t('admin.monitoring.runtimeActual'), cost?.runtime.actual],
              [t('admin.monitoring.runtimeEstimate'), cost?.runtime.estimate],
            ] as Array<[string, MonitoringCostValue | undefined]>
          ).map(([label, value], index) => (
            <div className={`monitoring__cost${index % 2 === 1 ? ' monitoring__cost--estimate' : ''}`} key={label}>
              <span className="monitoring__costLabel">{label}</span>
              <strong>{value ? costText(value, locale, unavailable) : '—'}</strong>
              <small>
                {value?.status === 'not-configured'
                  ? t('admin.monitoring.billingSetup')
                  : index < 2
                    ? t('admin.monitoring.allServices')
                    : t('admin.monitoring.runtimeServices')}
              </small>
            </div>
          ))}
        </div>
        <div className="monitoring__usage">
          <div>
            <strong>{t('admin.monitoring.cloudRun')}</strong>
            <br />
            <span>
              {consumption?.status === 'available'
                ? t('admin.monitoring.cloudRunUsage', {
                    requests: compact(consumption.cloudRun.requests, locale),
                    cpu: (consumption.cloudRun.vCpuSeconds / 3600).toFixed(1),
                    memory: (consumption.cloudRun.gibibyteSeconds / 3600).toFixed(1),
                  })
                : '—'}
            </span>
          </div>
          <div>
            <strong>{t('admin.monitoring.firestore')}</strong>
            <br />
            <span>
              {consumption?.status === 'available'
                ? t('admin.monitoring.firestoreUsage', {
                    reads: compact(consumption.firestore.reads, locale),
                    writes: compact(consumption.firestore.writes, locale),
                    storage: bytes(consumption.firestore.storageBytes, locale),
                  })
                : '—'}
            </span>
          </div>
        </div>
        {consumption != null && consumption.status !== 'available' && (
          <p className="monitoring__usageError">
            {t('admin.monitoring.usageUnavailable', { reason: consumption.reason ?? '' })}
          </p>
        )}
      </section>

      <section>
        <header className="monitoring__sectionHeading">
          <h2>{t('admin.monitoring.activity')}</h2>
          <p>{t('admin.monitoring.chartHelp')}</p>
        </header>
        <p className="monitoring__outcomeHelp">{t('admin.monitoring.outcomeHelp')}</p>
        <div className="monitoring__charts">
          {charts.map((chart) => (
            <MonitoringChart
              key={chart.key}
              title={chart.title}
              subtitle={chart.subtitle}
              labels={labels}
              series={series[chart.key]}
              footnote={chart.footnote}
              beginAtZero={chart.key !== 'active'}
              xAxisLabel={t('admin.monitoring.axisTime')}
              yAxisLabel={t('admin.monitoring.axisCount')}
              sharedHoverIndex={hoverIndex}
              selected={selectedChart === chart.key}
              onHoverIndex={setHoverIndex}
              onSelect={(index) => void loadRuns(index, chart.key)}
            />
          ))}
        </div>
        <div className="monitoring__ledger">
          {selected ? (
            <>
              <header className="monitoring__ledgerHeading">
                <div>
                  <h2>{selectedLabel}</h2>
                  <p>
                    {ledgerGranularity === 'provider'
                      ? t('admin.monitoring.runsContributed', { count: String(runs.length) })
                      : t('admin.monitoring.listingsContributed', { count: String(listings.length) })}
                  </p>
                </div>
                <div className="monitoring__ledgerActions">
                  <div
                    className="monitoring__granularityToggle"
                    role="group"
                    aria-label={t('admin.monitoring.granularity')}
                  >
                    {(['provider', 'listing'] as const).map((value) => (
                      <button
                        className={`monitoring__granularityButton${ledgerGranularity === value ? ' monitoring__granularityButton--active' : ''}`}
                        type="button"
                        aria-pressed={ledgerGranularity === value}
                        key={value}
                        onClick={() => setLedgerGranularity(value)}
                      >
                        {t(`admin.monitoring.${value}View`)}
                      </button>
                    ))}
                  </div>
                  <span className="monitoring__costLabel">
                    {t('admin.monitoring.selectedFrom', {
                      chart: charts.find((chart) => chart.key === selectedChart)?.title ?? '',
                    })}
                  </span>
                  <Button size="small" aria-expanded={ledgerOpen} onClick={() => setLedgerOpen((open) => !open)}>
                    {ledgerOpen ? t('admin.monitoring.collapseRuns') : t('admin.monitoring.expandRuns')}
                  </Button>
                </div>
              </header>
              {ledgerOpen && (
                <>
                  <div className="monitoring__summary">
                    <span>
                      <b>{selected.activeListings}</b> {t('admin.monitoring.summaryActive')}
                    </span>
                    <span>
                      <b>{selected.counters.newListings}</b> {t('admin.monitoring.summaryStored')}
                    </span>
                    <span>
                      <b className="monitoring__ok">
                        {selected.counters.providerConfirmed + selected.counters.manualApplied}
                      </b>{' '}
                      {t('admin.monitoring.summarySuccessful')}
                    </span>
                    <span>
                      <b className="monitoring__warn">
                        {selected.counters.retryableFailures +
                          selected.counters.terminalFailures +
                          selected.counters.unknownFailures}
                      </b>{' '}
                      {t('admin.monitoring.summaryFailed')}
                    </span>
                    <span>
                      <b>{selected.counters.notAttempted}</b> {t('admin.monitoring.summaryNotAttempted')}
                    </span>
                  </div>
                  <div className="monitoring__tableWrap">
                    {ledgerGranularity === 'listing' && (
                      <div className="monitoring__tableNotices">
                        <p className="monitoring__scrollHint">{t('admin.monitoring.listingScrollHint')}</p>
                        {listingsTruncated && (
                          <p className="monitoring__truncationNotice">{t('admin.monitoring.listingsTruncated')}</p>
                        )}
                      </div>
                    )}
                    {ledgerGranularity === 'provider' ? (
                      <table className="monitoring__table">
                        <thead>
                          <tr>
                            <th>{t('admin.monitoring.started')}</th>
                            <th>{t('admin.monitoring.savedSearch')}</th>
                            <th>{t('admin.monitoring.provider')}</th>
                            <th>{t('admin.monitoring.stored')}</th>
                            <th>{t('admin.monitoring.applications')}</th>
                            <th>{t('admin.monitoring.outcome')}</th>
                            <th>{t('admin.monitoring.duration')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {runs.map((run) => {
                            const applicationCounts = [
                              [t('admin.monitoring.confirmedShort'), run.counters.providerConfirmed, 'monitoring__ok'],
                              [t('admin.monitoring.manualShort'), run.counters.manualApplied, 'monitoring__ok'],
                              [
                                t('admin.monitoring.retryableShort'),
                                run.counters.retryableFailures,
                                'monitoring__warn',
                              ],
                              [t('admin.monitoring.terminalShort'), run.counters.terminalFailures, 'monitoring__error'],
                              [t('admin.monitoring.unknownShort'), run.counters.unknownFailures, 'monitoring__warn'],
                              [t('admin.monitoring.notAttemptedShort'), run.counters.notAttempted, 'monitoring__muted'],
                            ] as const;
                            const outcome = monitoringRunOutcome(run);
                            return (
                              <tr key={run.id}>
                                <td>
                                  {new Date(run.startedAt).toLocaleTimeString(locale, {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </td>
                                <td>{run.jobName}</td>
                                <td>{run.providerName}</td>
                                <td>{run.counters.newListings}</td>
                                <td>
                                  <div
                                    className="monitoring__applicationCounts"
                                    aria-label={t('admin.monitoring.applications')}
                                  >
                                    {applicationCounts.map(([label, count, className]) => (
                                      <span className={`monitoring__applicationCount ${className}`} key={label}>
                                        <b>{count}</b> {label}
                                      </span>
                                    ))}
                                  </div>
                                </td>
                                <td className={runOutcomeClass(run)}>
                                  {outcome === 'completed'
                                    ? t('admin.monitoring.completed')
                                    : outcome === 'completed-with-issues'
                                      ? t('admin.monitoring.completedWithIssues')
                                      : (run.errorType ?? run.outcome)}
                                </td>
                                <td>{(run.durationMs / 1000).toFixed(1)}s</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    ) : (
                      <table className="monitoring__table monitoring__table--listings">
                        <thead>
                          <tr>
                            <th>{t('admin.monitoring.listingTime')}</th>
                            <th>{t('admin.monitoring.listingTitle')}</th>
                            <th>{t('admin.monitoring.listingJob')}</th>
                            <th>{t('admin.monitoring.listingProvider')}</th>
                            <th>{t('admin.monitoring.listingOutcome')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {listings.map((listing) => (
                            <tr key={`${listing.listingId}-${listing.happenedAt}`}>
                              <td>
                                {new Date(listing.happenedAt).toLocaleTimeString(locale, {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </td>
                              <td>
                                {listing.title == null ? (
                                  <span className="monitoring__listingUnavailable">
                                    {monitoringListingTitle(listing, t('admin.monitoring.listingUnavailable'))}
                                  </span>
                                ) : (
                                  <Link
                                    className="monitoring__listingLink"
                                    to={monitoringListingPath(listing.listingId)}
                                  >
                                    {listing.title}
                                  </Link>
                                )}
                                {listing.providerUrl != null && (
                                  <a
                                    className="monitoring__listingExternal"
                                    href={listing.providerUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={t('admin.monitoring.openProviderListing')}
                                  >
                                    ↗
                                  </a>
                                )}
                              </td>
                              <td>{listing.jobName}</td>
                              <td>{listing.providerName}</td>
                              <td className={listingOutcomeClass(listing.outcome)}>
                                {t(listingOutcomeKey(listing.outcome))}
                                {listing.reason != null && (
                                  <span className="monitoring__listingReason"> · {listing.reason}</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {runsLoading && <p className="monitoring__empty">{t('admin.monitoring.loadingRuns')}</p>}
                    {!runsLoading && (ledgerGranularity === 'provider' ? runs.length === 0 : listings.length === 0) && (
                      <p className="monitoring__empty">
                        {ledgerGranularity === 'provider'
                          ? t('admin.monitoring.noRuns')
                          : t('admin.monitoring.noListings')}
                      </p>
                    )}
                  </div>
                </>
              )}
            </>
          ) : (
            <p className="monitoring__empty">{t('admin.monitoring.noData')}</p>
          )}
        </div>
      </section>

      <p className="monitoring__footnote">
        {t('admin.monitoring.footnote')}
        {overview
          ? ` ${t('admin.monitoring.overhead', { reads: String(overview.overhead.providerPass.reads), writes: String(overview.overhead.providerPass.writesNormally), refreshReads: String(overview.overhead.refresh.rollupReads) })}`
          : ''}
      </p>
    </div>
  );
}

MonitoringPage.displayName = 'MonitoringPage';
