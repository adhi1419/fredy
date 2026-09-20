/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const uiSrc = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../ui/src');

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry): string[] => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.[jt]sx?$/.test(entry.name) ? [full] : [];
  });
}

describe('in-app donation surface', () => {
  it('has no runtime entry point or donation-only source references', () => {
    const navigation = fs.readFileSync(path.join(uiSrc, 'components/navigation/Navigation.tsx'), 'utf8');
    expect(navigation).not.toMatch(/Donate|donate/);
    expect(fs.existsSync(path.join(uiSrc, 'components/donate'))).toBe(false);

    const references = sourceFiles(uiSrc).flatMap((file): string[] => {
      const source = fs.readFileSync(file, 'utf8');
      return source.match(/donate\./gi) ? [path.relative(uiSrc, file)] : [];
    });
    expect(references).toEqual([]);
  });
});
