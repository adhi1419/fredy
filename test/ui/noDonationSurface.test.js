/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const uiSrc = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../ui/src');

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.jsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('in-app donation surface', () => {
  it('has no runtime entry point or donation-only source references', () => {
    const navigation = fs.readFileSync(path.join(uiSrc, 'components/navigation/Navigation.jsx'), 'utf-8');
    expect(navigation).not.toMatch(/Donate|donate/);

    const donationDirectory = path.join(uiSrc, 'components/donate');
    expect(fs.existsSync(donationDirectory)).toBe(false);

    const references = sourceFiles(uiSrc).flatMap((file) => {
      const source = fs.readFileSync(file, 'utf-8');
      return source.match(/donate\./gi) ? [path.relative(uiSrc, file)] : [];
    });
    expect(references).toEqual([]);
  });
});
