/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const packageJson = JSON.parse(read('package.json'));
const exactVersion = /^\d+\.\d+\.\d+$/;
const requiredFiles = ['.bun-version', 'bun.lock', 'yarn.lock', 'bunfig.toml'];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) {
    throw new Error(`Missing required lock/toolchain file: ${file}`);
  }
}

const bunVersion = read('.bun-version').trim();
if (!exactVersion.test(bunVersion)) {
  throw new Error(`.bun-version must contain an exact semver, got: ${bunVersion}`);
}

const manifestSpecs = new Map([
  ...Object.entries(packageJson.dependencies ?? {}),
  ...Object.entries(packageJson.devDependencies ?? {}),
]);
for (const [dependency, version] of Object.entries(packageJson.devDependencies ?? {})) {
  if (!exactVersion.test(version)) {
    throw new Error(`${dependency} must be pinned to an exact version, got: ${version}`);
  }
}

function parseBunRootSpecs(lockfile) {
  const rootStart = lockfile.indexOf('    "": {');
  const rootEnd = lockfile.indexOf('\n  "packages":', rootStart);
  if (rootStart < 0 || rootEnd < 0) throw new Error('bun.lock has no root workspace entry');
  const rootBlock = lockfile.slice(rootStart, rootEnd);
  const specs = new Map();
  for (const match of rootBlock.matchAll(/^[ ]{8}"([^"\n]+)": "([^"\n]+)",?$/gm)) {
    specs.set(match[1], match[2]);
  }
  return specs;
}

const bunSpecs = parseBunRootSpecs(read('bun.lock'));
for (const [dependency, spec] of manifestSpecs) {
  if (bunSpecs.get(dependency) !== spec) {
    throw new Error(`bun.lock is out of sync for ${dependency}: expected ${spec}`);
  }
}
for (const dependency of bunSpecs.keys()) {
  if (!manifestSpecs.has(dependency)) {
    throw new Error(`bun.lock contains an unmanifested root dependency: ${dependency}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const yarnLock = read('yarn.lock');
for (const [dependency, spec] of manifestSpecs) {
  const selector = `${dependency}@${spec}`;
  const selectorPattern = new RegExp(`(?:^|,\\s*)"?${escapeRegExp(selector)}"?\\s*(?:,|:)`, 'm');
  if (!selectorPattern.test(yarnLock)) {
    throw new Error(`yarn.lock is missing the direct selector ${selector}`);
  }
}
