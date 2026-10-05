/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import logger from '../logger.js';
import { botDetected } from './utils.js';

/**
 * Plain-HTTP counterpart to the browser extractor, for portals that render their listings on the
 * server. A request costs a few hundred milliseconds instead of a browser start and a page render,
 * and there is no browser process to leak or crash.
 *
 * The headers are a desktop browser's, in German: the portals using this serve German content
 * and answer a bare client differently.
 */

const DEFAULT_TIMEOUT_MS = 30_000;

export const BROWSER_HEADERS = Object.freeze({
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.7,en;q=0.5',
});

/**
 * Fetch a page's HTML.
 *
 * Same contract as the browser extractor: the document, or null when the page could not be read -
 * a network error, a timeout, a non-2xx answer or a bot wall. Never throws, so a provider can treat
 * "nothing" the same way on both paths.
 *
 * @param {string} url
 * @param {{ name?: string, timeoutMs?: number, headers?: Record<string, string> }} [options]
 *   `name` is log context only.
 * @returns {Promise<string|null>}
 */
export default async function fetchHtml(url, options = {}) {
  try {
    const response = await fetch(url, {
      headers: { ...BROWSER_HEADERS, ...(options.headers ?? {}) },
      redirect: 'follow',
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    const html = await response.text();
    if (botDetected(html, response.status)) {
      logger.warn(`Blocked as a bot (HTTP ${response.status}) loading ${options.name ?? url}.`);
      return null;
    }
    if (!response.ok) {
      logger.debug(`HTTP ${response.status} loading ${options.name ?? url}.`);
      return null;
    }
    return html;
  } catch (error) {
    logger.warn(`Could not load ${options.name ?? url}.`, error?.message ?? error);
    return null;
  }
}
