/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Whether a user may attach a notification channel to one of their jobs.
 *
 * Deliberately separate from {@link canEditChannel}: being allowed to send through somebody's
 * Telegram bot is not the same as being allowed to read its token.
 *
 * @param {{id: string, isAdmin?: boolean}|null|undefined} user
 * @param {{userId?: string, visibility?: string}|null|undefined} channel
 * @returns {boolean}
 */
export function canUseChannel(user, channel) {
  if (user == null || channel == null) return false;
  if (user.isAdmin === true) return true;
  if (user.id != null && channel.userId === user.id) return true;
  // 'everyone' must match VISIBILITY.EVERYONE in configuredAdapterStorage.js; literal here keeps this module free of the storage layer.
  return channel.visibility === 'everyone';
}

/**
 * Whether a user may see a channel in the notification-channel manager (the list, and the
 * single-channel read behind it).
 *
 * This is deliberately narrower than {@link canUseChannel}. Mirroring {@link canAccessJob} in
 * `access.js`, admin status is *not* tenant-data visibility: an admin sees a channel only when they
 * own it, when it is shared with everyone, or when it is the admin-targeted share. Being able to
 * *attach* somebody's channel to a job (a job-authoring capability that never surfaces the channel
 * or its credentials to the caller) does not entitle the same caller to browse or read it in the
 * channel manager. Without this split, `isAdmin === true` alone exposed every user's private
 * channels in the list — the tenant-isolation defect this policy closes.
 *
 * @param {{id: string, isAdmin?: boolean}|null|undefined} user
 * @param {{userId?: string, visibility?: string}|null|undefined} channel
 * @returns {boolean}
 */
export function canListChannel(user, channel) {
  if (user == null || channel == null) return false;
  if (user.id != null && channel.userId === user.id) return true;
  // Literals must match VISIBILITY.* in configuredAdapterStorage.js; keeping them inline preserves
  // this module's independence from the storage layer (same convention as canUseChannel).
  if (channel.visibility === 'everyone') return true;
  // The admin-targeted share is visible to admins only; ordinary users never see it.
  return channel.visibility === 'admin' && user.isAdmin === true;
}

/**
 * Whether a user may rename, reconfigure, delete or read the secrets of a channel.
 *
 * Channel ownership is the mutation boundary. Administrator status may make an explicitly shared
 * channel visible or usable, but it never transfers ownership or permits editing credentials.
 *
 * @param {{id: string, isAdmin?: boolean}|null|undefined} user
 * @param {{userId?: string}|null|undefined} channel
 * @returns {boolean}
 */
export function canEditChannel(user, channel) {
  if (user == null || channel == null) return false;
  return user.id != null && channel.userId === user.id;
}
