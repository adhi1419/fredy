/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { readAdapterReadme } from '../../services/markdown.js';
import { getJob } from '../../services/storage/jobStorage.js';
import fetch from 'node-fetch';
import pThrottle from 'p-throttle';
import { normalizeImageUrl } from '../../utils.js';
import logger from '../../services/logger.js';
import { retryWithBackoff } from '../../utils/retry.js';
import { shouldUseMultipart, buildPhotoFormData } from './telegramPhotoUploader.js';
import { toPriceChangeListing } from '../priceChangeMessage.js';

const RATE_LIMIT_INTERVAL = 1000;
const THROTTLE_MAX_IDLE_MS = RATE_LIMIT_INTERVAL + 2000;
const chatThrottleMap = new Map();

/**
 * Removes stale throttled call entries to keep memory bounded.
 * An entry is stale when no API call has fired for longer than THROTTLE_MAX_IDLE_MS.
 */
function cleanupOldThrottles() {
  const now = Date.now();
  for (const [chatId, chatThrottle] of chatThrottleMap.entries()) {
    if (now - chatThrottle.lastUsedAt > THROTTLE_MAX_IDLE_MS) chatThrottleMap.delete(chatId);
  }
}

/**
 * Return a throttled wrapper for a chatId to limit Telegram API calls.
 * Uses p-throttle with 1 request per RATE_LIMIT_INTERVAL per chat.
 * `lastUsedAt` is refreshed on every actual API call so that the idle window
 * starts from the last fired call, not from when send() was invoked.
 *
 * @param {string|number} chatId
 * @param {Function} call - async function (endpoint: string, body: any) => Promise<Response>
 * @returns {Function}
 */
function getThrottled(chatId, call) {
  cleanupOldThrottles();
  const existing = chatThrottleMap.get(chatId);
  if (existing) {
    existing.lastUsedAt = Date.now();
    return existing.throttled;
  }
  const entry = { lastUsedAt: Date.now(), throttled: null };
  chatThrottleMap.set(chatId, entry);
  entry.throttled = pThrottle({ limit: 1, interval: RATE_LIMIT_INTERVAL })(async (endpoint, body) => {
    const e = chatThrottleMap.get(chatId);
    if (e) e.lastUsedAt = Date.now();
    return call(endpoint, body);
  });
  return entry.throttled;
}

/**
 * Shorten a string to a maximum length with an ellipsis suffix.
 * @param {string} str
 * @param {number} [len=90]
 * @returns {string}
 */
function shorten(str, len = 90) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len).trim() + '...' : str;
}

/**
 * Escape basic HTML entities for Telegram HTML parse mode.
 * @param {string} [s='']
 * @returns {string}
 */
