/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Who may act on what.
 *
 * The same rule - owner or someone the job was explicitly shared with - is used by product
 * routes and storage queries. Admin status is intentionally not part of tenant-data access: it
 * grants operational access only, while ownership and explicit sharing decide product visibility.
 *
 * The SQL predicates in `listingsStorage`/`jobStorage` express the same rule set-wise, for queries
 * that filter rather than decide. {@link SHARED_WITH_USER_SQL} is that predicate, so at least the
 * wording lives in one place.
 */

/**
 * SQL fragment matching jobs a user owns or that were shared with them.
 *
 * Expects the jobs table aliased as `j` and a bound `@userId` parameter.
 * @type {string}
 */
export const SHARED_WITH_USER_SQL =
  '(j.user_id = @userId OR EXISTS (SELECT 1 FROM json_each(j.shared_with_user) AS sw WHERE sw.value = @userId))';

/**
 * Whether a user may see a job.
 *
 * Read access: the owner, anyone the job is shared with, and admins.
 *
 * @param {{id: string, isAdmin?: boolean}|null|undefined} user
 * @param {{userId?: string, shared_with_user?: string[]}|null|undefined} job
 * @returns {boolean}
 */
export function canAccessJob(user, job) {
  if (user == null || job == null) return false;
  // Both ids are optional in this signature, and `undefined === undefined` is true: without this
  // guard a user object with no id would come out as the owner of a job with no owner. Neither
  // shape reaches here today - `getUser` always returns an id and `jobs.user_id` is NOT NULL - but
  // the predicate is public and callers pass partial objects.
  if (user.id == null) return false;
  if (job.userId === user.id) return true;
  return Array.isArray(job.shared_with_user) && job.shared_with_user.includes(user.id);
}

/**
 * Read access is owner or explicit share. Modification is narrower: only the owner may change or
 * delete the search itself, regardless of whether the caller is an admin.
 *
 * @param {{id: string, isAdmin?: boolean}|null|undefined} user
 * @param {{userId?: string}|null|undefined} job
 * @returns {boolean}
 */
export function canModifyJob(user, job) {
  if (user == null || job == null) return false;
  return user.id != null && job.userId === user.id;
}
