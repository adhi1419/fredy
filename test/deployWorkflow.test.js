/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = fs.readFileSync('.github/workflows/deploy.yml', 'utf8');
const prWorkflow = fs.readFileSync('.github/workflows/pr.yml', 'utf8');

function job(name, next = null) {
  const start = workflow.indexOf(`  ${name}:\n`);
  const end = next == null ? workflow.length : workflow.indexOf(`  ${next}:\n`, start);
  return workflow.slice(start, end);
}

describe('combined deployment workflow', () => {
  it('replaces the standalone Pages workflow', () => {
    expect(workflow).toContain('name: Deploy\n');
    expect(fs.existsSync('.github/workflows/pages.yml')).toBe(false);
  });

  it('uses Bun for Pages and pinned actions on pinned runners', () => {
    expect(workflow).toContain('runs-on: ubuntu-24.04');
    expect(workflow).toContain('actions/checkout@v5');
    expect(workflow).toContain('oven-sh/setup-bun@v2');
    expect(workflow).toContain('google-github-actions/auth@v3');
    expect(workflow).toContain('google-github-actions/deploy-cloudrun@v3');
    expect(workflow).toContain('docker/login-action@v4');
    expect(prWorkflow).toContain('actions/checkout@v5');
    expect(`${workflow}\n${prWorkflow}`).not.toMatch(
      /actions\/checkout@v4|actions\/setup-node@v4|docker\/login-action@v3/,
    );
  });

  it('forces both surfaces on for a manual deployment', () => {
    expect(workflow).toContain(
      "backend: ${{ github.event_name == 'workflow_dispatch' && 'true' || steps.filter.outputs.backend }}",
    );
    expect(workflow).toContain(
      "frontend: ${{ github.event_name == 'workflow_dispatch' && 'true' || steps.filter.outputs.frontend }}",
    );
  });

  it('starts Cloud Run and the Pages build in parallel after detection', () => {
    expect(job('cloud-run', 'pages-build')).toContain('needs: changes');
    expect(job('pages-build', 'pages-deploy')).toContain('needs: changes');
    expect(job('pages-deploy')).toContain('needs: pages-build');
    expect(job('pages-deploy')).not.toContain('needs: cloud-run');
  });

  it('keeps concurrency and credentials isolated by deployment surface', () => {
    const cloudRun = job('cloud-run', 'pages-build');
    const pagesBuild = job('pages-build', 'pages-deploy');
    const pagesDeploy = job('pages-deploy');

    expect(cloudRun).toContain('id-token: write');
    expect(cloudRun).toContain('packages: read');
    expect(cloudRun).toContain('cancel-in-progress: false');
    expect(pagesBuild).toContain('contents: read');
    expect(pagesBuild).not.toContain('id-token: write');
    expect(pagesDeploy).toContain('pages: write');
    expect(pagesDeploy).toContain('id-token: write');
    expect(pagesDeploy).toContain('cancel-in-progress: true');
  });

  it('deploys only for production inputs, not tests or documentation', () => {
    expect(workflow).toContain("- 'lib/**'");
    expect(workflow).toContain("- 'ui/**'");
    expect(workflow).toContain("- 'scripts/backend-image-key.sh'");
    expect(workflow).not.toContain("- 'test/**'");
    expect(workflow).not.toContain("- 'doc/**'");
  });

  it('promotes the exact validated PR image with a cached-build fallback', () => {
    expect(prWorkflow).toContain(
      "push: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository }}",
    );
    expect(prWorkflow).toContain('candidate-${{ steps.context.outputs.hash }}');
    expect(workflow).toContain('candidate-${{ steps.context.outputs.hash }}');
    expect(workflow).toContain('docker buildx imagetools create --tag "$IMAGE" "$CANDIDATE_REF"');
    expect(workflow).toContain("if: steps.promote.outputs.promoted != 'true'");
    expect(workflow).toContain('cache-from: type=registry,ref=${{ env.CACHE_REF }}');
  });

  it('does not install gcloud or submit another Cloud Build', () => {
    expect(workflow).not.toContain('setup-gcloud');
    expect(workflow).not.toContain('gcloud builds submit');
    expect(workflow).not.toContain('deploy-cloud-run.sh');
  });

  it('preserves Cloud Run health verification and Pages publication', () => {
    expect(workflow).toContain('fredy/fredy:${{ github.sha }}');
    expect(workflow).toContain('image: ${{ env.IMAGE }}');
    expect(workflow).toContain('"$SERVICE_URL/health"');
    expect(workflow).toContain('actions/configure-pages@v5');
    expect(workflow).toContain('actions/upload-pages-artifact@v3');
    expect(workflow).toContain('actions/deploy-pages@v4');
    expect(workflow).toContain('run: bun install --frozen-lockfile --ignore-scripts');
    expect(workflow).toContain('run: bun run check:lockfiles');
    expect(workflow).toContain('VITE_API_BASE_URL: ${{ vars.CLOUD_RUN_API_ORIGIN }}');
  });
});