function escapeHtml(s = '') {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function wasApplied(listing) {
  return (listing?.inquirySendStatus ?? listing?.inquiry_send_status) === 'sent';
}

/**
 * Build a Telegram HTML-formatted message body.
 * Suitable for both sendMessage (uncapped) and sendPhoto captions (caller must slice to 1024).
 *
 * @param {string} jobName
 * @param {string} serviceName
 * @param {Object} o - Listing object
 * @param {string} [baseUrl]
 * @returns {string}
 */
function buildHtmlBody(jobName, serviceName, o, baseUrl) {
  const title = shorten((o.title || '').replace(/\*/g, ''), 90);
  const meta = [o.address, o.price, o.size, o.commute].filter(Boolean).join(' | ');
  const fredyLink =
    baseUrl && o.id ? `\n<a href='${escapeHtml(`${baseUrl}/#/listings/listing/${o.id}`)}'>Open in Fredy</a>` : '';
  return (
    `${wasApplied(o) ? '[Applied] ' : ''}<i>${escapeHtml(jobName)}</i> (${escapeHtml(serviceName)})\n` +
    `<a href='${escapeHtml(o.link || '')}'><b>${escapeHtml(title)}</b></a>\n` +
    `${escapeHtml(meta)}${fredyLink}`
  );
}

/**
 * Build a plain-text Telegram photo caption (max 4096 characters).
 * Meta appears before the link so the most relevant info is visible within the cap.
 *
 * @param {string} jobName
 * @param {string} serviceName
 * @param {Object} o - Listing object
 * @param {string} [baseUrl]
 * @returns {string}
 */
function buildPlainCaption(jobName, serviceName, o, baseUrl) {
  const title = shorten((o.title || '').replace(/\*/g, ''), 90);
  const meta = [o.address, o.price, o.size, o.commute].filter(Boolean).join(' | ');
  const fredyLine = baseUrl && o.id ? `\nOpen in Fredy: ${baseUrl}/#/listings/listing/${o.id}` : '';
  return `${wasApplied(o) ? '[Applied] ' : ''}${jobName} (${serviceName})\n${title}\n${meta}\n\n${o.link || ''}${fredyLine}`.slice(
    0,
    4096,
  );
}

/**
 * Build a plain-text Telegram message body.
 * Link appears early so it is tappable without scrolling.
 *
 * @param {string} jobName
 * @param {string} serviceName
 * @param {Object} o - Listing object
 * @param {string} [baseUrl]
 * @returns {string}
 */
function buildPlainText(jobName, serviceName, o, baseUrl) {
  const title = shorten((o.title || '').replace(/\*/g, ''), 90);
  const meta = [o.address, o.price, o.size, o.commute].filter(Boolean).join(' | ');
  const fredyLine = baseUrl && o.id ? `\nOpen in Fredy: ${baseUrl}/#/listings/listing/${o.id}` : '';
  return `${wasApplied(o) ? '[Applied] ' : ''}${jobName} (${serviceName})\n${title}\n${o.link || ''}\n${meta}${fredyLine}`;
}

/**
 * Ceiling on how long a single 429 retry will wait, in milliseconds. Telegram's `retry_after` is
 * normally a handful of seconds, but a large burst can be told to wait much longer; a job run
 * should not park for minutes on one message, so an over-long wait is treated as undeliverable this
 * run rather than blocking every later listing behind it.
 *
 * @type {number}
 */
const MAX_RETRY_AFTER_MS = 30_000;

/**
 * Parse Telegram's `retry_after` (seconds) out of a 429 body, in ms, or null when it is not a
 * 429 that names a wait. Telegram answers `{"ok":false,"error_code":429,"parameters":{"retry_after":N}}`.
 *
 * @param {string} body
 * @returns {number|null}
 */
function retryAfterMs(body) {
  try {
    const parsed = JSON.parse(body);
    if (parsed?.error_code !== 429) return null;
    const seconds = Number(parsed?.parameters?.retry_after);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Create the raw Telegram API caller for a given bot token.
 * Handles JSON and multipart (FormData) bodies.
 *
 * A 429 is retried with exponential backoff and full jitter, honoring the `retry_after` Telegram
 * hands back when it gives one. The per-chat throttle spaces calls at one per second, but a large
 * first run still outpaces Telegram's real burst tolerance; without this the midnight burst dropped
 * every draft it could not fit under the limit. Full jitter matters here for the same reason it
 * does for generation: retrying every rate-limited call after the same delay just rebuilds the
 * burst one interval later. A FormData body is a single-use stream that cannot be resent, so a
 * multipart call is not retried (the caller's photo→text fallback covers it).
 *
 * @param {string} token - Telegram bot token.
 * @param {string} jobName - Used in error messages.
 * @returns {(endpoint: string, body: object|FormData) => Promise<Response>}
 */
function makeTelegramCaller(token, jobName) {
  return async function (endpoint, body) {
    const isFormData = body instanceof FormData;
    const opts = isFormData
      ? { method: 'post', body }
      : { method: 'post', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };

    return retryWithBackoff(
      async () => {
        const res = await fetch(`https://api.telegram.org/bot${token}/${endpoint}`, opts);
        if (res.ok) return res;
        const errorBody = await res.text();
        const error = new Error(`API error for '${jobName}'. '${endpoint}' returned ${errorBody}`);
        error.telegramBody = errorBody;
        throw error;
      },
      {
        retries: 4,
        baseDelayMs: 500,
        maxDelayMs: MAX_RETRY_AFTER_MS,
        // Only a 429 is worth retrying, and never a multipart stream (it cannot be resent).
        shouldRetry: (error) => !isFormData && retryAfterMs(error?.telegramBody) != null,
        retryAfterMs: (error) => retryAfterMs(error?.telegramBody),
        onRetry: ({ attempt, delayMs }) =>
          logger.warn(`Telegram rate limited '${jobName}' on '${endpoint}'; retry ${attempt + 1} in ${delayMs} ms`),
      },
    );
  };
}

/**
 * Send the eager-generated inquiry draft as a second, plain message right after the listing.
 *
 * A separate message (not appended to the listing text) so it is trivially copy-pasteable on
 * mobile when Fredy has only drafted it. A successfully applied listing instead carries one
 * `[Applied]` listing notification and returns here without sending the already-delivered draft.
 * Sent through the SAME throttled caller so it obeys Telegram's per-chat rate limit. A missing draft (feature off, no
 * profile, or a generation failure upstream) is simply a no-op: the listing message already went.
 *
 * @param {Function} throttledCall
 * @param {Object} listing
 * @param {string|number} chatId
 * @param {number|undefined} message_thread_id
 * @returns {Promise<void>}
 */
async function sendInquiryDraftToChat(throttledCall, listing, chatId, message_thread_id) {
  if (wasApplied(listing)) return;
  const draft = listing.inquiryMessage;
  if (!draft || typeof draft !== 'string' || draft.trim().length === 0) {
    return;
  }
  return throttledCall('sendMessage', {
    chat_id: chatId,
    text: draft,
    disable_web_page_preview: true,
    ...(message_thread_id ? { message_thread_id } : {}),
  }).catch((e) => {
    // Never let the draft's delivery failure look like the listing failed.
    logger.warn(`Error sending inquiry draft to Telegram: ${e.message}`);
  });
}

/**
 * Send a single listing to a single Telegram chat, with photo-then-text fallback.
 *
 * @param {Function} throttledCall - Throttled Telegram API caller for this chat.
 * @param {Object} listing - Listing object.
 * @param {string|number} chatId
 * @param {Object} opts
 * @param {string} opts.jobName
 * @param {string} opts.serviceName
 * @param {string} opts.baseUrl
 * @param {boolean} opts.plainText
 * @param {number|undefined} opts.message_thread_id
 * @returns {Promise<void>}
 */
async function sendListingToChat(
  throttledCall,
  listing,
  chatId,
  { jobName, serviceName, baseUrl, plainText, message_thread_id },
) {
  const img = normalizeImageUrl(listing.image);

  const textPayload = {
    chat_id: chatId,
    text: plainText
      ? buildPlainText(jobName, serviceName, listing, baseUrl)
      : buildHtmlBody(jobName, serviceName, listing, baseUrl),
    ...(plainText ? {} : { parse_mode: 'HTML' }),
    disable_web_page_preview: true,
    ...(message_thread_id ? { message_thread_id } : {}),
  };

  if (!img) {
    return throttledCall('sendMessage', textPayload).catch((e) => {
      logger.error(`Error sending message to Telegram: ${e.message}`);
    });
  }

  const caption = plainText
    ? buildPlainCaption(jobName, serviceName, listing, baseUrl)
    : buildHtmlBody(jobName, serviceName, listing, baseUrl).slice(0, 1024);
  const parseMode = plainText ? undefined : 'HTML';

  // .webp URLs (Immowelt/Cloudimage) fail Telegram's URL-based sendPhoto with
  // "failed to get HTTP URL content". Upload the bytes via multipart instead.
  const photoCall = shouldUseMultipart(img)
    ? buildPhotoFormData({ chatId, imageUrl: img, caption, parseMode, messageThreadId: message_thread_id }).then((fd) =>
        throttledCall('sendPhoto', fd),
      )
    : throttledCall('sendPhoto', {
        chat_id: chatId,
        photo: img,
        caption,
        ...(parseMode ? { parse_mode: parseMode } : {}),
        ...(message_thread_id ? { message_thread_id } : {}),
      });

  return photoCall.catch(async (e) => {
    logger.warn(`Error sending photo to Telegram and use a fallback: ${e.message}`);
    return throttledCall('sendMessage', textPayload).catch((e) => {
      logger.error(`Error sending message to Telegram: ${e.message}`);
      throw e;
    });
  });
}

/**
 * Send new listings to Telegram.
 * - Respects per-chat Telegram rate limits using a lightweight throttle cache.
 * - Falls back to sendMessage when sendPhoto fails or image is missing.
 *
 * @param {Object} params
 * @param {string} params.serviceName - Name of the crawler/service producing the listings.
 * @param {Array<Object>} params.newListings - Array of new listing objects.
 * @param {Array<Object>} params.notificationConfig - Notification adapters configuration array.
 * @param {string} params.jobKey - Storage job key to resolve the human readable job name.
 * @returns {Promise<Array<Response>>} Promise resolving when all send operations complete.
 */
export const send = async ({ serviceName, newListings = [], notificationConfig, jobKey, baseUrl }) => {
  const adapterCfg = notificationConfig.find((adapter) => adapter.id === config.id);
  if (!adapterCfg || !adapterCfg.fields) {
    throw new Error(`Telegram adapter configuration missing for job '${jobKey || ''}'`);
  }
  const { token, chatId, messageThreadId, plainText } = adapterCfg.fields;
  if (!token || !chatId) {
    throw new Error("Telegram 'token' and 'chatId' must be provided in notification config");
  }

  const chatIds = String(chatId)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // Optional Telegram topic/thread support (supergroups)
  let message_thread_id;
  if (messageThreadId !== undefined && messageThreadId !== null && `${messageThreadId}`.trim() !== '') {
    const n = Number(messageThreadId);
    if (Number.isInteger(n) && n > 0) {
      message_thread_id = n;
    } else {
      logger.warn(
        `Telegram adapter: 'messageThreadId' is invalid ('${messageThreadId}'). It must be a positive integer. Ignoring.`,
      );
    }
  }

  const job = await getJob(jobKey);
  const jobName = job == null ? jobKey : job.name;

  if (!Array.isArray(newListings) || newListings.length === 0) return Promise.resolve([]);

  const allPromises = chatIds.flatMap((id) => {
    const caller = makeTelegramCaller(token, jobName);
    const throttledCall = getThrottled(id, caller);
    const opts = { jobName, serviceName, baseUrl, plainText, message_thread_id };
    return newListings.map((listing) =>
      sendListingToChat(throttledCall, listing, id, opts).then(() =>
        sendInquiryDraftToChat(throttledCall, listing, id, message_thread_id),
      ),
    );
  });

  return Promise.all(allPromises);
};

/**
 * Telegram notification adapter configuration schema.
 * @type {{id:string,name:string,readme:string,description:string,fields:{token:{type:string,label:string,description:string},chatId:{type:string,label:string,description:string},messageThreadId?:{type:string,label:string,description:string}}}}
 */
/**
 * Sends price changes over the same throttled per-chat path as new listings.
 *
 * Reusing `sendListingToChat` matters more here than the wording does: Telegram rate-limits per
 * chat, and a second, unthrottled path would be the one that trips the limit and takes the new
 * listing notifications down with it.
 *
 * @param {{serviceName: string, priceChanges: any[], notificationConfig: any[], jobKey: string, baseUrl: string}} params
 * @returns {Promise<any>}
 */
export const sendPriceChange = async ({ serviceName, priceChanges = [], notificationConfig, jobKey, baseUrl }) => {
  const adapterCfg = notificationConfig.find((adapter) => adapter.id === config.id);
  if (!adapterCfg || !adapterCfg.fields) {
    throw new Error(`Telegram adapter configuration missing for job '${jobKey || ''}'`);
  }
  const { token, chatId, messageThreadId, plainText } = adapterCfg.fields;
  if (!token || !chatId) {
    throw new Error("Telegram 'token' and 'chatId' must be provided in notification config");
  }
  if (!Array.isArray(priceChanges) || priceChanges.length === 0) return Promise.resolve([]);

  const chatIds = String(chatId)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  let message_thread_id;
  if (messageThreadId !== undefined && messageThreadId !== null && `${messageThreadId}`.trim() !== '') {
    const n = Number(messageThreadId);
    if (Number.isInteger(n) && n > 0) {
      message_thread_id = n;
    }
  }

  const job = await getJob(jobKey);
  const jobName = job == null ? jobKey : job.name;

  const allPromises = chatIds.flatMap((id) => {
    const caller = makeTelegramCaller(token, jobName);
    const throttledCall = getThrottled(id, caller);
    const opts = { jobName, serviceName, baseUrl, plainText, message_thread_id };
    return priceChanges.map((change) => sendListingToChat(throttledCall, toPriceChangeListing(change), id, opts));
  });

  return Promise.all(allPromises);
};

export const config = {
  id: 'telegram',
  name: 'Telegram',
  readme: readAdapterReadme('telegram.md'),
  description: 'Fredy will send new listings to your mobile, using Telegram.',
  fields: {
    token: {
      type: 'text',
      label: 'Token',
      description: 'The token needed to access this service.',
      // Never leaves the server for anyone who may not edit this channel.
      secret: true,
    },
    chatId: {
      type: 'chatId',
      label: 'Chat Id',
      description:
        'The chat ID to send messages to. Separate multiple IDs with commas to notify several recipients (e.g. 123456789, 987654321).',
      // Shown as the channel's destination in the UI.
      target: true,
    },
    messageThreadId: {
      type: 'text',
      optional: true,
      label: 'Message Thread Id (optional)',
      description:
        'Optional: The topic/thread id within a supergroup to post into (Telegram message_thread_id). Provide a positive integer.',
    },
    plainText: {
      type: 'boolean',
      optional: true,
      label: 'Send as plain text',
      description: 'Send messages as plain text instead of HTML formatted.',
    },
  },
};
