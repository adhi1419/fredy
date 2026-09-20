/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Banner, Button, Input, Spin } from '@douyinfe/semi-ui-19';
import { useLocation, useNavigate } from 'react-router';

import { SegmentPart } from '../../components/segment/SegmentPart';
import { errorMessage } from '../../services/xhr';
import { useActions, useIsLoading, useSelector } from '../../services/state/store';
import {
  APPLICANT_PROFILE_ONBOARDING_PATH,
  REQUIRED_COMMON_PROFILE_FIELDS,
  getInvalidCommonApplicantProfileFields,
  resolveApplicantProfileOnboarding,
} from '../../services/onboarding/applicantProfileOnboarding.js';
import { useTranslation } from '../../services/i18n/i18n.jsx';

import './ApplicantProfileOnboardingPage.less';

const EMPTY_PROFILE = Object.freeze({});

function commonDraft(profile) {
  return Object.fromEntries(REQUIRED_COMMON_PROFILE_FIELDS.map((field) => [field, profile?.[field] ?? '']));
}

function returnPath(location) {
  const from = location.state?.from;
  if (!from?.pathname || from.pathname === APPLICANT_PROFILE_ONBOARDING_PATH || from.pathname === '/login') {
    return '/dashboard';
  }
  return `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`;
}

/**
 * Collect the common applicant facts required before product routes become available.
 * Provider-specific details and consents stay in My account and are never inferred here.
 *
 * @returns {React.ReactElement}
 */
export default function ApplicantProfileOnboardingPage() {
  const t = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const actions = useActions();
  const settingsState = useSelector((state) => state.userSettings);
  const storedProfile = settingsState.settings?.inquiry_profile ?? EMPTY_PROFILE;
  const saving = useIsLoading(actions.userSettings.saveInquiryProfile);
  const [draft, setDraft] = useState(() => commonDraft(storedProfile));
  const [saveError, setSaveError] = useState(null);
  const [showValidation, setShowValidation] = useState(false);
  const fieldRefs = useRef({});

  const decision = resolveApplicantProfileOnboarding({
    settingsLoaded: settingsState.loaded,
    settingsLoadFailed: settingsState.loadFailed,
    profile: storedProfile,
    pathname: location.pathname,
    saveError,
  });
  const invalidFields = useMemo(
    () => (showValidation ? getInvalidCommonApplicantProfileFields(draft) : []),
    [draft, showValidation],
  );

  useEffect(() => {
    if (settingsState.loaded) setDraft(commonDraft(storedProfile));
  }, [settingsState.loaded, storedProfile]);

  useEffect(() => {
    if (decision.status === 'complete') {
      navigate(returnPath(location), { replace: true });
    }
  }, [decision.status, location, navigate]);

  const setField = (field, value) => {
    const nextDraft = { ...draft, [field]: value };
    setDraft(nextDraft);
    setSaveError(null);
    setShowValidation((visible) => visible && getInvalidCommonApplicantProfileFields(nextDraft).length > 0);
  };

  const inputProps = (field) => ({
    ref: (element) => {
      fieldRefs.current[field] = element;
    },
    value: draft[field],
    onChange: (value) => setField(field, value),
    'aria-invalid': invalidFields.includes(field) ? 'true' : undefined,
    'aria-describedby': showValidation ? 'onboarding-validation-alert' : undefined,
  });

  const focusField = (field) => {
    const element = fieldRefs.current[field];
    if (typeof element?.focus === 'function') {
      element.focus();
    } else {
      element?.querySelector?.('input')?.focus();
    }
  };

  const handleSave = async (event) => {
    event.preventDefault();
    const invalidDraftFields = getInvalidCommonApplicantProfileFields(draft);
    if (invalidDraftFields.length > 0) {
      setShowValidation(true);
      focusField(invalidDraftFields[0]);
      return;
    }

    const profile = { ...storedProfile, ...draft };
    setSaveError(null);
    try {
      await actions.userSettings.saveInquiryProfile(profile, { validateCommon: true });
      navigate(returnPath(location), { replace: true });
    } catch (error) {
      setSaveError(error);
    }
  };

  if (decision.status === 'loading') {
    return (
      <div className="applicant-profile-onboarding applicant-profile-onboarding--loading" role="status">
        <Spin size="large" />
        <span>{t('onboarding.applicantProfile.loading')}</span>
      </div>
    );
  }

  return (
    <div className="applicant-profile-onboarding">
      <div className="applicant-profile-onboarding__heading">
        <div className="applicant-profile-onboarding__kicker">{t('onboarding.applicantProfile.kicker')}</div>
        <h1>{t('onboarding.applicantProfile.title')}</h1>
        <p>{t('onboarding.applicantProfile.subtitle')}</p>
      </div>

      {saveError && (
        <Banner type="danger" description={errorMessage(saveError, t('onboarding.applicantProfile.saveError'))} />
      )}
      {showValidation && (
        <Banner
          id="onboarding-validation-alert"
          type="warning"
          description={t('onboarding.applicantProfile.validation')}
        />
      )}

      <form onSubmit={handleSave} noValidate>
        <SegmentPart
          name={t('onboarding.applicantProfile.identityTitle')}
          helpText={t('onboarding.applicantProfile.identityHelp')}
        >
          <div className="applicant-profile-onboarding__grid">
            <label className="applicant-profile-onboarding__field applicant-profile-onboarding__field--wide">
              <span>{t('settings.inquiryProfile.name')}</span>
              <Input
                {...inputProps('name')}
                placeholder={t('settings.inquiryProfile.namePlaceholder')}
                autoComplete="name"
              />
            </label>
            <label className="applicant-profile-onboarding__field applicant-profile-onboarding__field--wide">
              <span>{t('settings.inquiryProfile.street')}</span>
              <Input
                {...inputProps('street')}
                placeholder={t('onboarding.applicantProfile.streetPlaceholder')}
                autoComplete="street-address"
              />
            </label>
            <label className="applicant-profile-onboarding__field">
              <span>{t('settings.inquiryProfile.houseNumber')}</span>
              <Input
                {...inputProps('houseNumber')}
                placeholder={t('onboarding.applicantProfile.houseNumberPlaceholder')}
                autoComplete="address-line2"
              />
            </label>
            <label className="applicant-profile-onboarding__field">
              <span>{t('settings.inquiryProfile.postcode')}</span>
              <Input
                {...inputProps('postcode')}
                placeholder={t('onboarding.applicantProfile.postcodePlaceholder')}
                autoComplete="postal-code"
              />
            </label>
            <label className="applicant-profile-onboarding__field applicant-profile-onboarding__field--wide">
              <span>{t('settings.inquiryProfile.city')}</span>
              <Input
                {...inputProps('city')}
                placeholder={t('onboarding.applicantProfile.cityPlaceholder')}
                autoComplete="address-level2"
              />
            </label>
          </div>
        </SegmentPart>

        <div className="applicant-profile-onboarding__provider-note">
          <strong>{t('onboarding.applicantProfile.providerNoteTitle')}</strong>
          <p>{t('onboarding.applicantProfile.providerNoteBody')}</p>
        </div>

        <div className="applicant-profile-onboarding__actions">
          <Button theme="solid" type="primary" htmlType="submit" loading={saving} disabled={saving}>
            {t('onboarding.applicantProfile.save')}
          </Button>
        </div>
      </form>
    </div>
  );
}

ApplicantProfileOnboardingPage.displayName = 'ApplicantProfileOnboardingPage';
