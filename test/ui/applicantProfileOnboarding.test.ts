/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APPLICANT_PROFILE_ONBOARDING_PATH,
  getInvalidCommonApplicantProfileFields,
  isCommonApplicantProfileComplete,
  resolveApplicantProfileOnboarding,
} from '../../ui/src/services/onboarding/applicantProfileOnboarding.js';

const completeProfile = {
  name: 'Alice Example',
  street: 'Main Street',
  houseNumber: '1',
  postcode: '10115',
  city: 'Berlin',
  employer: 'Example GmbH',
  deutscheWohnenPrivacyAccepted: true,
};

const onboardingSource = fs.readFileSync(
  path.resolve('ui/src/views/onboarding/ApplicantProfileOnboardingPage.tsx'),
  'utf8',
);

describe('applicant profile onboarding decision seam', () => {
  it('keeps the route in loading while settings are unresolved', () => {
    expect(resolveApplicantProfileOnboarding({ settingsLoaded: false, profile: completeProfile })).toEqual({
      status: 'loading',
      requiresSetup: false,
      shouldRedirect: false,
      path: APPLICANT_PROFILE_ONBOARDING_PATH,
    });
  });

  it('does not mistake a settings load failure for an incomplete applicant profile', () => {
    expect(resolveApplicantProfileOnboarding({ settingsLoaded: true, settingsLoadFailed: true, profile: {} })).toEqual({
      status: 'load-failed',
      requiresSetup: false,
      shouldRedirect: false,
      path: APPLICANT_PROFILE_ONBOARDING_PATH,
    });
  });

  it('requires setup and redirects only from a normal authenticated route', () => {
    expect(
      resolveApplicantProfileOnboarding({ settingsLoaded: true, profile: {}, pathname: '/dashboard' }),
    ).toMatchObject({ status: 'incomplete', requiresSetup: true, shouldRedirect: true });
    expect(
      resolveApplicantProfileOnboarding({
        settingsLoaded: true,
        profile: {},
        pathname: APPLICANT_PROFILE_ONBOARDING_PATH,
      }),
    ).toMatchObject({ status: 'incomplete', requiresSetup: true, shouldRedirect: false });
  });

  it('treats complete common facts as complete without looping on the onboarding URL', () => {
    expect(
      resolveApplicantProfileOnboarding({
        settingsLoaded: true,
        profile: completeProfile,
        pathname: APPLICANT_PROFILE_ONBOARDING_PATH,
      }),
    ).toMatchObject({ status: 'complete', requiresSetup: false, shouldRedirect: false });
  });

  it('keeps a failed save on onboarding and does not redirect it away', () => {
    expect(
      resolveApplicantProfileOnboarding({
        settingsLoaded: true,
        profile: {},
        pathname: APPLICANT_PROFILE_ONBOARDING_PATH,
        saveError: new Error('rejected'),
      }),
    ).toMatchObject({ status: 'save-failed', requiresSetup: true, shouldRedirect: false });
  });

  it('does not require provider-specific facts or consent for common completion', () => {
    expect(isCommonApplicantProfileComplete(completeProfile)).toBe(true);
    expect(
      isCommonApplicantProfileComplete({ ...completeProfile, employer: '', deutscheWohnenPrivacyAccepted: false }),
    ).toBe(true);
  });
});

describe('authenticated app route contract', () => {
  const appSource = fs.readFileSync(path.resolve('ui/src/App.tsx'), 'utf8');

  it('leaves login outside the authenticated onboarding gate', () => {
    expect(appSource).toContain('<Route path="/login" element={<Login />} />');
    expect(appSource).toContain('needsLogin() ? (');
  });

  it('keeps onboarding out of primary navigation and redirects normal routes with return state', () => {
    expect(appSource).toContain('path={APPLICANT_PROFILE_ONBOARDING_PATH}');
    expect(appSource).toContain('onboardingDecision.requiresSetup');
    expect(appSource).toContain('state={{ from: location }}');
    expect(appSource).toContain('primaryVisible={!onboardingDecision.requiresSetup}');
  });
});

describe('onboarding accessibility contracts', () => {
  it('reports common invalid fields in visual form order and requires two name words', () => {
    expect(getInvalidCommonApplicantProfileFields({})).toEqual(['name', 'street', 'houseNumber', 'postcode', 'city']);
    expect(getInvalidCommonApplicantProfileFields({ name: 'Alice' })).toEqual([
      'name',
      'street',
      'houseNumber',
      'postcode',
      'city',
    ]);
    expect(
      getInvalidCommonApplicantProfileFields({
        name: 'Alice Example',
        street: 'Main Street',
        houseNumber: '1',
        postcode: '10115',
        city: 'Berlin',
        employer: '',
        deutscheWohnenPrivacyAccepted: false,
      }),
    ).toEqual([]);
  });

  it('keeps field errors independently addressable and focuses the first model-invalid input', () => {
    expect(onboardingSource).toContain('id="onboarding-validation-alert"');
    expect(onboardingSource).toContain("'aria-invalid': invalidFields.includes(field) ? 'true' : undefined");
    expect(onboardingSource).toContain(
      "'aria-describedby': showValidation ? 'onboarding-validation-alert' : undefined",
    );
    expect(onboardingSource).toContain('setShowValidation((visible) => visible &&');
    expect(onboardingSource).toContain('focusField(invalidDraftFields[0])');
    expect(onboardingSource).not.toContain('role="alert"');
  });
});
