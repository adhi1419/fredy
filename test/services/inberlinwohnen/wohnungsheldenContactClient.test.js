/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it, vi } from 'vitest';
import {
  buildWohnungsheldenApplication,
  deriveWohnungsheldenIdentifiers,
  isStadtUndLandListing,
  sendWohnungsheldenInquiry,
} from '../../../lib/services/inberlinwohnen/wohnungsheldenContactClient.js';

const listing = {
  link: 'https://stadtundland.de/wohnungssuche/1001%2F7318%2F00031',
  description: 'Kaltmiete: 700 €\nGesamtmiete: 1.000 €',
};
const applicationUrl =
  'https://app.wohnungshelden.de/public/listings/1001%2F7318%2F00031/application?c=a2cd1bb4-85f1-4cee-b259-1d7606552194';
const detailHtml = `<a href="${applicationUrl}">Formular in neuem Tab öffnen</a>`;
const profile = {
  name: 'Alice Example',
  email: 'profile-email-must-not-be-used@example.net',
  salutation: 'Frau',
  phoneNumber: '+49 30 123456',
  street: 'Example Street',
  houseNumber: '7',
  postcode: '10178',
  city: 'Berlin',
  numberOfPersons: 2,
  numberOfChildren: 0,
  moveInDate: '01.11.2026',
  netIncome: '3500 €',
  howFoundUs: 'Inberlinwohnen.de',
  wbsAvailable: false,
};
const dynamicFormContent = JSON.stringify([
  {
    key: 'stadt_und_land_anzahl_einziehende_personen',
    templateOptions: { required: true },
  },
  {
    key: 'stadt_und_land_anzahl_kinder',
    templateOptions: { required: true },
  },
  {
    key: 'stadt_und_land_monatliche_warmmiete_hoechstens_35%_monatliches_netto_haushaltseinkommen',
    templateOptions: { required: true },
  },
  {
    key: 'stadt_und_land_ab_wann_kann_wohnung_angemietet_werden',
    templateOptions: { required: true },
  },
  {
    key: 'stadt_und_land_wie_aufmerksam_geworden',
    templateOptions: { required: true },
  },
  {
    key: 'stadt_und_land_bestaetigung_datenschutzhinweis',
    validators: { validation: ['requiredTrue'] },
  },
  {
    key: 'stadt_und_land_gueltigkeit_wbs',
    hideExpression: 'model.$$_wbs_available_$$ !== true',
    templateOptions: { required: true },
  },
  {
    key: '$$_wbs_max_number_rooms_$$',
    hideExpression: 'model.$$_wbs_available_$$ !== true',
    templateOptions: { required: true },
  },
]);
const formConfig = {
  keyOrder: [
    'stadt_und_land_anzahl_einziehende_personen',
    'stadt_und_land_anzahl_kinder',
    'stadt_und_land_monatliche_warmmiete_hoechstens_35%_monatliches_netto_haushaltseinkommen',
    'stadt_und_land_ab_wann_kann_wohnung_angemietet_werden',
    'stadt_und_land_wie_aufmerksam_geworden',
    '$$_wbs_available_$$',
    'stadt_und_land_gueltigkeit_wbs',
    '$$_wbs_max_number_rooms_$$',
    'stadt_und_land_bestaetigung_datenschutzhinweis',
  ],
  formContent: dynamicFormContent,
  publicApplicationCreationConfig: {
    fieldConfigs: [
      { fieldType: 'SALUTATION', required: true },
      { fieldType: 'NAME', required: true },
      { fieldType: 'PHONE_NUMBER', required: false },
      { fieldType: 'ADDRESS', required: false },
      { fieldType: 'APPLICANT_MESSAGE', required: false },
    ],
  },
  useRecaptcha: false,
  formFileConfigs: [],
};
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status });
const htmlResponse = (body, status = 200) => new Response(body, { status });

function successfulFetch(postResponse = new Response('', { status: 201 })) {
  return vi
    .fn()
    .mockResolvedValueOnce(htmlResponse(detailHtml))
    .mockResolvedValueOnce(jsonResponse(formConfig))
    .mockResolvedValueOnce(postResponse);
}

