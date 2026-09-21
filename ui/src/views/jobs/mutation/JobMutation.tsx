/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Fragment, useState, useCallback, useEffect, useRef } from 'react';

import NotificationChannelPicker from './components/notificationAdapter/NotificationChannelPicker.jsx';
import NotificationChannelEditor from './components/notificationAdapter/NotificationChannelEditor.jsx';
import ProviderMutator from './components/provider/ProviderMutator.jsx';
import GuidedJobForm from './GuidedJobForm';
import Headline from '../../../components/headline/Headline.jsx';
import ListingDeletionModal from '../../../components/ListingDeletionModal.jsx';
import { useActions, useSelector } from '../../../services/state/store.js';
import { xhrDelete, xhrPost, errorMessage } from '../../../services/xhr.js';
import { useNavigate, useParams, useLocation } from 'react-router';
import { Button, Toast, Banner } from '@douyinfe/semi-ui-19';
import './JobMutation.less';
import { loadDraft, saveDraft, clearDraft } from '../../../services/jobs/jobDraft.js';
import { missingRequirements } from '../../../services/jobs/jobValidation.js';
import { describeJobRefinements } from '../../../services/jobs/jobSummary.js';
import { withReturnTo } from '../../../services/routes/returnTo.js';
import { formatEuro } from '../../../components/cards/chartTheme.js';
// The frontend copy of the server's detection. The two must agree: the pipeline falls back to its
// own when a job carries no deal type, so a form that guessed differently would show one thing and
// store another. Kept in step by test/ui/dealTypeCopyInSync.test.js.
import { detectDealTypeFromUrl } from '../../../services/jobs/dealType.js';
import { isInquiryContactProfileReady } from '../../../services/inquiries/profile.js';
import {
  buildGuidedJobPayload,
  firstBlockedGuidedStep,
  migrateLegacyDraftProviderPolicies,
  resolveProviderSource,
  missingGuidedRequirements,
  setSourceAutomaticPolicy,
} from '../../../services/jobs/guidedSearchForm.js';
import { IconArrowLeft } from '@douyinfe/semi-icons';
import { useTranslation, useLocale } from '../../../services/i18n/i18n.jsx';
import type { GuidedProviderSource, ProviderMetadata } from '../../../services/jobs/guidedSearchForm.js';
import type { Job, ShareableUser } from '../../../services/state/jobsState';
import type { NotificationChannelSummary } from '../../../services/state/notificationState';

type NotificationChannel = NotificationChannelSummary & { id: string };
type ChannelEditorState = { mode: 'edit' | 'clone'; channelId: string } | null;
type ProviderEditData = { newData: GuidedProviderSource; oldProviderToEdit: GuidedProviderSource };

interface JobMutationStoreState {
  jobsData: { jobs: readonly Job[]; shareableUserList: readonly ShareableUser[] };
  notificationChannels: { channels: readonly NotificationChannel[] };
  provider: readonly ProviderMetadata[];
  userSettings: {
    settings?: {
      inquiry_profile?: Record<string, unknown>;
      listing_deletion_preference?: { hardDelete?: boolean; skipPrompt?: boolean };
    };
  };
}

interface JobMutationActions {
  jobsData: { getJobs: () => Promise<void> };
  notificationChannels: { getChannels: () => Promise<void>; tryChannel: (channelId: string) => Promise<void> };
  userSettings: {
    setListingDeletionPreference: (preference: { skipPrompt: boolean; hardDelete: boolean }) => Promise<void>;
  };
}

type PendingDeletion = 'job' | 'listings' | null;

interface JobDraft {
  name?: string | null;
  dealType?: 'rent' | 'buy' | null;
  providerData?: readonly GuidedProviderSource[];
  selectedChannelIds?: string[];
  blacklist?: string[];
  shareWithUsers?: string[];
  enabled?: boolean;
  spatialFilter?: unknown | null;
  specFilter?: Record<string, unknown> | null;
  commuteFilter?: unknown | null;
  autoSendInquiry?: boolean;
}

