/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { FieldValue } from '@google-cloud/firestore';
import FirestoreConnection from '../../lib/services/storage/firestore/FirestoreConnection.js';
import { lifecycleFromData } from '../../lib/services/listings/listingLifecycle.js';
import { getProviders } from '../../lib/utils.js';
import { UNSUPPORTED_APPLICATION_CAPABILITIES } from '../../lib/services/providers/capabilities.js';

export const BATCH_LIMIT = 400;
export const DEFAULT_STATE_DIR = path.resolve('scripts/migrations/.state');
export const MIGRATION_COLLECTION = '_migrations';
export const DRY_RUN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const PERMANENT_INQUIRY_VALIDATION_MESSAGES = new Set([
  'The listing does not contain an ImmoScout exposé id.',
  'The Deutsche Wohnen listing id is missing.',
]);

// W1 contract: these are optional listing projections. Missing values are backfilled only; existing
// nulls, false values, zeroes, arrays, and objects are never overwritten.
export const OPTIONAL_LISTING_NULL_FIELDS = Object.freeze([
  'description',
  'address',
  'price',
  'size',
  'rooms',
  'buildYear',
  'energyClass',
  'latitude',
  'longitude',
  'distances',
  'notes',
  'inquiryMessage',
  'inquirySendStatus',
  'inquirySendStartedAt',
  'inquirySentAt',
  'inquiryRequestId',
  'inquirySendError',
  'lastCheckedAt',
  'lastPriceCheckAt',
  'previousPrice',
  'travelTimesAt',
  'inactiveSince',
  'connectivity',
  'connectivityMaxDown',
  'connectivityFiber',
  'connectivityMobileBits',
  'connectivityCheckedAt',
  'notifiedAt',
]);
export const LISTING_COUNTER_DEFAULTS = Object.freeze({
  activeCheckFailures: 0,
  travelTimeFailures: 0,
});
export const LISTING_BOOLEAN_DEFAULTS = Object.freeze({ notificationComplete: false });

const stableValue = (value) => {
  if (value === undefined) return null;
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value.toMillis === 'function') return value.toMillis();
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
};

export function planHash(operations) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(stableValue(operations)))
    .digest('hex');
}

function operation(collection, id, fields = {}, deleteFields = []) {
  return {
    collection,
    id,
    kind: 'update',
    fields: stableValue(fields),
    deleteFields: [...deleteFields].sort(),
  };
}

function deletion(collection, id) {
  return { collection, id, kind: 'delete' };
}

async function allDocs(db, collection) {
  return (await db.collection(collection).get()).docs;
}

async function pendingMarker(db, id) {
  return db.collection(MIGRATION_COLLECTION).doc(id).get();
}

async function plan001(db) {
  const operations = [];
  for (const doc of await allDocs(db, 'listings')) {
    const data = doc.data();
    if (data.inquirySendStatus === 'failed' && PERMANENT_INQUIRY_VALIDATION_MESSAGES.has(data.inquirySendError)) {
      operations.push(operation('listings', doc.id, { inquirySendStatus: 'rejected' }));
    }
  }
  return operations;
}

/**
 * Frozen copy of the pre-migration legacy `status` reading. The application code no longer knows
 * this shape, so the migration carries its own copy and stays correct after the shim is gone.
 */
const LEGACY_STATUS_TO_LIFECYCLE = Object.freeze({ applied: 'applied', accepted: 'archived', rejected: 'archived' });

function readLegacyStatus(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function lifecycleFromLegacyData(data = {}) {
  const legacy = readLegacyStatus(data.status);
  const state = LEGACY_STATUS_TO_LIFECYCLE[legacy?.status];
  if (state == null) return lifecycleFromData(data);
  const setAt = Number.isFinite(legacy?.setAt) ? legacy.setAt : null;
  return {
    state,
    source: 'legacy-status',
    changedAt: setAt,
    changedBy: null,
    appliedAt: state === 'applied' ? setAt : null,
    viewedAt: null,
  };
}

async function plan002(db) {
  const operations = [];
  for (const doc of await allDocs(db, 'listings')) {
    const data = doc.data();
    const fields = {};
    if (!Object.prototype.hasOwnProperty.call(data, 'lifecycle')) fields.lifecycle = lifecycleFromLegacyData(data);
    const deleteFields = Object.prototype.hasOwnProperty.call(data, 'status') ? ['status'] : [];
    if (Object.keys(fields).length || deleteFields.length)
      operations.push(operation('listings', doc.id, fields, deleteFields));
  }
  return operations;
}

function hasOwn(value, key) {
  return value != null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key);
}