describe('Wohnungshelden identifiers and payload', () => {
  it('accepts only Stadt und Land listing URLs and derives identifiers from page evidence', () => {
    expect(isStadtUndLandListing(listing)).toBe(true);
    expect(isStadtUndLandListing({ link: 'https://www.gewobag.de/wohnungssuche/1001' })).toBe(false);

    expect(deriveWohnungsheldenIdentifiers(detailHtml, listing.link)).toEqual({
      applicationUrl,
      companyId: 'a2cd1bb4-85f1-4cee-b259-1d7606552194',
      objectNumber: '1001/7318/00031',
    });
  });

  it('builds the observed JSON contract with authenticated email and dynamic form data', () => {
    const { body, missingFields } = buildWohnungsheldenApplication(
      profile,
      'applicant@example.com',
      'Guten Tag',
      formConfig,
      listing,
    );

    expect(missingFields).toEqual([]);
    expect(body).toMatchObject({
      publicApplicationCreationTO: {
        email: 'applicant@example.com',
        firstName: 'Alice',
        lastName: 'Example',
        applicantMessage: 'Guten Tag',
      },
      saveFormDataTO: {
        files: [],
        formData: {
          stadt_und_land_anzahl_einziehende_personen: 2,
          stadt_und_land_anzahl_kinder: 0,
          'stadt_und_land_monatliche_warmmiete_hoechstens_35%_monatliches_netto_haushaltseinkommen': true,
          stadt_und_land_ab_wann_kann_wohnung_angemietet_werden: '01.11.2026',
          stadt_und_land_wie_aufmerksam_geworden: 'Inberlinwohnen.de',
          $$_wbs_available_$$: false,
          stadt_und_land_bestaetigung_datenschutzhinweis: true,
        },
      },
      isApplicationSourceCrm: false,
    });
    expect(body.publicApplicationCreationTO.email).not.toBe(profile.email);
    expect(body.recaptchaToken).toBeUndefined();
  });

  it('reports all missing dynamic required fields without inventing values', () => {
    const { body, missingFields } = buildWohnungsheldenApplication(
      { ...profile, numberOfPersons: undefined, numberOfChildren: undefined },
      'applicant@example.com',
      '',
      formConfig,
      listing,
    );

    expect(body).toBeNull();
    expect(missingFields).toEqual(
      expect.arrayContaining(['stadt_und_land_anzahl_einziehende_personen', 'stadt_und_land_anzahl_kinder']),
    );
    expect(missingFields).not.toContain('stadt_und_land_gueltigkeit_wbs');
    expect(missingFields).not.toContain('$$_wbs_max_number_rooms_$$');
  });
});

describe('sendWohnungsheldenInquiry', () => {
  it('sends exactly one POST and confirms a successful 2xx response', async () => {
    const fetchImpl = successfulFetch();

    await expect(
      sendWohnungsheldenInquiry({
        listing,
        profile,
        accountEmail: 'applicant@example.com',
        message: 'Guten Tag',
        fetchImpl,
      }),
    ).resolves.toMatchObject({ requestId: 'stadtundland:1001/7318/00031' });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[1][0]).toBe(
      'https://app.wohnungshelden.de/api/public/application-form/a2cd1bb4-85f1-4cee-b259-1d7606552194/1001%2F7318%2F00031',
    );
    const [url, options] = fetchImpl.mock.calls[2];
    expect(url).toBe(
      'https://app.wohnungshelden.de/api/applicationFormEndpoint/3.0/form/create-application/a2cd1bb4-85f1-4cee-b259-1d7606552194/1001%2F7318%2F00031',
    );
    expect(options).toMatchObject({ method: 'POST', redirect: 'manual' });
    expect(JSON.parse(options.body).publicApplicationCreationTO.email).toBe('applicant@example.com');
  });

  it('fails closed when recaptcha is required or a document upload is mandatory', async () => {
    for (const config of [
      { ...formConfig, useRecaptcha: true },
      { ...formConfig, formFileConfigs: [{ type: 'income-proof', mandatory: true }] },
    ]) {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(htmlResponse(detailHtml))
        .mockResolvedValueOnce(jsonResponse(config));

      await expect(
        sendWohnungsheldenInquiry({ listing, profile, accountEmail: 'applicant@example.com', fetchImpl }),
      ).rejects.toMatchObject({ outcome: 'failed', permanent: true });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(fetchImpl.mock.calls[1][0]).toContain('/api/public/application-form/');
    }
  });

  it('classifies a provider rejection as failed and redacts provider data', async () => {
    const fetchImpl = successfulFetch(
      jsonResponse({ message: 'Invalid email applicant@example.com; phone +49 30 123456' }, 422),
    );

    await expect(
      sendWohnungsheldenInquiry({ listing, profile, accountEmail: 'applicant@example.com', fetchImpl }),
    ).rejects.toSatisfy((error) => {
      expect(error).toMatchObject({
        outcome: 'failed',
        status: 422,
        providerError: expect.stringContaining('[redacted-email]'),
      });
      expect(error.message).not.toContain('applicant@example.com');
      expect(error.message).not.toContain('+49 30 123456');
      return true;
    });
  });

  it.each([
    [503, 'unknown'],
    [302, 'unknown'],
  ])('classifies a post-send HTTP %s response as %s', async (status, outcome) => {
    const fetchImpl = successfulFetch(new Response('', { status }));

    await expect(
      sendWohnungsheldenInquiry({ listing, profile, accountEmail: 'applicant@example.com', fetchImpl }),
    ).rejects.toMatchObject({ outcome, status });
  });

  it('classifies a POST timeout as unknown and never retries', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse(detailHtml))
      .mockResolvedValueOnce(jsonResponse(formConfig))
      .mockImplementationOnce(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      );

    await expect(
      sendWohnungsheldenInquiry({ listing, profile, accountEmail: 'applicant@example.com', fetchImpl, timeoutMs: 5 }),
    ).rejects.toMatchObject({ outcome: 'unknown' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
