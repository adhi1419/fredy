/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it } from 'vitest';
import { resolveApiUrl } from '../../ui/src/services/apiUrl.js';

describe('resolveApiUrl', () => {
  it('keeps local development requests same-origin when no API base is configured', () => {
    expect(resolveApiUrl('/api/jobs', '')).toBe('/api/jobs');
  });

  it('resolves API paths against the Cloud Run origin', () => {
    expect(resolveApiUrl('/api/jobs?active=true', 'https://fredy.example.run.app/')).toBe(
      'https://fredy.example.run.app/api/jobs?active=true',
    );
  });

  it('does not rewrite absolute or protocol-relative URLs', () => {
    expect(resolveApiUrl('https://provider.example/api', 'https://fredy.example.run.app')).toBe(
      'https://provider.example/api',
    );
    expect(resolveApiUrl('//cdn.example/asset.png', 'https://fredy.example.run.app')).toBe('//cdn.example/asset.png');
  });
});
