/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/** @import { ParsedListing } from './listing.js' */

/**
 * Configuration for one provider, scoped to a single pipeline run.
 *
 * Provider modules export a static template plus `createConfig(sourceConfig, blacklist)`, which
 * returns a fresh instance of this shape per run. Nothing here may be shared between runs: two
 * jobs can execute concurrently, and a shared object let the second one overwrite the first one's
 * `url` and bound `filter` mid-run.
 *
 * @typedef {Object} ProviderConfig
 * @property {string} [url] The search URL for this run. Null on the static template.
 * @property {string} [refererUrl] Original search URL, when the provider queries an API and has to send the page it came from as the referer.
 * @property {string} [sortByDateParam] Query parameter used to enforce sorting by date.
 * @property {Object.<string, string>} crawlFields Mapping of field names to selectors/paths.
 * @property {string[]} requiredFieldNames List of field names that this provider supports.
 * @property {string} [crawlContainer] CSS selector for the container holding listing items.
 * @property {(raw: any) => ParsedListing} normalize Function to convert raw scraped data into a ParsedListing shape.
 * @property {(listing: ParsedListing) => boolean} filter Filters out unwanted listings. Bound to this run's blacklist by `createConfig`, so it is absent from the static template.
 * @property {(url: string) => Promise<any[]>} getListings Fetch this provider's listings over HTTP (or its API). Required: every provider reads its own listings; there is no shared default extractor.
 * @property {boolean} [enabled] Whether the provider is enabled.
 * @property {(url: string) => Promise<number> | number} [activityProbe] Cheap "is this still online?" check for a stored listing. Returns 1 when active, 0 when gone, -1 when the answer could not be obtained (bot wall, network failure).
 * @property {(url: string) => Promise<number> | number} [activeTester] Deprecated alias for `activityProbe`, still honoured by the alive-checker.
 */

/**
 * The provider's identity, exported as `metaInformation` alongside `config` and `createConfig`.
 *
 * Static and run-independent, which is why it is a plain object rather than something
 * `createConfig` hands out: the id names the provider in job configs, in listing rows and in the
 * `/api/jobs/provider` response the UI builds its provider picker from.
 *
 * @typedef {Object} ProviderMetaInformation
 * @property {string} id Stable identifier. Stored on every listing this provider finds, so renaming one orphans its listings.
 * @property {string} name Display name, shown in the UI.
 * @property {string} baseUrl The portal's root, used to build absolute links out of relative ones.
 * @property {string[]} countries ISO 3166-1 alpha-2 codes the provider serves, lowercase. Required - see `lib/services/providers/countries.js`. Read by the geocoder, which searches Nominatim within them, by the map, whose `maxBounds` is the union of their bounding boxes, and by the job form, which flags each provider with its country.
 * @property {{application: ProviderApplicationCapabilities}} capabilities Additive provider capability metadata for callers. It contains categories only; it never contains credentials or applicant values.
 */

/**
 * Declarative application support exposed in provider metadata.
 *
 * @typedef {Object} ProviderApplicationCapabilities
 * @property {boolean} manual Whether the existing manual listing application path is available.
 * @property {boolean} automatic Whether Fredy has an automatic application adapter.
 * @property {'provider'|'listing'|'none'} eligibility Whether support applies to every listing or requires listing-level checks.
 * @property {'provider'|'local'|'none'} validation How the adapter validates before submission.
 * @property {string[]} profileRequirements Non-secret applicant profile categories needed by the adapter.
 * @property {string[]} consentRequirements Non-secret provider consent categories needed by the adapter.
 * @property {boolean} connectionRequired Whether a future provider connection is required.
 */

export {};
