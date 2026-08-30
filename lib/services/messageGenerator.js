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
 *          price?: number, provider?: string, description?: string}} listing
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
    // Label the figure neutrally: the provider does not tell us whether it is
    // Kalt- or Warmmiete, so the model must not assert one.
    l.price != null && `Rent as listed (EUR, may be cold or warm — do not assume): ${l.price}`,
    // The full expose text (amenities, floor, availability, energy, Warm/Kalt
    // breakdown) — the richest source of flat-specific detail. Capped so a long
    // marketing description can't blow the prompt budget.
    l.description &&
      `Listing description (reference concrete features from here to show genuine interest; do NOT invent beyond it):\n${String(l.description).slice(0, 1500)}`,
  ]
    .filter(Boolean)
    .join('\n');

  return `You draft a single German rental inquiry message ("Anfrage") that the applicant will review and send themselves.

Write it to match this proven structure and tone:
- Salutation "Sehr geehrte Damen und Herren," (formal Sie throughout).
- One opening line expressing interest in THIS specific flat. Reference ONLY attributes actually provided below — the neighborhood/location (safe, from the address) and, when given, the size and room count. Do NOT claim the layout ("Aufteilung"), condition, view, or any interior feature fits unless it is explicitly present in the listing description. When little is known, anchor the interest to the neighborhood/location alone rather than inventing specifics.
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
      generationConfig: {
        temperature: 0.4,
        // gemini-3.x flash is a "thinking" model: internal reasoning draws
        // from the SAME output budget. A low cap let thinking consume it all,
        // truncating the visible message to a few words. Disable thinking for
        // this task (deterministic template fill needs none) and give the
        // German body ample room.
        maxOutputTokens: 2048,
        // gemini-3.x uses thinkingLevel (enum), NOT the integer thinkingBudget
        // knob from the 2.x era — sending thinkingBudget to a Gemini-3 model
        // returns 400 INVALID_ARGUMENT. MINIMAL = little-to-no reasoning, so
        // the output budget goes to the German body, not internal thoughts.
        thinkingConfig: { thinkingLevel: 'MINIMAL' },
      },
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
