/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(here, '../..');
const uiSrc = path.join(projectRoot, 'ui/src');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(js|jsx|json|less)$/.test(entry.name) ? [full] : [];
  });
}

const removedPaths = [
  ['ui', 'src', 'components', 'news'].join('/'),
  ['ui', 'src', 'services', 'news'].join('/'),
  ['ui', 'src', 'assets', 'news'].join('/'),
  ['test', 'ui', ['news', 'Selection'].join('') + '.test.js'].join('/'),
];

const forbiddenNames = [
  ['News', 'Modal'].join(''),
  ['News', 'History'].join(''),
  ['news', 'Content'].join(''),
  ['news', 'Selection'].join(''),
  ['assets', 'news'].join('/'),
  ['news', '_last_seen_version'].join(''),
  ['news', '-last-seen-version'].join(''),
  ['news', '-hash'].join(''),
  ['news', '_hash'].join(''),
  ...['videoFallback', 'sheetTitle', 'sheetDone', 'historyTrigger', 'historyTitle'].map((key) =>
    ['news', key].join('.'),
  ),
];

const runtimeFiles = [
  ...sourceFiles(uiSrc),
  path.join(projectRoot, 'lib/api/routes/userSettingsRoute.js'),
  path.join(projectRoot, 'tools/devMock.js'),
];

const forbiddenReferences = new RegExp(
  forbiddenNames.map((name) => name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')).join('|'),
);

describe("removed What's New surface", () => {
  it('has no bundled payload, runtime entry points, marker API, state action, or locale references', () => {
    expect(removedPaths.filter((relativePath) => fs.existsSync(path.join(projectRoot, relativePath)))).toEqual([]);

    const references = runtimeFiles.flatMap((file) => {
      const source = fs.readFileSync(file, 'utf-8');
      return forbiddenReferences.test(source) ? [path.relative(projectRoot, file)] : [];
    });
    expect(references).toEqual([]);
  });
});
