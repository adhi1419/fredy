/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useEffect, useState } from 'react';
import { Button, Checkbox, Input, TextArea, Toast } from '@douyinfe/semi-ui-19';
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
    phoneNumber: '',
    street: '',
    houseNumber: '',
    postcode: '',
    city: '',
    immoscoutPrivacyAccepted: false,
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
        phoneNumber: stored.phoneNumber ?? '',
        street: stored.street ?? '',
        houseNumber: stored.houseNumber ?? '',
        postcode: stored.postcode ?? '',
        city: stored.city ?? '',
        immoscoutPrivacyAccepted: stored.immoscoutPrivacyAccepted === true,
      });
    }
  }, [stored]);

  const field = (key, value) => setDraft((prev) => ({ ...prev, [key]: value }));

  const dirty = Object.entries(draft).some(
    ([key, value]) => value !== (stored?.[key] ?? (typeof value === 'boolean' ? false : '')),
  );

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

      <SegmentPart name={t('settings.inquiryProfile.contactTitle')} helpText={t('settings.inquiryProfile.contactHelp')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label>
            {t('settings.inquiryProfile.phoneNumber')}
            <Input
              type="tel"
              value={draft.phoneNumber}
              onChange={(val) => field('phoneNumber', val)}
              placeholder={t('settings.inquiryProfile.phoneNumberPlaceholder')}
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(7rem, 1fr)', gap: 12 }}>
            <label>
              {t('settings.inquiryProfile.street')}
              <Input value={draft.street} onChange={(val) => field('street', val)} />
            </label>
            <label>
              {t('settings.inquiryProfile.houseNumber')}
              <Input value={draft.houseNumber} onChange={(val) => field('houseNumber', val)} />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(7rem, 1fr) minmax(0, 3fr)', gap: 12 }}>
            <label>
              {t('settings.inquiryProfile.postcode')}
              <Input value={draft.postcode} onChange={(val) => field('postcode', val)} />
            </label>
            <label>
              {t('settings.inquiryProfile.city')}
              <Input value={draft.city} onChange={(val) => field('city', val)} />
            </label>
          </div>
          <Checkbox
            checked={draft.immoscoutPrivacyAccepted}
            onChange={(event) => field('immoscoutPrivacyAccepted', event.target.checked)}
          >
            {t('settings.inquiryProfile.privacyConsent')}
          </Checkbox>
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
