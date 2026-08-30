/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useEffect, useState } from 'react';
import { Button, Input, TextArea, Toast } from '@douyinfe/semi-ui-19';
import { IconSave } from '@douyinfe/semi-icons';

import { SegmentPart } from '../../../components/segment/SegmentPart';
import { errorMessage } from '../../../services/xhr';
import { useActions, useSelector, useIsLoading } from '../../../services/state/store';
import { useTranslation } from '../../../services/i18n/i18n.jsx';

/**
 * Applicant profile used when drafting inquiry messages via the Gemini-powered message generator.
 *
 * Fields are all optional so the generator falls back to a generic message when nothing is filled
 * in. The page mirrors the structure of PreferencesPage: read from the store, hold local draft
 * state, persist on save.
 *
 * @returns {React.ReactElement}
 */
export default function InquiryProfilePage() {
  const t = useTranslation();
  const actions = useActions();
  const stored = useSelector((state) => state.userSettings.settings?.inquiry_profile);
  const saving = useIsLoading(actions.userSettings.saveInquiryProfile);

  const [draft, setDraft] = useState({
    name: '',
    employmentType: '',
    jobTitle: '',
    employer: '',
    netIncome: '',
    moveInDate: '',
    extraFacts: '',
  });

  useEffect(() => {
    if (stored) {
      setDraft({
        name: stored.name ?? '',
        employmentType: stored.employmentType ?? '',
        jobTitle: stored.jobTitle ?? '',
        employer: stored.employer ?? '',
        netIncome: stored.netIncome ?? '',
        moveInDate: stored.moveInDate ?? '',
        extraFacts: stored.extraFacts ?? '',
      });
    }
  }, [stored]);

  const field = (key, value) => setDraft((prev) => ({ ...prev, [key]: value }));

  const dirty =
    (draft.name ?? '') !== (stored?.name ?? '') ||
    (draft.employmentType ?? '') !== (stored?.employmentType ?? '') ||
    (draft.jobTitle ?? '') !== (stored?.jobTitle ?? '') ||
    (draft.employer ?? '') !== (stored?.employer ?? '') ||
    (draft.netIncome ?? '') !== (stored?.netIncome ?? '') ||
    (draft.moveInDate ?? '') !== (stored?.moveInDate ?? '') ||
    (draft.extraFacts ?? '') !== (stored?.extraFacts ?? '');

  const handleSave = async () => {
    try {
      await actions.userSettings.saveInquiryProfile(draft);
      Toast.success(t('settings.toastSaved'));
    } catch (error) {
      Toast.error(errorMessage(error, t('settings.toastSaveError')));
    }
  };

  return (
    <div className="settingsShell__page">
      <SegmentPart name={t('settings.inquiryProfile.title')} helpText={t('settings.inquiryProfile.help')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label>
            {t('settings.inquiryProfile.name')}
            <Input
              value={draft.name}
              onChange={(val) => field('name', val)}
              placeholder={t('settings.inquiryProfile.namePlaceholder')}
            />
          </label>
          <label>
            {t('settings.inquiryProfile.employmentType')}
            <Input
              value={draft.employmentType}
              onChange={(val) => field('employmentType', val)}
              placeholder={t('settings.inquiryProfile.employmentTypePlaceholder')}
            />
          </label>
          <label>
            {t('settings.inquiryProfile.jobTitle')}
            <Input
              value={draft.jobTitle}
              onChange={(val) => field('jobTitle', val)}
              placeholder={t('settings.inquiryProfile.jobTitlePlaceholder')}
            />
          </label>
          <label>
            {t('settings.inquiryProfile.employer')}
            <Input
              value={draft.employer}
              onChange={(val) => field('employer', val)}
              placeholder={t('settings.inquiryProfile.employerPlaceholder')}
            />
          </label>
          <label>
            {t('settings.inquiryProfile.netIncome')}
            <Input
              value={draft.netIncome}
              onChange={(val) => field('netIncome', val)}
              placeholder={t('settings.inquiryProfile.netIncomePlaceholder')}
            />
          </label>
          <label>
            {t('settings.inquiryProfile.moveInDate')}
            <Input
              value={draft.moveInDate}
              onChange={(val) => field('moveInDate', val)}
              placeholder={t('settings.inquiryProfile.moveInDatePlaceholder')}
            />
          </label>
          <label>
            {t('settings.inquiryProfile.extraFacts')}
            <TextArea
              value={draft.extraFacts}
              onChange={(val) => field('extraFacts', val)}
              placeholder={t('settings.inquiryProfile.extraFactsPlaceholder')}
              autosize={{ minRows: 3, maxRows: 8 }}
            />
          </label>
        </div>
      </SegmentPart>

      <div className="settingsShell__saveRow">
        <Button
          icon={<IconSave />}
          theme="solid"
          type="primary"
          onClick={handleSave}
          disabled={!dirty}
          loading={saving}
        >
          {t('settings.save')}
        </Button>
      </div>
    </div>
  );
}

InquiryProfilePage.displayName = 'InquiryProfilePage';
