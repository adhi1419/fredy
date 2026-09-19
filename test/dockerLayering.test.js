/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const dockerfile = fs.readFileSync('Dockerfile', 'utf8');

describe('backend image layering', () => {
  it('links app code so cached browser layers need no extraction', () => {
    expect(dockerfile).toContain('COPY --link lib ./lib');
    expect(dockerfile).toContain('COPY --link index.js ./');
  });

  it('creates the config symlink before linked copies', () => {
    const symlink = dockerfile.indexOf('ln -s /conf /fredy/conf');
    const appCopy = dockerfile.indexOf('COPY --link lib ./lib');

    expect(symlink).toBeGreaterThan(-1);
    expect(appCopy).toBeGreaterThan(symlink);
  });

  it('runs no filesystem-mutating build step after linked app layers', () => {
    const appCopy = dockerfile.indexOf('COPY --link lib ./lib');
    expect(dockerfile.indexOf('\nRUN ', appCopy)).toBe(-1);
  });
});
