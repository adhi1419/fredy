/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { buildHash, isOneOf } from '../utils.js';
import checkIfListingIsActive from '../services/listings/listingActiveTester.js';
import { extractNumber } from '../utils/extract-number.js';
import { extractBuildingFacts, normalizeBuildYear } from '../utils/buildingFacts.js';
import { sanitize } from '../utils/priceExtractors.js';
/** @import { ParsedListing } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */
import fetchHtml from '../services/extractor/httpExtractor.js';
import logger from '../services/logger.js';
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

function cleanDescription(value) {
  if (value == null) return '';
  return String(value)
    .replace(/<br[^>]*>/gi, '\n')
    .split(/\r\n?|\n/)
    .map(cleanText)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildAddressFromJsonLd(address) {
  if (!address || typeof address !== 'object') return null;

  const locality = cleanText(address.addressLocality);
  const region = cleanText(address.addressRegion);
  const postalCode = cleanText(address.postalCode);
  const streetAddress = cleanText(address.streetAddress);

  const cityPart = [region, locality].filter(Boolean).join(' - ');
  const tail = [postalCode, cityPart || locality || region].filter(Boolean).join(' ');
  const fullAddress = [streetAddress, tail].filter(Boolean).join(', ');

  return fullAddress || null;
}

function flattenJsonLdNodes(node, acc = []) {
  if (node == null) return acc;

  if (Array.isArray(node)) {
    node.forEach((item) => flattenJsonLdNodes(item, acc));
    return acc;
  }

  if (typeof node !== 'object') return acc;

  acc.push(node);

  if (Array.isArray(node['@graph'])) {
    node['@graph'].forEach((item) => flattenJsonLdNodes(item, acc));
  }

  if (node.mainEntity) {
    flattenJsonLdNodes(node.mainEntity, acc);
  }

  if (node.itemOffered) {
    flattenJsonLdNodes(node.itemOffered, acc);
  }

  return acc;
}

function extractDetailFromHtml(html) {
  const $ = cheerio.load(html);
  const nodes = [];

  // Prefer the rendered postal address block from the detail page because
  // it contains the street line that is missing from list results.
  const streetFromDom = cleanText($('#street-address').first().text());
  const localityFromDom = cleanText($('#viewad-locality').first().text());
  const domAddress = [streetFromDom, localityFromDom].filter(Boolean).join(' ');

  $('script[type="application/ld+json"]').each((_, element) => {
    const content = $(element).text();
    if (!content) return;

    try {
      const parsed = JSON.parse(content);
      flattenJsonLdNodes(parsed, nodes);
    } catch {
      // Ignore broken JSON-LD blocks from ads/trackers and keep trying others.
    }
  });

  let detailAddress = null;
  let detailDescription = null;

  if (domAddress) {
    detailAddress = domAddress;
  }

  for (const node of nodes) {
    const candidateAddress = buildAddressFromJsonLd(
      node.address || node?.itemOffered?.address || node?.offers?.address,
    );
    if (!detailAddress && candidateAddress) {
      detailAddress = candidateAddress;
    }

    const candidateDescription = cleanDescription(node.description || node?.itemOffered?.description);
    if (!detailDescription && candidateDescription) {
      detailDescription = candidateDescription;
    }

    if (detailAddress && detailDescription) {
      break;
    }
  }

  return {
    detailAddress,
    detailDescription,
    ...extractFiguresFromHtml($),
  };
}

/**
 * Reads living space, room count and construction year from the detail page's attribute list.
 *
 * Not every search result carries the `89 m² · 2 Zi.` tag line - sellers who leave the structured
 * fields out of the list view still fill them in on the ad itself - and those listings showed up
 * with "N/A" for both. The list looks like
 * `<li class="addetailslist--detail">Wohnfläche<span class="addetailslist--detail--value">89 m²</span></li>`.
 *
 * @param {import('cheerio').CheerioAPI} $
 * @returns {{detailSize: string|null, detailRooms: string|null, detailBuildYear: string|null}}
 */
function extractFiguresFromHtml($) {
  const figures = {};

  $('.addetailslist--detail').each((_, element) => {
    const entry = $(element);
    const value = cleanText(entry.find('.addetailslist--detail--value').first().text());
    // The label is the element's own text, i.e. everything the value span does not cover.
    const label = cleanText(entry.clone().children().remove().end().text());
    if (label && value) {
      figures[label] = value;
    }
  });

  return {
    detailSize: figures['Wohnfläche'] ?? null,
    detailRooms: figures['Zimmer'] ?? null,
    detailBuildYear: figures['Baujahr'] ?? null,
  };
}

/**
 * Enrich a listing from its server-rendered detail page.
 *
 * @param {ParsedListing} listing
 * @param {unknown} [_browser] Passed by the pipeline to every provider; unused here.
 * @param {typeof fetchHtml} [loadPage] The page loader; injectable for tests.
 * @returns {Promise<ParsedListing>}
 */
async function fetchDetails(listing, _browser, loadPage = fetchHtml) {
  const absoluteLink = toAbsoluteLink(listing.link);
  if (!absoluteLink) return listing;

  try {
    const html = await loadPage(absoluteLink, { name: 'kleinanzeigen_details' });
    if (!html) return { ...listing, link: absoluteLink };

    const { detailAddress, detailDescription, detailSize, detailRooms, detailBuildYear } = extractDetailFromHtml(html);

    const description = detailDescription || listing.description;

    return {
      ...listing,
      link: absoluteLink,
      address: detailAddress || listing.address,
      description,
      // Only fills what the tag line on the search result did not provide.
      size: listing.size ?? extractNumber(detailSize),
      rooms: listing.rooms ?? extractNumber(detailRooms),
      buildYear: normalizeBuildYear(detailBuildYear),
      // The attribute list has no energy class; sellers who state one write it into the ad text.
      energyClass: extractBuildingFacts(description).energyClass,
    };
  } catch (error) {
    logger.warn(`Could not fetch Kleinanzeigen detail page for listing '${listing.id}'.`, error?.message || error);
    return { ...listing, link: absoluteLink };
  }
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

/**
 * Fetch the job's search results over plain HTTP. One page: results are sorted newest first, and a
 * run every few minutes never has more than a page of new ones.
 *
 * @param {string} url
 * @param {typeof fetchHtml} [loadPage] The page loader; injectable for tests.
 * @returns {Promise<object[]>}
 */
async function getListings(url, loadPage = fetchHtml) {
  const html = await loadPage(url, { name: 'kleinanzeigen' });
  if (!html) throw new Error('Kleinanzeigen search page could not be loaded.');
  return parseSearchResults(html);
}

/**
 * The ad's price from its detail page's microdata. `content` is machine-readable, while the visible
 * node carries the currency and, for some categories, a "VB" suffix. Read through {@link sanitize}
 * because the attribute is English-decimal ("1600.00") and the German-format parser behind the
 * generic selector path would read it as 160000.
 *
 * @param {string} html
 * @returns {number|null}
 */
function readPrice(html) {
  return sanitize(cheerio.load(html)('[itemprop="price"]').attr('content'));
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
  browserless: true,
  fetchDetails,
  normalize: normalize,
  activityProbe: checkIfListingIsActive,
  priceTracking: {
    extract: readPrice,
  },
};
export const metaInformation = {
  countries: ['de'],
  name: 'Kleinanzeigen',
  baseUrl: 'https://www.kleinanzeigen.de/',
  id: 'kleinanzeigen',
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
export { config, parseSearchResults };
