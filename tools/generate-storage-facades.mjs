/*
 * Generates backend-selecting facade modules for the storage layer.
 * Run: node tools/generate-storage-facades.mjs
 *
 * Each facade top-level-awaits the backend decision and re-exports every
 * symbol of the chosen implementation under the module's original path, so
 * no consumer import changes.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const MODULES = [
  // [facadePath, sqliteImpl, firestoreImpl]
  ['lib/services/storage/settingsStorage.js', './sqlite/settingsStorage.js', './firestore/settingsStorage.js'],
  ['lib/services/storage/userStorage.js', './sqlite/userStorage.js', './firestore/userStorage.js'],
  ['lib/services/storage/jobStorage.js', './sqlite/jobStorage.js', './firestore/jobStorage.js'],
  [
    'lib/services/storage/configuredAdapterStorage.js',
    './sqlite/configuredAdapterStorage.js',
    './firestore/configuredAdapterStorage.js',
  ],
  ['lib/services/storage/watchListStorage.js', './sqlite/watchListStorage.js', './firestore/watchListStorage.js'],
  ['lib/services/storage/listingsStorage.js', './sqlite/listingsStorage.js', './firestore/listingsStorage.js'],
  ['lib/services/storage/sessionStore.js', './sqlite/sessionStore.js', './firestore/sessionStore.js'],
  [
    'lib/services/storage/backupRestoreService.js',
    './sqlite/backupRestoreService.js',
    './firestore/backupRestoreService.js',
  ],
];

function exportNames(absPath) {
  const src = fs.readFileSync(absPath, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(m[1]);
  }
  // export { A, B as C } (possibly with a from-clause)
  for (const m of src.matchAll(/^export\s*\{([^}]+)\}/gm)) {
    for (const part of m[1].split(',')) {
      const asMatch = part.match(/\bas\s+([A-Za-z_$][\w$]*)\s*$/);
      const name = asMatch ? asMatch[1] : part.trim();
      if (name) names.add(name);
    }
  }
  // export * from './x.js' — resolve recursively
  for (const m of src.matchAll(/^export\s*\*\s*from\s*'([^']+)'/gm)) {
    const target = path.join(path.dirname(absPath), m[1]);
    for (const n of exportNames(target)) names.add(n);
  }
  return [...names];
}

for (const [facade, sqliteRel, firestoreRel] of MODULES) {
  const facadeAbs = path.join(root, facade);
  const dir = path.dirname(facadeAbs);
  const sqliteNames = exportNames(path.join(dir, sqliteRel));
  const fsNames = new Set(exportNames(path.join(dir, firestoreRel)));
  const missing = sqliteNames.filter((n) => !fsNames.has(n));
  if (missing.length) {
    console.error(`FATAL ${facade}: firestore impl missing exports: ${missing.join(', ')}`);
    process.exit(1);
  }

  const resolverRel = path
    .relative(dir, path.join(root, 'lib/services/storage/backendResolver.js'))
    .replace(/^(?!\.)/, './');

  const body = `/*
 * AUTO-GENERATED backend-selecting facade — do not edit by hand.
 * Regenerate with: node tools/generate-storage-facades.mjs
 *
 * Re-exports the ${path.basename(facade, '.js')} implementation for the
 * backend chosen by backendResolver (sqlite | firestore). Consumers keep
 * importing this path; the decision happens once at module load.
 */
import { isFirestore } from '${resolverRel}';

const impl = isFirestore() ? await import('${firestoreRel}') : await import('${sqliteRel}');

export const { ${sqliteNames.join(', ')} } = impl;
`;
  fs.writeFileSync(facadeAbs, body);
  console.log(`generated ${facade} (${sqliteNames.length} exports)`);
}
