/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const packageJson = JSON.parse(read('package.json'));

function workflowJob(workflow, job, nextJob) {
  const start = workflow.indexOf(`  ${job}:\n`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = nextJob == null ? workflow.length : workflow.indexOf(`  ${nextJob}:\n`, start);
  return workflow.slice(start, end);
}

describe('Bun and TypeScript foundation', () => {
  it('pins Bun and frontend tooling exactly', () => {
    expect(read('.bun-version').trim()).toMatch(/^\d+\.\d+\.\d+$/);
    for (const [dependency, version] of Object.entries(packageJson.devDependencies)) {
      expect(version, dependency).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('keeps the typed seam narrow and strict', () => {
    const config = JSON.parse(read('tsconfig.frontend.json'));
    expect(config.compilerOptions.strict).toBe(true);
    expect(config.compilerOptions.noEmit).toBe(true);
    expect(config.compilerOptions.allowJs).toBe(false);
    expect(config.include).toEqual([
      'ui/src/services/apiUrl.ts',
      'ui/src/services/authenticatedTransport.ts',
      'ui/src/services/state/financeState.ts',
      'ui/src/services/state/jobsState.ts',
      'ui/src/services/state/listingsState.ts',
      'ui/src/services/state/notificationState.ts',
      'ui/src/services/state/userSettingsState.ts',
      'ui/src/vite-env.d.ts',
    ]);
    expect(fs.existsSync(path.join(root, 'ui/src/services/apiUrl.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'ui/src/services/apiUrl.js'))).toBe(false);
  });

  it('requires both lockfiles and the executable lock policy guard', () => {
    expect(fs.existsSync(path.join(root, 'bun.lock'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'yarn.lock'))).toBe(true);
    expect(read('bunfig.toml')).toContain('lockfile = true');
    expect(() => execFileSync(process.execPath, ['scripts/check-lockfiles.js'], { cwd: root })).not.toThrow();
  });

  it('uses Bun for frontend CI and Yarn/Node for backend CI', () => {
    const pullRequest = read('.github/workflows/pr.yml');
    const deploy = read('.github/workflows/deploy.yml');
    const frontend = workflowJob(pullRequest, 'frontend', 'backend-tests');
    const backend = workflowJob(pullRequest, 'backend-tests', 'backend-image');
    const pages = workflowJob(deploy, 'pages-build', 'pages-deploy');

    expect(frontend).toContain('oven-sh/setup-bun@v2');
    expect(frontend).toContain('bun-version-file: .bun-version');
    expect(frontend).toContain('bun install --frozen-lockfile --ignore-scripts');
    expect(frontend).toContain('bun run typecheck:frontend');
    expect(frontend).toContain('bun run test:frontend');
    expect(frontend).toContain('bun run build:frontend');
    expect(backend).toContain('actions/setup-node@v5');
    expect(backend).toContain('yarn install --frozen-lockfile --ignore-scripts');
    expect(backend).toContain('npx vitest run --exclude');
    expect(pages).toContain('oven-sh/setup-bun@v2');
    expect(pages).toContain('bun-version-file: .bun-version');
    expect(pages).toContain('bun install --frozen-lockfile --ignore-scripts');
    expect(pages).toContain('bun run build:frontend');
  });
});