function normalizePolicyForMigration(input, capability, legacyAutoSendInquiry) {
  const policy = input && typeof input === 'object' ? input : {};
  const explicit = hasOwn(policy, 'automatic');
  const requested =
    policy.automatic === 'enabled' || policy.automatic === true
      ? 'enabled'
      : policy.automatic === 'disabled' || policy.automatic === false || !explicit
        ? 'disabled'
        : 'disabled';
  if (explicit && requested === 'enabled' && capability?.automatic !== true) {
    throw new Error('Automatic application is not supported by the selected provider.');
  }
  const effective =
    typeof legacyAutoSendInquiry === 'boolean' ? (legacyAutoSendInquiry ? 'enabled' : 'disabled') : requested;
  return { automatic: effective === 'enabled' && capability?.automatic === true ? 'enabled' : 'disabled' };
}

async function migrationCapabilities() {
  const providers = await getProviders();
  return new Map(
    providers.map((provider) => [
      provider.metaInformation?.id,
      provider.metaInformation?.capabilities?.application ?? UNSUPPORTED_APPLICATION_CAPABILITIES,
    ]),
  );
}

async function normalizeProvidersForMigration(sources, legacyAutoSendInquiry, capabilities) {
  if (!Array.isArray(sources)) return [];
  return sources.map((source) => {
    const value = source && typeof source === 'object' ? source : {};
    const capability = capabilities.get(value.id) ?? UNSUPPORTED_APPLICATION_CAPABILITIES;
    const normalized = Object.fromEntries(
      ['id', 'name', 'url', 'enabled'].filter((field) => hasOwn(value, field)).map((field) => [field, value[field]]),
    );
    const result = normalizePolicyForMigration(value.applicationPolicy, capability, legacyAutoSendInquiry);
    // The migration's output must be fully explicit and must not retain the compatibility input.
    normalized.applicationPolicy = { automatic: result.automatic };
    return normalized;
  });
}

async function plan003(db) {
  const capabilities = await migrationCapabilities();
  const operations = [];
  for (const doc of await allDocs(db, 'jobs')) {
    const data = doc.data();
    const legacy =
      hasOwn(data, 'autoSendInquiry') && typeof data.autoSendInquiry === 'boolean' ? data.autoSendInquiry : null;
    const provider = Array.isArray(data.provider) ? data.provider : [];
    const normalized = await normalizeProvidersForMigration(provider, legacy, capabilities);
    if (
      !Array.isArray(data.provider) ||
      JSON.stringify(stableValue(data.provider)) !== JSON.stringify(stableValue(normalized))
    ) {
      operations.push(
        operation('jobs', doc.id, { provider: normalized }, hasOwn(data, 'autoSendInquiry') ? ['autoSendInquiry'] : []),
      );
    } else if (hasOwn(data, 'autoSendInquiry')) {
      operations.push(operation('jobs', doc.id, {}, ['autoSendInquiry']));
    }
  }
  return operations;
}

async function plan004(db) {
  const operations = [];
  for (const doc of await allDocs(db, 'sessions')) operations.push(deletion('sessions', doc.id));
  for (const doc of await allDocs(db, 'users')) {
    const data = doc.data();
    const deleteFields = ['password', 'mcpToken'].filter((field) => hasOwn(data, field));
    if (deleteFields.length) operations.push(operation('users', doc.id, {}, deleteFields));
  }
  return operations;
}

async function plan005(db) {
  const operations = [];
  for (const doc of await allDocs(db, 'listings')) {
    const data = doc.data();
    const fields = {};
    for (const field of OPTIONAL_LISTING_NULL_FIELDS) if (!hasOwn(data, field)) fields[field] = null;
    for (const [field, value] of Object.entries(LISTING_COUNTER_DEFAULTS))
      if (!hasOwn(data, field)) fields[field] = value;
    for (const [field, value] of Object.entries(LISTING_BOOLEAN_DEFAULTS))
      if (!hasOwn(data, field)) fields[field] = value;
    if (Object.keys(fields).length) operations.push(operation('listings', doc.id, fields));
  }
  return operations;
}

