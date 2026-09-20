/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useEffect, useRef } from 'react';
import { Button, Input, Select, Switch, TagInput } from '@douyinfe/semi-ui-19';
import {
  IconBell,
  IconBriefcase,
  IconFilter,
  IconHome,
  IconPaperclip,
  IconPlayCircle,
  IconPlusCircle,
  IconSetting,
  IconUser,
} from '@douyinfe/semi-icons';
import { SegmentPart } from '../../../components/segment/SegmentPart';
import ProviderTable from '../../../components/table/ProviderTable';
import NotificationChannelTable from '../../../components/table/NotificationChannelTable';
import AreaFilter from './components/areaFilter/AreaFilter';
import CommuteFilter from './components/CommuteFilter.jsx';
import { GUIDED_STEPS } from '../../../services/jobs/guidedSearchForm.js';
import { useTranslation } from '../../../services/i18n/i18n.jsx';
import './GuidedJobForm.less';

const STEP_ICONS = [IconBriefcase, IconHome, IconFilter, IconBell];

export default function GuidedJobForm({
  currentStep,
  onStepSelect,
  onBack,
  onContinue,
  onSave,
  validationError,
  panelRef,
  name,
  setName,
  providerData,
  providerMetadata,
  policyProfileReady,
  onProviderPolicyChange,
  onProviderAdd,
  onProviderRemove,
  onProviderEdit,
  onCompleteInquiryProfile,
  dealType,
  setDealType,
  dealTypeWasInferred,
  specFilters,
  specFilter,
  onSpecFilterChange,
  blacklist,
  setBlacklist,
  spatialFilter,
  onSpatialFilterChange,
  areaExpanded,
  setAreaExpanded,
  commuteFilter,
  setCommuteFilter,
  selectedChannels,
  onAddNotification,
  onManageNotifications,
  onTestChannel,
  onEditChannel,
  onCloneChannel,
  onDetachChannel,
  shareableUserList,
  shareWithUsers,
  setShareWithUsers,
  enabled,
  setEnabled,
  reviewSummary,
  canSave,
} = {}) {
  const t = useTranslation();
  const localPanelRef = useRef(null);
  const validationRef = useRef(null);

  useEffect(() => {
    const target = panelRef?.current ?? localPanelRef.current;
    target?.focus();
  }, [currentStep, panelRef]);

  useEffect(() => {
    validationRef.current?.focus();
  }, [validationError]);

  const stepLabels = [
    t('jobs.mutation.guidedStepProviders'),
    t('jobs.mutation.guidedStepHomeCriteria'),
    t('jobs.mutation.guidedStepRealWorldFit'),
    t('jobs.mutation.guidedStepDeliveryReview'),
  ];

  const stepHelp = [
    t('jobs.mutation.guidedStepProvidersHelp'),
    t('jobs.mutation.guidedStepHomeCriteriaHelp'),
    t('jobs.mutation.guidedStepRealWorldFitHelp'),
    t('jobs.mutation.guidedStepDeliveryReviewHelp'),
  ];

  const panel = panelRef ?? localPanelRef;
  const renderStepNavigation = () => (
    <>
      <ol className="guidedJobForm__steps" role="tablist" aria-label={t('jobs.mutation.guidedStepsLabel')}>
        {GUIDED_STEPS.map((step, index) => {
          const StepIcon = STEP_ICONS[index];
          const active = currentStep === index;
          return (
            <li key={step.id}>
              <button
                type="button"
                role="tab"
                id={`guided-step-${index}`}
                aria-controls={`guided-panel-${index}`}
                aria-selected={active}
                aria-current={active ? 'step' : undefined}
                className={`guidedJobForm__step${active ? ' guidedJobForm__step--active' : ''}`}
                onClick={() => onStepSelect(index)}
              >
                <span className="guidedJobForm__stepNumber">{index + 1}</span>
                <span>
                  <strong>{stepLabels[index]}</strong>
                  <small>{stepHelp[index]}</small>
                </span>
                <StepIcon aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ol>
      <div className="guidedJobForm__mobileProgress" role="status" aria-live="polite">
        {t('jobs.mutation.guidedStepOf', { current: currentStep + 1 })} · {stepLabels[currentStep]}
      </div>
    </>
  );

  const renderProviders = () => (
    <div className="guidedJobForm__sectionStack">
      <SegmentPart name={t('jobs.mutation.sectionName')} Icon={IconPaperclip}>
        <Input
          autoFocus
          type="text"
          maxLength={40}
          placeholder={t('jobs.mutation.namePlaceholder')}
          value={name ?? ''}
          onChange={setName}
        />
      </SegmentPart>
      <SegmentPart
        name={t('jobs.mutation.sectionProviders')}
        Icon={IconBriefcase}
        helpText={t('jobs.mutation.providersHelp')}
        helpMode="popover"
      >
        <Button type="primary" icon={<IconPlusCircle />} onClick={onProviderAdd}>
          {t('jobs.mutation.addProvider')}
        </Button>
        <ProviderTable
          providerData={providerData}
          providerMetadata={providerMetadata}
          policyProfileReady={policyProfileReady}
          onPolicyChange={onProviderPolicyChange}
          onRemove={onProviderRemove}
          onEdit={onProviderEdit}
          onCompleteProfile={onCompleteInquiryProfile}
        />
      </SegmentPart>
      <p className="guidedJobForm__stepHint">{t('jobs.mutation.guidedProvidersHint')}</p>
    </div>
  );

  const renderHomeCriteria = () => (
    <div className="guidedJobForm__sectionStack">
      <SegmentPart
        name={t('jobs.mutation.sectionDealType')}
        Icon={IconHome}
        helpText={t('jobs.mutation.dealTypeHelp')}
        helpMode="popover"
      >
        <Select
          placeholder={t('jobs.mutation.dealTypePlaceholder')}
          value={dealType}
          onChange={setDealType}
          style={{ width: '100%', maxWidth: 260 }}
        >
          <Select.Option value="rent">{t('jobs.mutation.dealTypeRent')}</Select.Option>
          <Select.Option value="buy">{t('jobs.mutation.dealTypeBuy')}</Select.Option>
        </Select>
        {dealTypeWasInferred && <p className="guidedJobForm__mutedHint">{t('jobs.mutation.dealTypeInferred')}</p>}
      </SegmentPart>
      <SegmentPart
        Icon={IconFilter}
        name={t('jobs.mutation.sectionCriteriaFilter')}
        helpText={t('jobs.mutation.criteriaFilterHelp')}
        helpMode="popover"
      >
        <div className="jobMutation__specFilter">
          {specFilters.map((filter) => (
            <div key={filter.key} className="jobMutation__specFilterItem">
              <div className="jobMutation__specFilterLabel">{filter.translation}</div>
              <Input
                type="number"
                placeholder={t('jobs.mutation.criteriaNumberPlaceholder')}
                value={specFilter?.[filter.key]}
                onChange={(value) => onSpecFilterChange(filter.key, value)}
              />
            </div>
          ))}
        </div>
      </SegmentPart>
      <SegmentPart
        Icon={IconFilter}
        name={t('jobs.mutation.sectionBlacklist')}
        helpText={t('jobs.mutation.blacklistHelp')}
        helpMode="popover"
      >
        <TagInput
          value={blacklist || []}
          placeholder={t('jobs.mutation.blacklistPlaceholder')}
          onChange={setBlacklist}
        />
      </SegmentPart>
      <SegmentPart
        Icon={IconFilter}
        name={t('jobs.mutation.sectionAreaFilter')}
        helpText={t('jobs.mutation.areaFilterHelp')}
        helpMode="popover"
      >
        <ol className="jobMutation__areaSteps">
          <li>{t('jobs.mutation.areaStep1')}</li>
          <li>{t('jobs.mutation.areaStep2')}</li>
          <li>{t('jobs.mutation.areaStep3')}</li>
        </ol>
        <div className={`jobMutation__areaMap${areaExpanded ? ' jobMutation__areaMap--expanded' : ''}`}>
          <AreaFilter spatialFilter={spatialFilter} onChange={onSpatialFilterChange} providerData={providerData} />
        </div>
        <Button theme="borderless" size="small" onClick={() => setAreaExpanded((current) => !current)}>
          {areaExpanded ? t('jobs.mutation.areaCollapse') : t('jobs.mutation.areaExpand')}
        </Button>
      </SegmentPart>
    </div>
  );

  const renderRealWorldFit = () => (
    <div className="guidedJobForm__sectionStack">
      <p className="guidedJobForm__stepHint">{t('jobs.mutation.guidedFitHint')}</p>
      <SegmentPart
        Icon={IconFilter}
        name={t('jobs.mutation.sectionCommuteFilter')}
        helpText={t('jobs.mutation.commuteFilterHelp')}
        helpMode="popover"
      >
        <CommuteFilter value={commuteFilter} onChange={setCommuteFilter} />
      </SegmentPart>
    </div>
  );

  const renderDeliveryReview = () => (
    <div className="guidedJobForm__sectionStack">
      <SegmentPart
        Icon={IconBell}
        name={t('jobs.mutation.sectionNotifications')}
        helpText={t('jobs.mutation.notificationsHelp')}
        helpMode="popover"
      >
        <div className="jobMutation__notificationActions">
          <Button type="primary" icon={<IconPlusCircle />} onClick={onAddNotification}>
            {t('jobs.mutation.addNotification')}
          </Button>
          <Button type="secondary" icon={<IconSetting />} onClick={onManageNotifications}>
            {t('notification.channels.manage')}
          </Button>
        </div>
        <NotificationChannelTable
          channels={selectedChannels}
          actions={['test', 'edit', 'clone', 'detach']}
          showVisibility={false}
          showUsage={false}
          emptyText={t('notification.channels.emptyInJob')}
          onTest={onTestChannel}
          onEdit={onEditChannel}
          onClone={onCloneChannel}
          onDetach={onDetachChannel}
        />
      </SegmentPart>
      <SegmentPart
        Icon={IconUser}
        name={t('jobs.mutation.sectionSharing')}
        helpText={t('jobs.mutation.sharingHelp')}
        helpMode="popover"
      >
        {shareableUserList.length === 0 ? (
          <div>{t('jobs.mutation.sharingNoUsers')}</div>
        ) : (
          <Select
            filter
            multiple
            placeholder={t('jobs.mutation.sharingSearchPlaceholder')}
            autoClearSearchValue={false}
            value={shareWithUsers}
            onChange={setShareWithUsers}
            style={{ width: '100%' }}
          >
            {shareableUserList.map((user) => (
              <Select.Option value={user.id} key={user.id}>
                {user.name}
              </Select.Option>
            ))}
          </Select>
        )}
      </SegmentPart>
      <SegmentPart
        Icon={IconPlayCircle}
        name={t('jobs.mutation.sectionActivation')}
        helpText={t('jobs.mutation.activationHelp')}
        helpMode="popover"
      >
        <Switch onChange={setEnabled} checked={enabled} aria-label={t('jobs.mutation.activationHelp')} />
      </SegmentPart>
      <section className="guidedJobForm__review" aria-labelledby="guided-review-heading">
        <h3 id="guided-review-heading">{t('jobs.mutation.guidedReviewTitle')}</h3>
        <ul>
          {reviewSummary.map((item, index) => (
            <li key={`${item}-${index}`}>{item}</li>
          ))}
          <li>{t('jobs.mutation.guidedReviewPolicies', { count: providerData.length })}</li>
        </ul>
      </section>
    </div>
  );

  const renderCurrentStep = [renderProviders, renderHomeCriteria, renderRealWorldFit, renderDeliveryReview][
    currentStep
  ];

  return (
    <form className="jobMutation__form" onSubmit={(event) => event.preventDefault()}>
      {renderStepNavigation()}
      {validationError && (
        <div className="guidedJobForm__validation" role="alert" tabIndex="-1" ref={validationRef}>
          {validationError}
        </div>
      )}
      <section
        className="guidedJobForm__panel"
        id={`guided-panel-${currentStep}`}
        role="tabpanel"
        aria-labelledby={`guided-step-${currentStep}`}
        tabIndex="-1"
        ref={panel}
      >
        {renderCurrentStep()}
      </section>
      <div className="guidedJobForm__footer">
        <Button type="tertiary" onClick={onBack} disabled={currentStep === 0}>
          {t('jobs.mutation.guidedBack')}
        </Button>
        <div className="guidedJobForm__footerRight">
          {currentStep < GUIDED_STEPS.length - 1 ? (
            <Button type="primary" onClick={onContinue}>
              {t('jobs.mutation.guidedContinue')}
            </Button>
          ) : (
            <Button type="primary" icon={<IconPlusCircle />} disabled={!canSave} onClick={onSave}>
              {t('jobs.mutation.save')}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
