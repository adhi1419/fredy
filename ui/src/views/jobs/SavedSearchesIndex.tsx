/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Button, Empty, Input, Pagination, Popover, Radio, RadioGroup, Select, Tag, Toast } from '@douyinfe/semi-ui-19';
import { IconAlertTriangle, IconArrowDown, IconArrowUp, IconMoreStroked, IconSearch } from '@douyinfe/semi-icons';
import { IllustrationNoResult, IllustrationNoResultDark } from '@douyinfe/semi-illustrations';
import { useNavigate } from 'react-router';
import ListingDeletionModal from '../../components/ListingDeletionModal.jsx';
import FilterButton from '../../components/filters/FilterButton.jsx';
import ActiveFilterChips from '../../components/filters/ActiveFilterChips.jsx';
import FilterDrawer, { FilterGroup, FilterHelp } from '../../components/filters/FilterDrawer.jsx';
import {
  clearAllFilters,
  clearFilter,
  countActiveFilters,
  describeActiveFilters,
} from '../../services/jobs/jobFilters.js';
import { summariseJobRefinements } from '../../services/jobs/jobSummary.js';
import { formatEuroPrice } from '../../services/price/priceService.js';
import { useActions, useSelector } from '../../services/state/store.js';
import type { Job } from '../../services/state/jobsState';
import { createAuthenticatedEventStream } from '../../services/sse/authenticatedEventStream.js';
import { format as formatDate } from '../../services/time/timeService.js';
import { errorMessage, xhrDelete, xhrPost, xhrPut } from '../../services/xhr.js';
import { useLocale, useTranslation } from '../../services/i18n/i18n.jsx';
import { debounce } from '../../utils.js';
import { getSavedSearchDirectAction, shouldShowPause } from './savedSearchActions';
import './SavedSearchesIndex.less';

interface SavedSearchStoreState {
  jobsData: { result: readonly Job[]; totalNumber?: number };
  userSettings: {
    settings?: { listing_deletion_preference?: { hardDelete?: boolean; skipPrompt?: boolean } };
  };
}

interface SavedSearchActions {
  jobsData: {
    getJobs: () => Promise<void>;
    getJobsData: (params?: Record<string, unknown>) => Promise<void>;
    setJobRunning: (jobId: string, running: boolean) => void;
  };
  userSettings: {
    setListingDeletionPreference: (preference: { skipPrompt: boolean; hardDelete: boolean }) => Promise<void>;
  };
}

type PendingDeletion = { type: 'job' | 'listings'; jobId: string };
type Translation = (key: string, vars?: Record<string, string | number>) => string;
type JobAction = (jobId: string) => void;
type StatusAction = (jobId: string, enabled: boolean) => void;

interface SavedSearchRowProps {
  job: Job;
  locale: string;
  t: Translation;
  onRun: JobAction;
  onEdit: JobAction;
  onRepair: JobAction;
  onClone: JobAction;
  onDeleteListings: JobAction;
  onDeleteJob: JobAction;
  onStatusChange: StatusAction;
}

interface ActionMenuProps {
  job: Job;
  t: Translation;
  onPause: JobAction;
  onRepair: JobAction;
  onClone: JobAction;
  onDeleteListings: JobAction;
  onDeleteJob: JobAction;
}

function providerCount(job: Job): number {
  return Array.isArray(job.provider) ? job.provider.length : 0;
}

function channelCount(job: Job): number {
  return Array.isArray(job.notificationAdapter) ? job.notificationAdapter.length : 0;
}

function criteriaFor(job: Job, t: Translation, locale: string): string {
  const dealType =
    job.dealType === 'buy'
      ? t('jobs.mutation.dealTypeBuy')
      : job.dealType === 'rent'
        ? t('jobs.mutation.dealTypeRent')
        : t('jobs.index.anyDeal');
  const criteria = summariseJobRefinements(job, {
    t,
    formatPrice: (value: number) => formatEuroPrice(value, locale),
  });

  return [
    dealType,
    t('jobs.index.providerCount', { count: String(providerCount(job)) }),
    t('jobs.index.channelCount', { count: String(channelCount(job)) }),
    criteria !== t('jobs.mutation.refineEmpty') ? criteria : null,
  ]
    .filter((part): part is string => part != null)
    .join(' · ');
}

