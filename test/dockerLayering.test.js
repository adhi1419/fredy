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

  it('cleans the yarn cache in the same layer that fills it', () => {
    // A later RUN cannot shrink an earlier layer; cleaning one step late shipped ~1.5 GB of
    // tarballs in every image.
    const install = dockerfile
      .split('\nRUN ')
      .find((step) => step.startsWith('yarn ') && step.includes('yarn install'));
    expect(install).toContain('yarn cache clean');
  });

  it('trims unused Chromium locales and chromedriver in the download layer', () => {
    const download = dockerfile
      .split('\nRUN ')
      .find((step) => step.startsWith('node ') && step.includes('ensureBinary'));
    expect(download).toContain("-type f ! -name 'de.pak' ! -name 'en-US.pak' -delete");
    expect(download).toContain('-name chromedriver');
  });
});
