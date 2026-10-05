/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { buildHash, isOneOf } from '../utils.js';
import checkIfListingIsActive from '../services/listings/listingActiveTester.js';
import { extractNumber } from '../utils/extract-number.js';
/** @import { ParsedListing } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */
import fetchHtml from '../services/extractor/httpExtractor.js';
import * as cheerio from 'cheerio';

function toAbsoluteLink(link) {
  if (!link) return null;
  return link.startsWith('http') ? link : `https://www.kleinanzeigen.de${link}`;
}

function cleanText(value) {
  if (value == null) return '';
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Read the search results out of a server-rendered results page.
 *
 * Kleinanzeigen renders every result into the HTML, so no browser is needed. Each result is an
 * `<article data-adid data-href>` inside `#srchrslt-adtable`. The page's utility CSS classes are
 * generated and change with every redesign - the summer 2026 one renamed every class the old
 * selectors used, and the provider silently found nothing for five weeks - so fields are read by
 * structure and content instead: the `<h3>` is the title, the paragraph naming m² or Zi. is the
 * tag line, the first euro amount that is not struck through is the price, and the text after the
 * location pin is the address.
 *
 * A page with no results has no result list and says so in its heading. A page with neither is
 * not a results page (an error, a consent wall) and is reported as a failure rather than as "no
 * new listings", which is how the redesign went unnoticed.
 *
 * @param {string} html
 * @returns {{id: string, link: string, title: string|null, price: string|null, tags: string|null,
 *   description: string|null, address: string|null, image: string|null}[]}
 * @throws {Error} When the page is not a search result page.
 */
function parseSearchResults(html) {
  const $ = cheerio.load(html);
  const table = $('#srchrslt-adtable');
  if (table.length === 0) {
    if (/keine Ergebnisse/i.test($('h1').text())) return [];
    throw new Error('Kleinanzeigen answered with a page that is not a search result list.');
  }

  const text = (node) => cleanText(node.text()) || null;
  const results = [];
  table.find('article[data-adid]').each((_, element) => {
    const article = $(element);
    const id = article.attr('data-adid');
    const link = article.attr('data-href');
    if (!id || !link) return;

    const title = article.find('h3').first();
    // The description is the paragraph right after the title. It is free text and often names a
    // size or a rent itself ("96-m²-Wohnung", "Warmmiete 2.270 €"), so the tag line and the price
    // are only looked for in the paragraphs after it.
    const description = title.nextAll('p').first();
    const following = (description.length ? description.nextAll('p') : title.nextAll('p'))
      .add(description.length ? description.nextAll().find('p') : title.nextAll().find('p'))
      .toArray()
      .map((p) => $(p));
    const tags = following.find((p) => /m²|\bZi\./.test(p.text()));
    const price = following.find((p) => /€/.test(p.text()) && !/line-through/.test(p.attr('class') ?? ''));
    const location = article.find('svg[data-title="locationOutline"]').first().parent();

    results.push({
      id,
      link,
      title: text(title),
      price: price ? text(price) : null,
      tags: tags ? text(tags) : null,
      description: description.length ? text(description) : null,
      address: location.length ? text(location) : null,
      image: article.find('img').first().attr('src') ?? null,
    });
  });
  return results;
}

/** Pages walked at most per search. A narrowed search has a handful; this bounds a city-wide one. */
const MAX_PAGES = 10;

/**
 * The URL of one result page. Kleinanzeigen puts the page number in the path, as a `seite:N` segment
 * right before the category segment (`c203l3331+…`), and the first page has none.
 *
 * @param {string} url The job's search URL.
 * @param {number} page 1-based.
 * @returns {string|null} Null when the URL has no category segment to page against.
 */
function pageUrl(url, page) {
  const parsed = new URL(url);
  const segments = parsed.pathname.split('/').filter((segment) => !/^seite:\d+$/.test(segment));
  const category = segments.findIndex((segment) => /^c\d/.test(segment));
  if (category < 0) return page === 1 ? url : null;
  if (page > 1) segments.splice(category, 0, `seite:${page}`);
  parsed.pathname = segments.join('/');
  return parsed.href;
}

/**
 * How many results the search has in total, from the "1 - 25 von 72 Ergebnissen" line.
 *
 * @param {string} html
 * @returns {number|null}
 */
function totalResults(html) {
  const match = /\d+\s*-\s*\d+\s+von\s+([\d.]+)/.exec(cheerio.load(html)('h1').text());
  return match ? Number(match[1].replace(/\./g, '')) : null;
}

/**
 * Fetch every result page of the job's search over plain HTTP.
 *
 * A page holds 25 results, and the first page alone used to be all that was read: anything past
 * the 25th newest result was never seen, which on a busy search included every listing the next
 * page held when it first appeared. The pages are walked until the total the first page reports
 * is covered, a page comes back empty, or {@link MAX_PAGES} is reached. Results repeated across a
 * page boundary (the list shifts while it is walked) are kept once.
 *
 * @param {string} url
 * @param {typeof fetchHtml} [loadPage] The page loader; injectable for tests.
 * @returns {Promise<object[]>}
 */
async function getListings(url, loadPage = fetchHtml) {
  const first = await loadPage(url, { name: 'kleinanzeigen' });
  if (!first) throw new Error('Kleinanzeigen search page could not be loaded.');
  const byId = new Map(parseSearchResults(first).map((result) => [result.id, result]));
  const total = totalResults(first);

  for (let page = 2; page <= MAX_PAGES && total != null && byId.size < total; page++) {
    const next = pageUrl(url, page);
    if (next == null) break;
    const html = await loadPage(next, { name: 'kleinanzeigen' });
    // A later page failing costs only the listings on it; the ones already read are still good.
    if (!html) break;
    const pageResults = parseSearchResults(html);
    if (pageResults.length === 0) break;
    for (const result of pageResults) if (!byId.has(result.id)) byId.set(result.id, result);
  }

  return [...byId.values()];
}

/**
 * Reads living space and room count out of a search result's tag line.
 *
 * The line usually reads `89 m² · 2 Zi.`, but the separator is not always there - when the tags
 * come as individual `<span>`s the extracted text collapses to `89 m²2 Zi.`. Splitting on the
 * middle dot then produced a single part matching both units, and the room count came out as the
 * living space. Matching each figure by its unit copes with either shape.
 *
 * @param {string|undefined|null} tags
 * @returns {{size: string|null, rooms: string|null}}
 */
function readTags(tags) {
  const text = tags || '';

  return {
    size: /([\d.,]+)\s*m²/.exec(text)?.[1] ?? null,
    rooms: /([\d.,]+)\s*Zi/i.exec(text)?.[1] ?? null,
  };
}

/**
 * @param {any} o
 * @returns {ParsedListing}
 */
function normalize(o) {
  const { size, rooms } = readTags(o.tags);
  const id = buildHash(o.id, o.price);

  return {
    id,
    title: o.title,
    link: toAbsoluteLink(o.link) || o.link,
    price: extractNumber(o.price),
    size: extractNumber(size),
    rooms: extractNumber(rooms),
    address: o.address,
    description: o.description,
    image: o.image,
  };
}

/**
 * @param {ParsedListing} o
 * @param {string[]} appliedBlackList Terms the job wants filtered out.
 * @param {string[]} appliedBlacklistedDistricts Districts the job wants filtered out.
 * @returns {boolean}
 */
function applyBlacklist(o, appliedBlackList, appliedBlacklistedDistricts) {
  const titleNotBlacklisted = !isOneOf(o.title, appliedBlackList);
  const descNotBlacklisted = !isOneOf(o.description, appliedBlackList);
  const isBlacklistedDistrict =
    appliedBlacklistedDistricts.length === 0 ? false : isOneOf(o.description, appliedBlacklistedDistricts);
  return o.title != null && !isBlacklistedDistrict && titleNotBlacklisted && descNotBlacklisted;
}

/** @type {ProviderConfig} */
const config = {
  requiredFieldNames: ['id', 'link', 'title', 'price', 'size', 'rooms', 'address', 'image', 'description'],
  url: null,
  //sort by date is standard oO
  sortByDateParam: null,
  getListings,
  normalize: normalize,
  activityProbe: checkIfListingIsActive,
};
export const metaInformation = {
  countries: ['de'],
  name: 'Kleinanzeigen',
  baseUrl: 'https://www.kleinanzeigen.de/',
  id: 'kleinanzeigen',
  capabilities: {
    application: {
      manual: true,
      automatic: true,
      validation: 'provider',
      profileRequirements: ['identity'],
      consentRequirements: ['provider-privacy'],
      connectionRequired: false,
      eligibility: 'provider',
    },
  },
};
/**
 * Build a run-scoped provider configuration.
 *
 * Returns a fresh object on every call instead of mutating module-level state. Two jobs can be in
 * flight at once - a manual run started while the scheduler is working through the others - and a
 * shared mutable config meant the second job overwrote the first job's URL and blacklist mid-run,
 * so listings were fetched for one job and stored under another.
 *
 * @param {{url: string, enabled?: boolean}} sourceConfig The job's entry for this provider.
 * @param {string[]} [blacklist] Terms to filter listings out by.
 * @param {string[]} [blacklistedDistricts] Districts to filter listings out by.
 * @returns {ProviderConfig} A configuration usable by a single pipeline run.
 */
export const createConfig = (sourceConfig, blacklist = [], blacklistedDistricts = []) => ({
  ...config,
  enabled: sourceConfig.enabled,
  url: sourceConfig.url,
  filter: (listing) => applyBlacklist(listing, blacklist ?? [], blacklistedDistricts ?? []),
});
export { config, pageUrl, parseSearchResults };