export const MIGRATIONS = Object.freeze([
  {
    id: '001-inquiry-rejected',
    description: 'Classify permanent pre-side-effect inquiry validation failures as rejected.',
    plan: plan001,
  },
  {
    id: '002-lifecycle-backfill',
    description: 'Backfill canonical lifecycle and remove legacy status.',
    plan: plan002,
  },
  {
    id: '003-application-policy',
    description: 'Materialize provider policies and remove autoSendInquiry.',
    plan: plan003,
  },
  { id: '004-dead-data', description: 'Delete sessions and obsolete user credentials.', plan: plan004 },
  { id: '005-explicit-nulls', description: 'Backfill missing optional listing fields and counters.', plan: plan005 },
]);

function summarize(id, operations) {
  const byCollection = new Map();
  for (const op of operations) {
    const entry = byCollection.get(op.collection) ?? { count: 0, samples: [] };
    entry.count += 1;
    if (entry.samples.length < 5) entry.samples.push(op.id);
    byCollection.set(op.collection, entry);
  }
  return { id, planHash: planHash(operations), changes: Object.fromEntries(byCollection) };
}

async function readDryRunRecords(stateDir) {
  try {
    return JSON.parse(await fs.readFile(path.join(stateDir, 'dry-runs.json'), 'utf8'));
  } catch {
    return [];
  }
}

async function writeDryRunRecord(stateDir, summary, operations) {
  await fs.mkdir(stateDir, { recursive: true });
  const records = await readDryRunRecords(stateDir);
  const next = records.filter((record) => record.planHash !== summary.planHash);
  next.push({ ...summary, createdAt: Date.now(), operations });
  await fs.writeFile(path.join(stateDir, 'dry-runs.json'), `${JSON.stringify(next, null, 2)}\n`);
}

async function applyOperations(db, operations) {
  for (let offset = 0; offset < operations.length; offset += BATCH_LIMIT) {
    const batch = db.batch();
    for (const op of operations.slice(offset, offset + BATCH_LIMIT)) {
      const ref = db.collection(op.collection).doc(op.id);
      if (op.kind === 'delete') batch.delete(ref);
      else {
        const fields = { ...(op.fields ?? {}) };
        for (const field of op.deleteFields ?? []) fields[field] = FieldValue.delete();
        batch.update(ref, fields);
      }
    }
    if (operations.length) await batch.commit();
  }
}

async function recordApplied(db, migration, hash) {
  await db.collection(MIGRATION_COLLECTION).doc(migration.id).set({
    id: migration.id,
    planHash: hash,
    appliedAt: Date.now(),
  });
}

export async function runMigrations({
  apply = false,
  only = null,
  planHash: requestedHash = null,
  stateDir = DEFAULT_STATE_DIR,
  db = null,
  now = Date.now(),
} = {}) {
  if (!db) {
    await FirestoreConnection.init();
    db = FirestoreConnection.getConnection();
  }
  const selected = only ? MIGRATIONS.filter((migration) => migration.id === only) : MIGRATIONS;
  if (selected.length === 0) throw new Error(`Unknown migration: ${only}`);
  const results = [];
  for (const migration of selected) {
    const marker = await pendingMarker(db, migration.id);
    if (marker.exists) {
      results.push({ id: migration.id, skipped: true, reason: 'already applied' });
      continue;
    }
    const operations = await migration.plan(db);
    const summary = summarize(migration.id, operations);
    if (!apply) {
      await writeDryRunRecord(stateDir, summary, operations);
      results.push({ ...summary, applied: false });
      continue;
    }
    if (!requestedHash) throw new Error(`--apply requires --plan-hash for ${migration.id}`);
    const records = await readDryRunRecords(stateDir);
    const record = records.find((entry) => entry.id === migration.id && entry.planHash === requestedHash);
    if (!record || now - record.createdAt > DRY_RUN_MAX_AGE_MS) {
      throw new Error(`No matching dry-run planHash from the last 24 hours for ${migration.id}`);
    }
    if (summary.planHash !== requestedHash)
      throw new Error(`Plan changed since dry-run for ${migration.id}; run dry-run again`);
    await applyOperations(db, operations);
    await recordApplied(db, migration, requestedHash);
    results.push({ ...summary, applied: true });
  }
  return results;
}

function parseArgs(argv) {
  const args = { apply: false, only: null, planHash: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--only') args.only = argv[++i];
    else if (arg === '--planHash' || arg === '--plan-hash') args.planHash = argv[++i];
    else if (arg.startsWith('--planHash=') || arg.startsWith('--plan-hash='))
      args.planHash = arg.slice(arg.indexOf('=') + 1);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const results = await runMigrations(parseArgs(process.argv.slice(2)));
    // eslint-disable-next-line no-console -- CLI output
    for (const result of results) console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await FirestoreConnection.close();
  }
}
