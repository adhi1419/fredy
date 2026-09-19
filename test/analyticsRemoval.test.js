/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve('.');
const sourceRoots = ['index.js', 'lib', 'ui/src'];
const forbidden = [
  'fredy.orange-coding.net/tracking',
  '/api/tracking',
  'analyticsEnabled',
  'TRACKING_POIS',
  'trackPoi',
];

function sourceFiles(entry) {
  const fullPath = path.join(root, entry);
  if (!fs.existsSync(fullPath)) return [];
  if (fs.statSync(fullPath).isFile()) return [fullPath];
  return fs
    .readdirSync(fullPath, { withFileTypes: true })
    .flatMap((item) => sourceFiles(path.join(entry, item.name)))
    .filter((file) => /\.(?:js|jsx|json)$/.test(file));
}

describe('upstream analytics removal', () => {
  it('ships no analytics sender, consent setting, POI route, or tracking call', () => {
    const files = sourceRoots.flatMap(sourceFiles);
    const matches = files.flatMap((file) => {
      const source = fs.readFileSync(file, 'utf8');
      return forbidden
        .filter((value) => source.includes(value))
        .map((value) => `${path.relative(root, file)}: ${value}`);
    });

    expect(matches).toEqual([]);
  });

  it.each([
    'lib/TRACKING_POIS.js',
    'lib/api/routes/trackingRoute.js',
    'lib/services/crons/tracker-cron.js',
    'lib/services/tracking/Tracker.js',
    'lib/services/tracking/uniqueId.js',
    'ui/src/components/tracking/TrackingModal.jsx',
  ])('does not ship %s', (file) => {
    expect(fs.existsSync(path.join(root, file))).toBe(false);
  });
});