export default function JobMutator() {
  const t = useTranslation();
  const locale = useLocale();

  const SPEC_FILTERS = [
    { key: 'maxPrice', translation: t('jobs.mutation.filterMaxPrice') },
    { key: 'minSize', translation: t('jobs.mutation.filterMinSize') },
    { key: 'minRooms', translation: t('jobs.mutation.filterMinRooms') },
  ];

  const jobs = useSelector<JobMutationStoreState, readonly Job[]>((state) => state.jobsData.jobs);
  const shareableUserList = useSelector<JobMutationStoreState, readonly ShareableUser[]>(
    (state) => state.jobsData.shareableUserList,
  );
  const allChannels = useSelector<JobMutationStoreState, readonly NotificationChannel[]>(
    (state) => state.notificationChannels.channels,
  );
  const providerMetadata = useSelector<JobMutationStoreState, readonly ProviderMetadata[]>((state) => state.provider);
  const inquiryProfile = useSelector<JobMutationStoreState, Record<string, unknown> | undefined>(
    (state) => state.userSettings.settings?.inquiry_profile,
  );
  const listingDeletionPreference = useSelector<
    JobMutationStoreState,
    { hardDelete?: boolean; skipPrompt?: boolean } | undefined
  >((state) => state.userSettings.settings?.listing_deletion_preference);
  const params = useParams();
  const location = useLocation();

  const cloneFromId = location.state?.cloneFrom;
  const jobToClone = cloneFromId ? jobs.find((job) => job.id === cloneFromId) : null;
  const jobToBeEdit = params.jobId == null ? null : jobs.find((job) => job.id === params.jobId);

  const sourceJob = jobToBeEdit || jobToClone;

  const defaultBlacklist = (sourceJob?.blacklist || []).filter((entry): entry is string => typeof entry === 'string');
  const defaultName = jobToClone ? `Copy of - ${sourceJob?.name}` : sourceJob?.name || null;
  const defaultProviderData = (sourceJob?.provider || []) as GuidedProviderSource[];
  // The job stores references, and a read hands back the hydrated adapter shape carrying the
  // channel id. Ids are what this form keeps: they are here at mount like every other default
  // below, whereas the channel records they name are fetched separately and arrive later.
  const sourceChannelIds = (sourceJob?.notificationAdapter || [])
    .map((adapter) => (adapter as Record<string, unknown>).configuredAdapterId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const defaultEnabled = sourceJob?.enabled ?? true;
  const defaultShareWithUsers = sourceJob?.shared_with_user ?? [];
  const defaultSpatialFilter = sourceJob?.spatialFilter || null;
  const defaultSpecFilter = (sourceJob?.specFilter as Record<string, unknown> | null | undefined) || null;
  const defaultCommuteFilter = sourceJob?.commuteFilter || null;
  const defaultAutoSendInquiry = sourceJob?.autoSendInquiry ?? false;
  // Deliberately not defaulted for a new job: the user has to say what they are looking for,
  // because it decides which half of their finance profile applies to everything this job finds.
  const defaultDealType = sourceJob?.dealType || null;

  const [providerToEdit, setProviderToEdit] = useState<GuidedProviderSource | null>(null);
  const [providerCreationVisible, setProviderCreationVisibility] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [channelEditor, setChannelEditor] = useState<ChannelEditorState>(null);
  const [providerData, setProviderData] = useState<GuidedProviderSource[]>(defaultProviderData);
  const [name, setName] = useState<string | null>(defaultName);
  const [blacklist, setBlacklist] = useState<string[]>(defaultBlacklist as string[]);
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>(sourceChannelIds);
  const [shareWithUsers, setShareWithUsers] = useState<string[]>(defaultShareWithUsers as string[]);
  const [enabled, setEnabled] = useState<boolean>(defaultEnabled);
  const [spatialFilter, setSpatialFilter] = useState<unknown | null>(defaultSpatialFilter);
  const [specFilter, setSpecFilter] = useState<Record<string, unknown> | null>(defaultSpecFilter);
  const [commuteFilter, setCommuteFilter] = useState<unknown | null>(defaultCommuteFilter);
  // Retained only so legacy drafts can still round-trip; guided saves never send this field and no
  // visible job-wide control is rendered.
  const [autoSendInquiry, setAutoSendInquiry] = useState<boolean>(defaultAutoSendInquiry);
  const [dealType, setDealType] = useState<'rent' | 'buy' | null>(defaultDealType);
  /** Whether the value in the deal type field was guessed rather than chosen. */
  const [dealTypeWasInferred, setDealTypeWasInferred] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const guidedPanelRef = useRef<HTMLElement | null>(null);
  const policyProfileReady = useCallback(
    (source: GuidedProviderSource) => {
      const resolved = resolveProviderSource(source, providerMetadata).source;
      return isInquiryContactProfileReady(inquiryProfile, resolved?.id);
    },
    [inquiryProfile, providerMetadata],
  );

  // Derived on every render rather than kept alongside the ids. A second copy of the selection in
  // state is a copy that has to be resolved once the channels load and then kept in step, and the
  // effect that did that used to put a removed channel straight back: it saw an empty selection,
  // could not tell "the user just removed the last one" from "not resolved yet", and refilled it.
  // An id nothing answers to falls out here - its channel was deleted, or is no longer shared with
  // this user - so what is saved below is always what the table showed.
  const selectedChannels = selectedChannelIds
    .map((id) => allChannels.find((channel) => channel.id === id))
    .filter((channel): channel is NotificationChannel => channel != null);
  const navigate = useNavigate();
  const actions = useActions<JobMutationActions>();

  /** Whether the drawing map has been given the full height it used to always occupy. */
  const [areaExpanded, setAreaExpanded] = useState(false);

  const draftId = params.jobId ?? null;
  const [draftRestored, setDraftRestored] = useState(false);
  /** Whether the restore attempt has run. Until it has, nothing may be written back over it. */
  const draftChecked = useRef(false);

  // Memoize the spatial filter change handler to prevent map reinitializations
  const handleSpatialFilterChange = useCallback((data: unknown) => {
    setSpatialFilter(data);
  }, []);

  useEffect(() => {
    actions.notificationChannels.getChannels();
  }, [actions]);

  // Pick up whatever was left behind last time. The two links this form offers - "Manage channels"
  // and the picker's empty state - both navigate away and unmount it, and a first-time user has to
  // follow one of them, because a job needs a channel and channels are made on the Settings page.

  // Without this, that detour silently threw away everything they had typed.
  useEffect(() => {
    if (draftChecked.current) return;
    draftChecked.current = true;

    const draft = loadDraft(draftId) as JobDraft | null;
    if (draft == null) return;

    if (draft.name !== undefined) setName(draft.name);
    if (draft.dealType !== undefined) setDealType(draft.dealType);
    if (draft.providerData !== undefined) {
      setProviderData(
        migrateLegacyDraftProviderPolicies(draft.providerData, draft.autoSendInquiry === true, providerMetadata),
      );
    }
    if (draft.selectedChannelIds !== undefined) setSelectedChannelIds(draft.selectedChannelIds);
    if (draft.blacklist !== undefined) setBlacklist(draft.blacklist);
    if (draft.shareWithUsers !== undefined) setShareWithUsers(draft.shareWithUsers);
    if (draft.enabled !== undefined) setEnabled(draft.enabled);
    if (draft.spatialFilter !== undefined) setSpatialFilter(draft.spatialFilter);
    if (draft.specFilter !== undefined) setSpecFilter(draft.specFilter);
    if (draft.commuteFilter !== undefined) setCommuteFilter(draft.commuteFilter);
    if (draft.autoSendInquiry !== undefined) setAutoSendInquiry(draft.autoSendInquiry);
    setDraftRestored(true);
  }, [draftId]);

  useEffect(() => {
    if (providerMetadata.length === 0) return;
    setProviderData((current) => current.map((source) => resolveProviderSource(source, providerMetadata).source));
  }, [providerMetadata]);

  // Written straight through rather than debounced: the payload is a few hundred bytes and the
  // write is synchronous, so a keystroke costs less than the render it already triggered.
  useEffect(() => {
    if (!draftChecked.current) return;
    saveDraft(draftId, {
      name,
      dealType,
      providerData,
      selectedChannelIds,
      blacklist,
      shareWithUsers,
      enabled,
      spatialFilter,
      specFilter,
      commuteFilter,
      autoSendInquiry,
    });
  }, [
    draftId,
    name,
    dealType,
    providerData,
    selectedChannelIds,
    blacklist,
    shareWithUsers,
    enabled,
    spatialFilter,
    specFilter,
    commuteFilter,
    autoSendInquiry,
  ]);

  // The deal type decides which half of the finance profile applies to everything this job finds,
  // and the search URL the user just pasted almost always says which it is.
  const inferredDealType =
    providerData.map((provider) => detectDealTypeFromUrl(provider.url)).find((type) => type != null) ?? null;

  // Offered as a starting value, never as a decision: an ambiguous URL leaves the field empty, a
  // value the user has already chosen is never overwritten, and the guess can always be corrected.
  useEffect(() => {
    if (dealType != null || inferredDealType == null) return;
    setDealType(inferredDealType);
    setDealTypeWasInferred(true);
  }, [inferredDealType, dealType]);

  /**
   * Leave the form for somewhere that can only be reached by unmounting it, carrying a way back.
   * @param {string} to
   * @returns {void}
   */
  const leaveWithReturnPath = (to: string) => navigate(withReturnTo(to, `${location.pathname}${location.search}`));

  const discardDraft = () => {
    clearDraft(draftId);
    setDraftRestored(false);
    setName(defaultName);
    setDealType(defaultDealType);
    setProviderData(defaultProviderData);
    setSelectedChannelIds(sourceChannelIds);
    setBlacklist(defaultBlacklist);
    setShareWithUsers(defaultShareWithUsers);
    setEnabled(defaultEnabled);
    setSpatialFilter(defaultSpatialFilter);
    setSpecFilter(defaultSpecFilter);
    setCommuteFilter(defaultCommuteFilter);
    setAutoSendInquiry(defaultAutoSendInquiry);
  };

  const leaveForm = () => {
    clearDraft(draftId);
    navigate('/jobs');
  };

  const handleSpecFilterChange = (key: string, value: unknown) => {
    if (!SPEC_FILTERS.map(({ key: filterKey }) => filterKey).includes(key)) return;

    const numericValue =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.length > 0
          ? Number.parseFloat(value)
          : null;
    setSpecFilter({ ...specFilter, [key]: numericValue });
  };

  const formState = { name, dealType, providerData, selectedChannels };
  const missing = missingRequirements(formState);
  const requirementLabels = {
    name: t('jobs.mutation.sectionName'),
    provider: t('jobs.mutation.sectionProviders'),
    dealType: t('jobs.mutation.sectionDealType'),
    channel: t('jobs.mutation.sectionNotifications'),
  };

  const announceValidation = (step: number) => {
    const requirement = missingGuidedRequirements(step, formState)[0];
    if (!requirement) {
      setValidationError(null);
      return false;
    }
    setCurrentStep(step);
    setValidationError(t('jobs.mutation.guidedValidation', { field: requirementLabels[requirement.key] }));
    return true;
  };

  const handleStepSelect = (targetStep: number) => {
    if (targetStep <= currentStep) {
      setValidationError(null);
      setCurrentStep(targetStep);
      return;
    }
    const blockedStep = firstBlockedGuidedStep(formState, targetStep);
    if (blockedStep != null) {
      announceValidation(blockedStep);
      return;
    }
    setValidationError(null);
    setCurrentStep(targetStep);
  };

  const handleContinue = () => {
    if (announceValidation(currentStep)) return;
    setValidationError(null);
    setCurrentStep((step) => Math.min(step + 1, 3));
  };

  const handleBack = () => {
    setValidationError(null);
    setCurrentStep((step) => Math.max(step - 1, 0));
  };

  const refinementSummary = describeJobRefinements(
    { blacklist, specFilter, spatialFilter, commuteFilter, shareWithUsers, enabled },
    { t, formatPrice: (value) => formatEuro(value, locale) },
  );
  const reviewSummary = refinementSummary.length > 0 ? refinementSummary : [t('jobs.mutation.guidedReviewNoFilters')];

  const handleProviderEdit = (data: ProviderEditData) => {
    setProviderData(
      providerData.map((provider) =>
        provider.url === data.oldProviderToEdit.url
          ? { ...data.newData, applicationPolicy: data.newData.applicationPolicy ?? provider.applicationPolicy }
          : provider,
      ),
    );
  };

  const handleProviderPolicyChange = (source: GuidedProviderSource, enabledPolicy: boolean) => {
    setProviderData((current) =>
      current.map((provider) =>
        provider.url === source.url
          ? setSourceAutomaticPolicy(provider, providerMetadata, enabledPolicy, {
              profileReady: policyProfileReady(resolveProviderSource(provider, providerMetadata).source),
            })
          : provider,
      ),
    );
  };

  const mutateJob = async () => {
    try {
      await xhrPost(
        '/api/jobs',
        buildGuidedJobPayload({
          providerData,
          providerMetadata,
          selectedChannels,
          shareWithUsers,
          name,
          blacklist,
          spatialFilter,
          specFilter,
          commuteFilter,
          dealType,
          enabled,
          jobId: jobToBeEdit?.id || null,
        }),
      );
      await actions.jobsData.getJobs();
      // Only once the save actually landed. Clearing before would throw the draft away on a
      // rejection, which is exactly when it is worth the most.
      clearDraft(draftId);
      Toast.success(t('jobs.mutation.saved'));
      navigate('/jobs');
    } catch (Exception) {
      // The rejection carries the reason under `json.error`; reading `json.message` produced
      // `Toast.error(undefined)`, so a refused save rendered an empty toast and looked like nothing
      // had happened at all.
      console.error('Error while trying to save the job.', Exception);
      Toast.error(errorMessage(Exception, t('jobs.mutation.saveError')));
    }
  };

  const handleTestChannel = async (channel: NotificationChannel) => {
    try {
      await actions.notificationChannels.tryChannel(channel.id);
      Toast.success(t('notification.trySuccess'));
    } catch (error) {
      Toast.error(t('notification.tryError', { error: errorMessage(error, t('common.unknownError')) }));
    }
  };

  const confirmDeletion = async (
    hardDelete: boolean,
    remember: boolean = false,
    deletion: Exclude<PendingDeletion, null> | null = pendingDeletion,
  ) => {
    const jobId = jobToBeEdit?.id;
    if (jobId == null || deletion == null) return;
    try {
      if (deletion === 'listings') {
        if (remember) {
          await actions.userSettings.setListingDeletionPreference({ skipPrompt: true, hardDelete });
        }
        await xhrDelete('/api/listings/job', { jobId, hardDelete });
        Toast.success(t('jobs.toastListingsDeleted'));
      } else {
        await xhrDelete('/api/jobs', { jobId });
        await actions.jobsData.getJobs();
        clearDraft(draftId);
        Toast.success(t('jobs.toastDeletedWithListings'));
        navigate('/jobs');
      }
    } catch (error) {
      Toast.error(errorMessage(error, t('jobs.toastDeleteError')));
    } finally {
      setPendingDeletion(null);
    }
  };

  const requestDeletion = (deletion: Exclude<PendingDeletion, null>) => {
    if (jobToBeEdit == null) return;
    if (deletion === 'listings' && listingDeletionPreference?.skipPrompt) {
      void confirmDeletion(Boolean(listingDeletionPreference.hardDelete), false, deletion);
      return;
    }
    setPendingDeletion(deletion);
  };

  return (
    <Fragment>
      <ProviderMutator
        visible={providerCreationVisible}
        onVisibilityChanged={(visible: boolean) => setProviderCreationVisibility(visible)}
        onData={(data: GuidedProviderSource) => {
          setProviderData([...providerData, data]);
        }}
        onEditData={handleProviderEdit}
        providerToEdit={providerToEdit}
      />

      <NotificationChannelPicker
        visible={pickerVisible}
        selectedIds={selectedChannelIds}
        onClose={() => setPickerVisible(false)}
        onPick={(channel: { id: string }) => setSelectedChannelIds((current) => [...current, channel.id])}
        onManageChannels={() => leaveWithReturnPath('/settings/notifications')}
      />

      {channelEditor && (
        <NotificationChannelEditor
          visible
          mode={channelEditor.mode}
          channelId={channelEditor.channelId}
          // Opened from inside a job, even one *other* job matters: the person editing is thinking
          // about this job alone and would not expect to change somebody else's.
          warnUsageAbove={2}
          onClose={() => setChannelEditor(null)}
          onSaved={(saved: { id: string }) =>
            setSelectedChannelIds((current) =>
              // A "Duplicate instead" from the editor returns a different channel, so the job is
              // repointed at the copy and the original is left alone for the jobs still using it.
              current.map((id) => (id === channelEditor.channelId ? saved.id : id)),
            )
          }
        />
      )}

      <Headline
        text={jobToBeEdit ? t('jobs.mutation.editTitle') : t('jobs.mutation.createTitle')}
        actions={
          <Button icon={<IconArrowLeft />} onClick={leaveForm} theme="borderless" style={{ color: 'var(--f-muted)' }}>
            {t('jobs.mutation.back')}
          </Button>
        }
      />
      {draftRestored && (
        <Banner
          type="info"
          fullMode={false}
          closeIcon={null}
          style={{ marginBottom: '1rem' }}
          description={
            <div className="jobMutation__draftBanner">
              <span>{t('jobs.mutation.draftRestored')}</span>
              <Button size="small" theme="borderless" onClick={discardDraft}>
                {t('jobs.mutation.draftDiscard')}
              </Button>
            </div>
          }
        />
      )}
      <GuidedJobForm
        currentStep={currentStep}
        onStepSelect={handleStepSelect}
        onBack={handleBack}
        onContinue={handleContinue}
        onSave={mutateJob}
        validationError={validationError}
        panelRef={guidedPanelRef}
        name={name}
        setName={(value) => {
          setName(value);
          setValidationError(null);
        }}
        providerData={providerData}
        providerMetadata={providerMetadata}
        policyProfileReady={policyProfileReady}
        onProviderPolicyChange={handleProviderPolicyChange}
        onProviderAdd={() => {
          setProviderToEdit(null);
          setProviderCreationVisibility(true);
        }}
        onProviderRemove={(providerUrl) =>
          setProviderData((current) => current.filter((provider) => provider.url !== providerUrl))
        }
        onProviderEdit={(provider) => {
          setProviderCreationVisibility(true);
          setProviderToEdit(provider);
        }}
        onCompleteInquiryProfile={() => leaveWithReturnPath('/settings/inquiry-profile')}
        dealType={dealType}
        setDealType={(value) => {
          setDealType(value);
          setDealTypeWasInferred(false);
          setValidationError(null);
        }}
        dealTypeWasInferred={dealTypeWasInferred}
        specFilters={SPEC_FILTERS}
        specFilter={specFilter}
        onSpecFilterChange={handleSpecFilterChange}
        blacklist={blacklist}
        setBlacklist={(value) => {
          setBlacklist(value);
          setValidationError(null);
        }}
        spatialFilter={spatialFilter}
        onSpatialFilterChange={handleSpatialFilterChange}
        areaExpanded={areaExpanded}
        setAreaExpanded={setAreaExpanded}
        commuteFilter={commuteFilter}
        setCommuteFilter={setCommuteFilter}
        selectedChannels={selectedChannels}
        onAddNotification={() => setPickerVisible(true)}
        onManageNotifications={() => leaveWithReturnPath('/settings/notifications')}
        onTestChannel={handleTestChannel}
        onEditChannel={(channel) => setChannelEditor({ mode: 'edit', channelId: channel.id })}
        onCloneChannel={(channel) => setChannelEditor({ mode: 'clone', channelId: channel.id })}
        onDetachChannel={(channel) => setSelectedChannelIds((current) => current.filter((id) => id !== channel.id))}
        shareableUserList={shareableUserList}
        shareWithUsers={shareWithUsers}
        setShareWithUsers={setShareWithUsers}
        enabled={enabled}
        setEnabled={setEnabled}
        reviewSummary={reviewSummary}
        canSave={missing.length === 0}
        isEditing={jobToBeEdit != null}
        onClearListings={() => requestDeletion('listings')}
        onDeleteSearch={() => requestDeletion('job')}
      />

      <ListingDeletionModal
        visible={pendingDeletion != null}
        title={pendingDeletion === 'job' ? t('jobs.deletion.title') : t('listing.deletion.title')}
        showOptions={pendingDeletion === 'listings'}
        defaultDeleteType={listingDeletionPreference?.hardDelete ? 'hard' : 'soft'}
        message={pendingDeletion === 'job' ? t('jobs.deletion.message') : t('listing.deletion.message')}
        onConfirm={confirmDeletion}
        onCancel={() => setPendingDeletion(null)}
      />
    </Fragment>
  );
}
