/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = fs.readFileSync('.github/workflows/pr.yml', 'utf8');

function job(name, next = null) {
  const start = workflow.indexOf(`  ${name}:\n`);
  const end = next == null ? workflow.length : workflow.indexOf(`  ${next}:\n`, start);
  return workflow.slice(start, end);
}

describe('combined pull request workflow', () => {
  it('replaces the standalone source workflow while preserving required job names', () => {
    expect(workflow).toContain('name: Pull Request\n');
    expect(fs.existsSync('.github/workflows/check_source.yml')).toBe(false);
    expect(job('frontend', 'backend-tests')).toContain('name: Check the source code');
    expect(job('gate')).toContain('name: PR Gate');
  });

  it('fans build jobs out together after change detection', () => {
    expect(job('changes', 'frontend')).not.toContain('needs:');
    expect(job('frontend', 'backend-tests')).toContain('needs: changes');
    expect(job('backend-tests', 'backend-image')).toContain('needs: changes');
    expect(job('backend-image', 'gate')).toContain('needs: changes');
  });

  it('runs formatting and lint inside the frontend build job', () => {
    const frontend = job('frontend', 'backend-tests');
    expect(frontend).toContain('yarn install --frozen-lockfile --ignore-scripts');
    expect(frontend).toContain('run: yarn format:check');
    expect(frontend).toContain('run: yarn lint');
    expect(frontend).toContain("if: needs.changes.outputs.frontend == 'true'");
    expect(frontend).toContain('run: npx vitest run test/ui');
    expect(frontend).toContain('run: yarn build:frontend');
  });

  it('forces conditional suites on for manual validation', () => {
    expect(workflow).toContain(
      "frontend: ${{ github.event_name == 'workflow_dispatch' && 'true' || steps.filter.outputs.frontend }}",
    );
    expect(workflow).toContain(
      "backend: ${{ github.event_name == 'workflow_dispatch' && 'true' || steps.filter.outputs.backend }}",
    );
    expect(workflow).toContain("if: github.event_name == 'pull_request'");
  });

  it('retains conditional backend jobs plus the aggregate gate', () => {
    const gate = job('gate');
    expect(workflow).toContain("if: needs.changes.outputs.backend == 'true'");
    expect(gate).toContain('needs: [changes, frontend, backend-tests, backend-image]');
    expect(gate).toContain('FRONTEND_RESULT');
    expect(gate).toContain('BACKEND_IMAGE_RESULT');
  });
});