function lastRunFor(job: Job, locale: string, t: Translation): string {
  return job.lastRunAt == null ? t('jobs.index.neverRun') : formatDate(job.lastRunAt, false, locale);
}

function ActionMenu({ job, t, onPause, onRepair, onClone, onDeleteListings, onDeleteJob }: ActionMenuProps) {
  const readOnly = job.isOnlyShared === true;
  const action = (label: string, callback: () => void, disabled = false) => (
    <Button
      theme="borderless"
      block
      disabled={disabled}
      className="savedSearches__menuAction"
      role="menuitem"
      onClick={callback}
    >
      {label}
    </Button>
  );

  const content: ReactNode = (
    <div
      className="savedSearches__menu"
      role="menu"
      aria-label={t('jobs.index.overflowFor', { name: String(job.name ?? t('jobs.index.unnamed')) })}
    >
      {shouldShowPause(job) && action(t('jobs.index.pause'), () => onPause(job.id))}
      {action(t('jobs.index.runAndRepair'), () => onRepair(job.id), readOnly)}
      {action(t('jobs.index.clone'), () => onClone(job.id), readOnly)}
      {action(t('jobs.index.deleteListings'), () => onDeleteListings(job.id), readOnly)}
      {action(t('jobs.index.delete'), () => onDeleteJob(job.id), readOnly)}
    </div>
  );

  return (
    <Popover content={content} position="bottomRight">
      <Button
        theme="borderless"
        className="savedSearches__overflowButton"
        icon={<IconMoreStroked aria-hidden="true" />}
        aria-label={t('jobs.index.overflowFor', { name: String(job.name ?? t('jobs.index.unnamed')) })}
        disabled={readOnly}
      />
    </Popover>
  );
}

function SavedSearchRow({
  job,
  locale,
  t,
  onRun,
  onEdit,
  onRepair,
  onClone,
  onDeleteListings,
  onDeleteJob,
  onStatusChange,
}: SavedSearchRowProps) {
  const readOnly = job.isOnlyShared === true;
  const statusLabel =
    job.running === true ? t('jobs.index.running') : job.enabled ? t('jobs.index.active') : t('jobs.index.paused');
  const name = String(job.name ?? t('jobs.index.unnamed'));
  const directAction = getSavedSearchDirectAction(job, t);
  const onDirectAction =
    directAction.kind === 'run'
      ? () => onRun(job.id)
      : directAction.kind === 'resume'
        ? () => onStatusChange(job.id, true)
        : undefined;

  // The whole editable row is the primary way into the editor. Read-only (shared) rows are never
  // editable, so they get no button semantics, no tab stop and no handlers at all.
  const openEditor = readOnly ? undefined : () => onEdit(job.id);
  const editableProps = readOnly
    ? {}
    : {
        role: 'button' as const,
        tabIndex: 0,
        'aria-label': t('jobs.index.directActionFor', { action: t('jobs.index.editHint'), name }),
        onClick: (event: MouseEvent<HTMLElement>) => {
          if (event.target instanceof Element && event.target.closest('.savedSearches__rowActions')) return;
          openEditor?.();
        },
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
          // Only the row's own Enter/Space should edit. A key event that bubbled up from a nested
          // control (its target is not the row itself) is left to that control.
          if (event.currentTarget !== event.target) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openEditor?.();
          }
        },
      };

  return (
    <article
      className={`savedSearches__row${readOnly ? '' : ' savedSearches__row--editable'}`}
      data-job-id={job.id}
      {...editableProps}
    >
      <div className="savedSearches__identity">
        <span
          className={`savedSearches__statusDot${job.enabled ? ' savedSearches__statusDot--active' : ''}`}
          aria-hidden="true"
        />
        <div className="savedSearches__identityCopy">
          <h2>{name}</h2>
          <p>
            <span className="savedSearches__fieldLabel">{t('jobs.index.criteria')}:</span> {criteriaFor(job, t, locale)}
          </p>
        </div>
      </div>

      <div className="savedSearches__state">
        <span className="savedSearches__fieldLabel">{t('jobs.index.state')}</span>
        <div className="savedSearches__stateControl">
          <Tag color={job.enabled ? 'green' : 'grey'} size="small">
            {statusLabel}
          </Tag>
        </div>
        {readOnly && (
          <span className="savedSearches__shared" title={t('jobs.cardSharedReadOnly')}>
            <IconAlertTriangle aria-hidden="true" /> {t('jobs.index.sharedReadOnly')}
          </span>
        )}
      </div>

      <div className="savedSearches__lastRun">
        <span className="savedSearches__fieldLabel">{t('jobs.index.lastRun')}</span>
        <strong>{lastRunFor(job, locale, t)}</strong>
        <small>{t('jobs.index.listingsFound', { count: String(job.numberOfFoundListings || 0) })}</small>
      </div>

      <div className="savedSearches__rowActions">
        <Button
          type="primary"
          theme="solid"
          className="savedSearches__directAction"
          disabled={directAction.disabled}
          aria-label={t('jobs.index.directActionFor', { action: directAction.label, name })}
          onClick={onDirectAction}
        >
          {directAction.label}
        </Button>
        <ActionMenu
          job={job}
          t={t}
          onPause={(id) => onStatusChange(id, false)}
          onRepair={onRepair}
          onClone={onClone}
          onDeleteListings={onDeleteListings}
          onDeleteJob={onDeleteJob}
        />
      </div>
    </article>
  );
}

