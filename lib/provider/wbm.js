/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { load } from 'cheerio';
import { buildHash, isOneOf, mapLimit } from '../utils.js';
import { extractNumber } from '../utils/extract-number.js';
import fetchHtml from '../services/extractor/httpExtractor.js';
/** @import { ParsedListing } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */

const BASE_URL = 'https://www.wbm.de';
const SEARCH_PATH = '/wohnungen-berlin/angebote/';
const DETAIL_CONCURRENCY = 3;

function absoluteWbmUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, BASE_URL);
    return url.protocol === 'https:' && ['wbm.de', 'www.wbm.de'].includes(url.hostname.toLowerCase()) ? url.href : null;
  } catch {
    return null;
  }
}

function parseSearchPage(html) {
  const $ = load(html);
  const seen = new Set();
  return $('a[href*="/wohnungen-berlin/angebote/details/"]')
    .map((_, element) => absoluteWbmUrl($(element).attr('href')))
    .get()
    .filter((url) => url != null && !seen.has(url) && seen.add(url));
}

function labelledValue($, rowSelector, labelSelector, valueSelector, label) {
  const row = $(rowSelector)
    .filter((_, element) => $(element).find(labelSelector).text().trim().toLowerCase().startsWith(label.toLowerCase()))
    .first();
  if (!row.length) return null;
  if (valueSelector) return row.find(valueSelector).first().text().trim() || null;
  const clone = row.clone();
  clone.find(labelSelector).remove();
  return clone.text().trim() || null;
}

function parseDetailPage(html, link) {
  const $ = load(html);
  const title = $('.openimmo-detail__title').first().text().trim();
  if (!title) return null;

  const objectNumber = labelledValue($, '.openimmo-detail__object-list-item', 'span', null, 'Objektnummer:');
  const coldRent = labelledValue(
    $,
    '.openimmo-detail__rental-costs-list-item',
    '.openimmo-detail__rental-costs-list-item-title',
    '.openimmo-detail__rental-costs-list-item-value',
    'Nettokaltmiete',
  );
  const rooms = labelledValue($, '.openimmo-detail__object-list-item', 'span', null, 'Anzahl der Zimmer:');
  const size = labelledValue($, '.openimmo-detail__object-list-item', 'span', null, 'Größe:');

  return {
    id: objectNumber || link,
    link,
    title,
    price: coldRent,
    size,
    rooms,
    address: $('.openimmo-detail__intro-address').first().text().trim() || null,
    image: absoluteWbmUrl($('meta[property="og:image"]').attr('content')),
    description: $('.openimmo-detail__intro-text').first().text().replace(/\s+/g, ' ').trim() || null,
  };
}

/**
 * Fetch the direct WBM offer index and enrich its small active set from the detail pages.
 * A listing that disappears between the index and detail requests is skipped and retried next run;
 * a total detail outage fails loudly instead of reporting an empty search.
 *
 * @param {string} url
 * @param {typeof fetchHtml} [loadPage]
 * @returns {Promise<Object[]>}
 */
async function getListings(url, loadPage = fetchHtml) {
  const searchHtml = await loadPage(url, { name: 'wbm' });
  if (!searchHtml) throw new Error('WBM offer index could not be loaded.');

  const links = parseSearchPage(searchHtml);
  if (links.length === 0) return [];

  const details = await mapLimit(links, DETAIL_CONCURRENCY, async (link) => {
    const html = await loadPage(link, { name: 'wbm' });
    return html ? parseDetailPage(html, link) : null;
  });
  const listings = details.filter((entry) => entry != null && !(entry instanceof Error));
  if (listings.length === 0) throw new Error('WBM detail pages could not be loaded.');
  return listings;
}

/**
 * WBM redirects withdrawn detail pages instead of returning 404. Do not follow that redirect: a
 * direct 200 with the expected detail marker is active; a redirect is definitive removal.
 *
 * @param {string} link
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<number>}
 */
export async function isListingActive(link, fetchImpl = fetch) {
  const url = absoluteWbmUrl(link);
  if (!url) return -1;
  try {
    const response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    if (response.status === 404 || response.status === 410 || (response.status >= 300 && response.status < 400)) {
      return 0;
    }
    if (response.status === 401 || response.status === 403) return -1;
    if (response.status !== 200) return -1;
    return (await response.text()).includes('openimmo-detail__title') ? 1 : -1;
  } catch {
    return -1;
  }
}

function extractDecimal(value) {
  const match = String(value ?? '').match(/\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const number = Number.parseFloat(match[0].replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

/** @param {Object} raw @returns {ParsedListing} */
function normalize(raw) {
  return {
    id: buildHash(String(raw.id)),
    link: absoluteWbmUrl(raw.link),
    title: raw.title?.trim() || null,
    price: extractNumber(raw.price),
    size: extractDecimal(raw.size),
    rooms: extractDecimal(raw.rooms),
    address: raw.address?.trim() || null,
    image: absoluteWbmUrl(raw.image),
    description: raw.description || undefined,
  };
}

function applyBlacklist(listing, blacklist) {
  return !isOneOf(listing.title, blacklist) && !isOneOf(listing.description, blacklist);
}

/** @type {ProviderConfig} */
const config = {
  requiredFieldNames: ['id', 'link', 'title', 'price', 'size', 'rooms', 'address', 'image', 'description'],
  url: null,
  crawlFields: {
    id: 'id',
    title: 'title',
    price: 'price',
    size: 'size',
    rooms: 'rooms',
    link: 'link',
    address: 'address',
    image: 'image',
    description: 'description',
  },
  sortByDateParam: null,
  normalize,
  getListings,
  activityProbe: isListingActive,
};

export const createConfig = (sourceConfig, blacklist = []) => ({
  ...config,
  enabled: sourceConfig.enabled,
  url: `${BASE_URL}${SEARCH_PATH}`,
  filter: (listing) => applyBlacklist(listing, blacklist ?? []),
});

export const metaInformation = {
  countries: ['de'],
  name: 'WBM',
  baseUrl: `${BASE_URL}/`,
  id: 'wbm',
  capabilities: {
    application: {
      manual: true,
      automatic: true,
      validation: 'local',
      profileRequirements: ['identity', 'contact', 'household'],
      consentRequirements: ['provider-privacy'],
      connectionRequired: false,
      eligibility: 'provider',
    },
  },
};

export { config, parseDetailPage, parseSearchPage };
