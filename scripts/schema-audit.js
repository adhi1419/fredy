/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Read-only Firestore schema audit. For every top-level collection it prints which fields occur,
 * in how many documents, and with which value types, and flags a field that is not present on
 * every document. It never prints a field VALUE, so it is safe to run against production.
 *
 * Usage (production needs Application Default Credentials):
 *   FIRESTORE_PROJECT_ID=<project> node scripts/schema-audit.js
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8144 node scripts/schema-audit.js
 *
 * Reads one document per document in the database, so on a large instance it costs that many
 * Firestore reads.
 */

import FirestoreConnection from '../lib/services/storage/firestore/FirestoreConnection.js';

/**
 * Firestore-ish type name of a JavaScript value read through the Admin SDK.
 * @param {unknown} value
 * @returns {string}
 */
export function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'timestamp';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'double';
  if (typeof value === 'object') return value.constructor?.name === 'Timestamp' ? 'timestamp' : 'map';
  return typeof value;
}

/**
 * Field presence and types for a list of documents' data.
 * @param {Array<Record<string, unknown>>} docs
 * @returns {{count: number, fields: Record<string, Record<string, number>>, partial: string[]}}
 */
export function auditDocuments(docs) {
  /** @type {Record<string, Record<string, number>>} */
  const fields = {};
  const seen = {};
  for (const data of docs) {
    for (const [key, value] of Object.entries(data ?? {})) {
      const type = valueType(value);
      fields[key] ??= {};
      fields[key][type] = (fields[key][type] ?? 0) + 1;
      seen[key] = (seen[key] ?? 0) + 1;
    }
  }
  const partial = Object.keys(seen)
    .filter((key) => seen[key] !== docs.length)
    .sort();
  return { count: docs.length, fields, partial };
}

async function main() {
  await FirestoreConnection.init();
  const db = FirestoreConnection.getConnection();
  const collections = await db.listCollections();
  for (const collection of collections.sort((a, b) => a.id.localeCompare(b.id))) {
    const snapshot = await collection.get();
    const report = auditDocuments(snapshot.docs.map((doc) => doc.data()));
    const lines = [`\n### ${collection.id} (${report.count} docs)`];
    for (const key of Object.keys(report.fields).sort()) {
      const types = Object.entries(report.fields[key])
        .map(([type, n]) => `${type}:${n}`)
        .join(', ');
      lines.push(`  ${key}: ${types}${report.partial.includes(key) ? '  <-- not on every doc' : ''}`);
    }
    process.stdout.write(`${lines.join('\n')}\n`);
  }
  await FirestoreConnection.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error?.message ?? error);
    process.exitCode = 1;
  });
}