export default function SavedSearchesIndex() {
  const t = useTranslation();
  const locale = useLocale();
  const jobsData = useSelector((state: SavedSearchStoreState) => state.jobsData);
  const actions = useActions<SavedSearchActions>();
  const navigate = useNavigate();
  const userSettings = useSelector((state: SavedSearchStoreState) => state.userSettings.settings);
  const listingDeletionPref = userSettings?.listing_deletion_preference;
  const defaultDeleteType = listingDeletionPref?.hardDelete ? 'hard' : 'soft';

  const [page, setPage] = useState(1);
  const pageSize = 12;
  const [sortField, setSortField] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [freeTextFilter, setFreeTextFilter] = useState<string | null>(null);
  const [activityFilter, setActivityFilter] = useState<boolean | null>(null);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterValues = { active: activityFilter };
  const activeFilterCount = countActiveFilters(filterValues);

  const applyFilterPatch = (patch: Record<string, unknown>) => {
    if ('active' in patch) {
      setActivityFilter((patch.active as boolean | null) ?? null);
    }
    if (patch.page != null) {
      setPage(Number(patch.page));
    }
  };

  const pendingJobIdRef = useRef<string | null>(null);
  const evtSourceRef = useRef<{ start: () => void; close: () => void } | null>(null);

  const loadData = () => {
    actions.jobsData.getJobsData({
      page,
      pageSize,
      sortfield: sortField,
      sortdir: sortDir,
      freeTextFilter,
      filter: { activityFilter },
    });
  };

  const loadDataRef = useRef(loadData);
  loadDataRef.current = loadData;

  useEffect(() => {
    loadData();
  }, [page, sortField, sortDir, freeTextFilter, activityFilter]);

  useEffect(() => {
    const stream = createAuthenticatedEventStream('/api/jobs/events', {
      onEvent: (event: { type: string; data?: string }) => {
        if (event.type !== 'jobStatus') return;
        try {
          const data = JSON.parse(event.data || '{}') as { jobId?: string; running?: boolean };
          if (data.jobId) {
            actions.jobsData.setJobRunning(data.jobId, Boolean(data.running));
            if (data.running === false) {
              loadDataRef.current();
              if (pendingJobIdRef.current === data.jobId) {
                Toast.success(t('jobs.toastFinished'));
                pendingJobIdRef.current = null;
              }
            }
          }
        } catch {
          // Ignore malformed events; the next valid status event will repair the row.
        }
      },
    });
    evtSourceRef.current = stream;
    stream.start();

    return () => {
      stream.close();
      evtSourceRef.current = null;
      pendingJobIdRef.current = null;
    };
  }, [actions.jobsData, t]);

  const handleFilterChange = useMemo(() => debounce((value: string) => setFreeTextFilter(value), 500), []);

  useEffect(() => {
    return () => {
      handleFilterChange.cancel?.();
    };
  }, [handleFilterChange]);

  const onJobRemoval = (jobId: string) => {
    setPendingDeletion({ type: 'job', jobId });
    setDeleteModalVisible(true);
  };

  const onListingRemoval = (jobId: string) => {
    const deletion: PendingDeletion = { type: 'listings', jobId };
    if (listingDeletionPref?.skipPrompt) {
      void confirmDeletion(Boolean(listingDeletionPref.hardDelete), false, deletion);
      return;
    }
    setPendingDeletion(deletion);
    setDeleteModalVisible(true);
  };

  const confirmDeletion = async (
    hardDelete: boolean,
    remember: boolean,
    deletion: PendingDeletion | null = pendingDeletion,
  ) => {
    if (deletion == null) return;
    try {
      if (remember && deletion.type === 'listings') {
        await actions.userSettings.setListingDeletionPreference({ skipPrompt: true, hardDelete });
      }
      if (deletion.type === 'job') {
        await xhrDelete('/api/jobs', { jobId: deletion.jobId });
        Toast.success(t('jobs.toastDeletedWithListings'));
      } else {
        await xhrDelete('/api/listings/job', { jobId: deletion.jobId, hardDelete });
        Toast.success(t('jobs.toastListingsDeleted'));
      }
      loadData();
      if (deletion.type === 'job') {
        actions.jobsData.getJobs();
      }
    } catch (error) {
      Toast.error(errorMessage(error, t('jobs.toastDeleteError')));
    } finally {
      setDeleteModalVisible(false);
      setPendingDeletion(null);
    }
  };

  const onJobStatusChanged = async (jobId: string, status: boolean) => {
    try {
      await xhrPut(`/api/jobs/${jobId}/status`, { status });
      Toast.success(t('jobs.toastStatusChanged'));
      loadData();
      actions.jobsData.getJobs();
    } catch (error) {
      Toast.error(errorMessage(error, t('jobs.toastStatusChangeError')));
    }
  };

  const onJobRun = async (jobId: string) => {
    try {
      const response = await xhrPost(`/api/jobs/${jobId}/run`, {});
      if (response.status === 202) {
        Toast.success(t('jobs.toastRunStarted'));
      } else {
        Toast.info(t('jobs.toastRunRequested'));
      }
      pendingJobIdRef.current = jobId;
      loadData();
    } catch (error) {
      const status = (error as { status?: number })?.status;
      const message = (error as { json?: { message?: string } })?.json?.message;
      if (status === 409) {
        Toast.warning(message || t('jobs.toastAlreadyRunning'));
      } else if (status === 403) {
        Toast.error(t('jobs.toastNotAllowed'));
      } else if (status === 404) {
        Toast.error(t('jobs.toastNotFound'));
      } else {
        Toast.error(t('jobs.toastRunFailed'));
      }
    }
  };

  const jobs = (jobsData?.result || []) as readonly Job[];
  const totalNumber = jobsData?.totalNumber ?? 0;
  const editJob = (id: string) => navigate(`/jobs/edit/${id}`);
  const cloneJob = (id: string) => navigate('/jobs/new', { state: { cloneFrom: id } });

  return (
    <div className="savedSearches">
      <div className="savedSearches__toolbar">
        <Input
          className="savedSearches__search"
          prefix={<IconSearch aria-hidden="true" />}
          showClear
          placeholder={t('jobs.searchPlaceholder')}
          onChange={handleFilterChange}
        />
        <Select
          className="savedSearches__sort"
          prefix={t('jobs.sortPrefix')}
          value={sortField}
          onChange={(value) => setSortField(String(value))}
        >
          <Select.Option value="name">{t('jobs.sortByName')}</Select.Option>
          <Select.Option value="numberOfFoundListings">{t('jobs.sortByListings')}</Select.Option>
          <Select.Option value="enabled">{t('jobs.sortByStatus')}</Select.Option>
        </Select>
        <Button
          className="savedSearches__sortDirection"
          icon={sortDir === 'asc' ? <IconArrowUp aria-hidden="true" /> : <IconArrowDown aria-hidden="true" />}
          onClick={() => setSortDir((direction) => (direction === 'asc' ? 'desc' : 'asc'))}
          title={sortDir === 'asc' ? t('jobs.sortAscending') : t('jobs.sortDescending')}
          aria-label={sortDir === 'asc' ? t('jobs.sortAscending') : t('jobs.sortDescending')}
        />
        <FilterButton activeCount={activeFilterCount} onClick={() => setFiltersOpen(true)} />
      </div>

      <ActiveFilterChips
        chips={describeActiveFilters(filterValues, { t })}
        onRemove={(key: string) => applyFilterPatch(clearFilter(key))}
        onClearAll={() => applyFilterPatch(clearAllFilters())}
      />

      <FilterDrawer
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        activeCount={activeFilterCount}
        onClearAll={() => applyFilterPatch(clearAllFilters())}
      >
        <FilterGroup title={t('listings.filterGroupShow')}>
          <FilterHelp>{t('jobs.filterActivityHelp')}</FilterHelp>
          <RadioGroup
            type="button"
            buttonSize="middle"
            value={activityFilter === null ? 'all' : String(activityFilter)}
            onChange={(event) => {
              const value = event.target.value;
              applyFilterPatch({ active: value === 'all' ? null : value === 'true', page: 1 });
            }}
          >
            <Radio value="all">{t('jobs.filterAll')}</Radio>
            <Radio value="true">{t('jobs.filterActive')}</Radio>
            <Radio value="false">{t('jobs.filterInactive')}</Radio>
          </RadioGroup>
        </FilterGroup>
      </FilterDrawer>

      {jobs.length === 0 && (
        <Empty
          image={<IllustrationNoResult />}
          darkModeImage={<IllustrationNoResultDark />}
          description={t('jobs.empty')}
        />
      )}

      {jobs.length > 0 && (
        <section className="savedSearches__list" aria-label={t('jobs.title')}>
          {jobs.map((job) => (
            <SavedSearchRow
              key={job.id}
              job={job}
              locale={locale}
              t={t}
              onRun={onJobRun}
              onEdit={editJob}
              onRepair={onJobRun}
              onClone={cloneJob}
              onDeleteListings={onListingRemoval}
              onDeleteJob={onJobRemoval}
              onStatusChange={onJobStatusChanged}
            />
          ))}
        </section>
      )}

      <section className="savedSearches__createCard" aria-labelledby="savedSearches-create-heading">
        <div>
          <h2 id="savedSearches-create-heading">{t('jobs.index.addAnother')}</h2>
          <p>{t('jobs.index.addAnotherHelp')}</p>
        </div>
        <Button type="primary" theme="solid" onClick={() => navigate('/jobs/new')}>
          {t('jobs.newJob')}
        </Button>
      </section>

      {jobs.length > 0 && totalNumber > pageSize && (
        <div className="savedSearches__pagination">
          <Pagination
            currentPage={page}
            pageSize={pageSize}
            total={totalNumber}
            onPageChange={(nextPage) => setPage(nextPage)}
            showSizeChanger={false}
          />
        </div>
      )}

      <ListingDeletionModal
        visible={deleteModalVisible}
        title={pendingDeletion?.type === 'job' ? t('jobs.deletion.title') : t('listing.deletion.title')}
        showOptions={pendingDeletion?.type !== 'job'}
        defaultDeleteType={defaultDeleteType}
        message={pendingDeletion?.type === 'job' ? t('jobs.deletion.message') : t('listing.deletion.message')}
        onConfirm={confirmDeletion}
        onCancel={() => {
          setDeleteModalVisible(false);
          setPendingDeletion(null);
        }}
      />
    </div>
  );
}
