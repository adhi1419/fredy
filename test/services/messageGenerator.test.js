/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Tests for the inquiry-message generator's prompt assembly.
 *
 * The network call is not tested here (that's the endpoint test with a mocked
 * fetch); what matters is that the prompt only ever contains facts the user
 * supplied — the honesty guarantee the user explicitly asked for (no invented
 * smoking status / lifestyle claims).
 */
import { describe, it, expect } from 'vitest';
import { buildPrompt, isMessageGeneratorEnabled } from '../../lib/services/messageGenerator.js';

describe('messageGenerator.buildPrompt', () => {
  const profile = {
    name: 'Adhi R',
    employmentType: 'unbefristete Festanstellung',
    jobTitle: 'Software Development Engineer',
    employer: 'Amazon',
    netIncome: 'ca. 6.000 €',
    moveInDate: '1. Oktober',
  };
  const listing = { address: 'Prenzlauer Berg, Berlin', rooms: 2, size: 65, price: 1400, title: '2-Zimmer-Wohnung' };

  it('includes every supplied applicant fact', () => {
    const prompt = buildPrompt(profile, listing);
    expect(prompt).toContain('Amazon');
    expect(prompt).toContain('Software Development Engineer');
    expect(prompt).toContain('ca. 6.000 €');
    expect(prompt).toContain('unbefristete Festanstellung');
    expect(prompt).toContain('1. Oktober');
    expect(prompt).toContain('Adhi R');
  });

  it('includes the listing specifics', () => {
    const prompt = buildPrompt(profile, listing);
    expect(prompt).toContain('Prenzlauer Berg, Berlin');
    expect(prompt).toContain('65 m²');
    expect(prompt).toContain('Rooms: 2');
  });

  it('instructs the model NOT to invent lifestyle claims (smoking honesty rule)', () => {
    const prompt = buildPrompt(profile, listing).toLowerCase();
    expect(prompt).toContain('do not invent');
    expect(prompt).toContain('smoking status');
  });

  it('never mentions smoking as a fact when the profile omits it', () => {
    // The applicant asked for smoking status to be left out entirely. It must
    // not appear as an asserted fact anywhere in the applicant-facts block.
    const prompt = buildPrompt(profile, listing);
    const factsBlock = prompt.split('APPLICANT FACTS:')[1].split('LISTING:')[0];
    expect(factsBlock.toLowerCase()).not.toContain('nichtraucher');
    expect(factsBlock.toLowerCase()).not.toContain('non-smoker');
  });

  it('degrades gracefully when facts and listing details are missing', () => {
    const prompt = buildPrompt({}, {});
    expect(prompt).toContain('(none provided)');
    expect(prompt).toContain('(no details)');
  });

  it('demands German-only output with no preamble or translation', () => {
    const prompt = buildPrompt(profile, listing);
    expect(prompt).toMatch(/only the german message body/i);
  });
});

describe('messageGenerator.isMessageGeneratorEnabled', () => {
  it('reflects presence of GEMINI_API_KEY', () => {
    const original = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    expect(isMessageGeneratorEnabled()).toBe(false);
    process.env.GEMINI_API_KEY = 'test-key';
    expect(isMessageGeneratorEnabled()).toBe(true);
    if (original === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = original;
  });
});
