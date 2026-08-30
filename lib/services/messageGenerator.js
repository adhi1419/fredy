/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Inquiry-message generator (Gemini).
 *
 * Produces a DRAFT German rental inquiry the user reviews and sends themselves
 * (Fredy never contacts a landlord). On-demand only — called from the listing
 * detail route when the user clicks "generate", never during a scrape.
 *
 * Enabled only when GEMINI_API_KEY is set; the route 404s otherwise, so
 * classic/local deployments never need a key.
 *
 * The prompt encodes the gold template designed with the user (permanent
 * employment + employer + net income up front, low-drama trust signals, docs
 * offered proactively with the no-rent-debt certificate deferred, ~150 words,
 * formal Sie). The model only fills listing specifics and the applicant's
 * fixed profile fields — it is explicitly forbidden from inventing lifestyle
 * claims (e.g. smoking status) that were not provided.
 */

import logger from './logger.js';

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

export function isMessageGeneratorEnabled() {
  return !!process.env.GEMINI_API_KEY;
}

/**
 * Build the prompt from the applicant profile + a single listing.
 * Exported for testing (prompt assembly is the part worth asserting).
 *
 * @param {{name?: string, employer?: string, jobTitle?: string, netIncome?: string,
 *          employmentType?: string, moveInDate?: string, extraFacts?: string}} profile
 * @param {{title?: string, address?: string, size?: number, rooms?: number,
 *          price?: number, provider?: string}} listing
 * @returns {string}
 */
export function buildPrompt(profile, listing) {
  const p = profile ?? {};
  const l = listing ?? {};
  // Only facts the user actually supplied reach the model. No inference.
  const facts = [
    p.name && `Full name: ${p.name}`,
    p.employmentType && `Employment: ${p.employmentType}`,
    p.jobTitle && `Job title: ${p.jobTitle}`,
    p.employer && `Employer: ${p.employer}`,
    p.netIncome && `Net monthly income: ${p.netIncome}`,
    p.moveInDate && `Desired move-in: ${p.moveInDate}`,
    p.extraFacts && `Additional facts (use only if relevant): ${p.extraFacts}`,
  ]
    .filter(Boolean)
    .join('\n');

  const listingFacts = [
    l.title && `Title: ${l.title}`,
    l.address && `Location/address: ${l.address}`,
    l.rooms != null && `Rooms: ${l.rooms}`,
    l.size != null && `Size: ${l.size} m²`,
    l.price != null && `Price: ${l.price}`,
  ]
    .filter(Boolean)
    .join('\n');

  return `You draft a single German rental inquiry message ("Anfrage") that the applicant will review and send themselves.

Write it to match this proven structure and tone:
- Salutation "Sehr geehrte Damen und Herren," (formal Sie throughout).
- One opening line expressing interest in THIS specific flat and that its neighborhood, size and layout fit what the applicant seeks long-term.
- A short paragraph leading with the strongest trust signals FIRST: permanent employment ("unbefristete Festanstellung"), job title, employer, and net monthly income, noting the rent sits comfortably within the usual 3x guideline.
- Low-drama signals in one sentence: single tenant ("alleiniger Mieter"), no pets if applicable, quiet, long-term.
- Offer a SCHUFA-Auskunft and the last three payslips ("Gehaltsnachweise") proactively; state a Mietschuldenfreiheitsbescheinigung will be provided on serious interest (do NOT imply it is available immediately).
- Move-in date, noting flexibility.
- Polite request for a viewing, then "Mit freundlichen Grüßen" and the applicant's name.

HARD RULES:
- ~150 words. Concise; landlords skim.
- Output ONLY the German message body. No preamble, no translation, no notes, no markdown.
- Use ONLY the facts below. Do NOT invent anything — especially do NOT state smoking status, family situation, hobbies, or any lifestyle claim that is not explicitly provided.
- If a listing detail (rooms/size/neighborhood) is missing, phrase around it gracefully rather than guessing.

APPLICANT FACTS:
${facts || '(none provided)'}

LISTING:
${listingFacts || '(no details)'}`;
}

/**
 * Generate the draft message via Gemini.
 * @returns {Promise<string>} The German message body.
 * @throws when the API key is missing or the API call fails.
 */
export async function generateInquiryMessage(profile, listing, { fetchImpl = fetch } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const prompt = buildPrompt(profile, listing);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 500 },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    logger.error(`Gemini generateContent failed: ${res.status} ${detail.slice(0, 300)}`);
    throw new Error(`Message generation failed (${res.status})`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text).join('') ?? '';
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Message generation returned empty text');
  return trimmed;
}
