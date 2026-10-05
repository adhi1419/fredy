/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Button, Checkbox, Input, Select, TextArea, Toast } from '@douyinfe/semi-ui-19';
import { IconSave } from '@douyinfe/semi-icons';

import { SegmentPart } from '../../../components/segment/SegmentPart';
import { errorMessage } from '../../../services/xhr';
import { useActions, useSelector, useIsLoading } from '../../../services/state/store';
import type { SettingsObject, UserSettingsEffects } from '../../../services/state/userSettingsState.js';
import { useTranslation } from '../../../services/i18n/i18n.jsx';

/** The applicant profile fields this form edits. */
interface InquiryProfileDraft {
  name: string;
  employmentType: string;
  jobTitle: string;
  employer: string;
  netIncome: string;
  moveInDate: string;
  extraFacts: string;
  phoneNumber: string;
  street: string;
  houseNumber: string;
  postcode: string;
  city: string;
  salutation: string;
  numberOfPersons: string;
  numberOfChildren: string;
  wbsAvailable: string;
  wbsValidUntil: string;
  wbsMaxRooms: string;
  wbsIncomeLimit: string;
  wbsSpecialNeed: boolean;
  deutscheWohnenIncomeType: string;
  deutscheWohnenMonthlyNetIncome: string;
}

/** The store slice this page reads. */
interface InquiryProfileState {
  userSettings: { settings?: { inquiry_profile?: SettingsObject } };
}

/** The effects this page dispatches. */
interface InquiryProfileActions {
  userSettings: UserSettingsEffects;
}

const EMPTY_DRAFT: InquiryProfileDraft = {
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
  salutation: '',
  numberOfPersons: '',
  numberOfChildren: '',
  wbsAvailable: '',
  wbsValidUntil: '',
  wbsMaxRooms: '',
  wbsIncomeLimit: '',
  wbsSpecialNeed: false,
  deutscheWohnenIncomeType: '',
  deutscheWohnenMonthlyNetIncome: '',
};

/** Read one field from the stored profile as a string, defaulting to empty (mirrors `x ?? ''`). */
function storedString(stored: SettingsObject, key: string): string {
  const value = stored[key];
  if (value == null) return '';
  return typeof value === 'string' ? value : String(value);
}

/**
 * Applicant profile used when drafting inquiry messages via the Gemini-powered message generator.
 *
 * Fields are all optional so the generator falls back to a generic message when nothing is filled
 * in. The page mirrors the structure of PreferencesPage: read from the store, hold local draft
 * state, persist on save.
 */
export default function InquiryProfilePage(): ReactElement {
  const t = useTranslation();
  const actions = useActions<InquiryProfileActions>();
  const stored = useSelector<InquiryProfileState, SettingsObject | undefined>(
    (state) => state.userSettings.settings?.inquiry_profile,
  );
  const saving = useIsLoading(actions.userSettings.saveInquiryProfile);

  const [draft, setDraft] = useState<InquiryProfileDraft>(EMPTY_DRAFT);

  useEffect(() => {
    if (stored) {
      setDraft({
        name: storedString(stored, 'name'),
        employmentType: storedString(stored, 'employmentType'),
        jobTitle: storedString(stored, 'jobTitle'),
        employer: storedString(stored, 'employer'),
        netIncome: storedString(stored, 'netIncome'),
        moveInDate: storedString(stored, 'moveInDate'),
        extraFacts: storedString(stored, 'extraFacts'),
        phoneNumber: storedString(stored, 'phoneNumber'),
        street: storedString(stored, 'street'),
        houseNumber: storedString(stored, 'houseNumber'),
        postcode: storedString(stored, 'postcode'),
        city: storedString(stored, 'city'),
        salutation: storedString(stored, 'salutation'),
        numberOfPersons: storedString(stored, 'numberOfPersons'),
        numberOfChildren: storedString(stored, 'numberOfChildren'),
        wbsAvailable: typeof stored.wbsAvailable === 'boolean' ? String(stored.wbsAvailable) : '',
        wbsValidUntil: storedString(stored, 'wbsValidUntil'),
        wbsMaxRooms: storedString(stored, 'wbsMaxRooms'),
        wbsIncomeLimit: storedString(stored, 'wbsIncomeLimit'),
        wbsSpecialNeed: stored.wbsSpecialNeed === true,
        deutscheWohnenIncomeType: storedString(stored, 'deutscheWohnenIncomeType'),
        deutscheWohnenMonthlyNetIncome: storedString(stored, 'deutscheWohnenMonthlyNetIncome'),
      });
    }
  }, [stored]);

  const field = <K extends keyof InquiryProfileDraft>(key: K, value: InquiryProfileDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const dirty = (Object.entries(draft) as Array<[keyof InquiryProfileDraft, string | boolean]>).some(([key, value]) => {
    const storedValue = stored?.[key];
    if (key === 'wbsAvailable') {
      return value !== (typeof storedValue === 'boolean' ? String(storedValue) : '');
    }
    return value !== (storedValue ?? (typeof value === 'boolean' ? false : ''));
  });

  const handleSave = async () => {
    try {
      const submitted: SettingsObject = { ...draft };
      for (const key of ['wbsAvailable'] as const) {
        const value = draft[key];
        if (value === '') delete submitted[key];
        else submitted[key] = value === 'true';
      }
      await actions.userSettings.saveInquiryProfile(submitted);
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
        </div>
      </SegmentPart>

      <SegmentPart
        name={t('settings.inquiryProfile.householdTitle')}
        helpText={t('settings.inquiryProfile.householdHelp')}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label>
            {t('settings.inquiryProfile.salutation')}
            <Select
              value={draft.salutation}
              onChange={(val) => field('salutation', typeof val === 'string' ? val : '')}
              style={{ width: '100%' }}
              optionList={[
                { value: 'Frau', label: t('settings.inquiryProfile.salutation.frau') },
                { value: 'Herr', label: t('settings.inquiryProfile.salutation.herr') },
                { value: 'Offen', label: t('settings.inquiryProfile.salutation.open') },
              ]}
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <label>
              {t('settings.inquiryProfile.numberOfPersons')}
              <Input
                type="number"
                min={1}
                value={draft.numberOfPersons}
                onChange={(val) => field('numberOfPersons', val)}
              />
            </label>
            <label>
              {t('settings.inquiryProfile.numberOfChildren')}
              <Input
                type="number"
                min={0}
                value={draft.numberOfChildren}
                onChange={(val) => field('numberOfChildren', val)}
              />
            </label>
          </div>
          <label>
            {t('settings.inquiryProfile.wbsAvailable')}
            <Select
              value={draft.wbsAvailable}
              onChange={(val) => field('wbsAvailable', typeof val === 'string' ? val : '')}
              style={{ width: '100%' }}
              optionList={[
                { value: 'true', label: t('common.yes') },
                { value: 'false', label: t('common.no') },
              ]}
            />
          </label>
          {draft.wbsAvailable === 'true' && (
            <>
              <label>
                {t('settings.inquiryProfile.wbsValidUntil')}
                <Input
                  value={draft.wbsValidUntil}
                  onChange={(val) => field('wbsValidUntil', val)}
                  placeholder="TT.MM.JJJJ"
                />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                <label>
                  {t('settings.inquiryProfile.wbsMaxRooms')}
                  <Input
                    type="number"
                    min={1}
                    value={draft.wbsMaxRooms}
                    onChange={(val) => field('wbsMaxRooms', val)}
                  />
                </label>
                <label>
                  {t('settings.inquiryProfile.wbsIncomeLimit')}
                  <Select
                    value={draft.wbsIncomeLimit}
                    onChange={(val) => field('wbsIncomeLimit', typeof val === 'string' ? val : '')}
                    style={{ width: '100%' }}
                    optionList={['100', '140', '160', '180', '220'].map((value) => ({
                      value,
                      label: `WBS ${value}`,
                    }))}
                  />
                </label>
              </div>
              <Checkbox
                checked={draft.wbsSpecialNeed}
                onChange={(event) => field('wbsSpecialNeed', event.target.checked === true)}
              >
                {t('settings.inquiryProfile.wbsSpecialNeed')}
              </Checkbox>
            </>
          )}
        </div>
      </SegmentPart>

      <SegmentPart
        name={t('settings.inquiryProfile.deutscheWohnenTitle')}
        helpText={t('settings.inquiryProfile.deutscheWohnenHelp')}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label>
            {t('settings.inquiryProfile.deutscheWohnenIncomeType')}
            <Select
              value={draft.deutscheWohnenIncomeType}
              onChange={(val) => field('deutscheWohnenIncomeType', typeof val === 'string' ? val : '')}
              style={{ width: '100%' }}
              optionList={[
                { value: '1', label: t('settings.inquiryProfile.deutscheWohnenIncomeType.salary') },
                { value: '2', label: t('settings.inquiryProfile.deutscheWohnenIncomeType.benefits') },
                { value: '3', label: t('settings.inquiryProfile.deutscheWohnenIncomeType.pension') },
                { value: '4', label: t('settings.inquiryProfile.deutscheWohnenIncomeType.citizenBenefit') },
              ]}
            />
          </label>
          <label>
            {t('settings.inquiryProfile.deutscheWohnenMonthlyNetIncome')}
            <Select
              value={draft.deutscheWohnenMonthlyNetIncome}
              onChange={(val) => field('deutscheWohnenMonthlyNetIncome', typeof val === 'string' ? val : '')}
              style={{ width: '100%' }}
              optionList={[
                { value: 'M_1', label: t('settings.inquiryProfile.deutscheWohnenMonthlyNetIncome.low') },
                { value: 'M_2', label: t('settings.inquiryProfile.deutscheWohnenMonthlyNetIncome.medium') },
                { value: 'M_3', label: t('settings.inquiryProfile.deutscheWohnenMonthlyNetIncome.high') },
                { value: 'M_A', label: t('settings.inquiryProfile.deutscheWohnenMonthlyNetIncome.unspecified') },
              ]}
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
