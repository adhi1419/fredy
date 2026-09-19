/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = fs.readFileSync('.github/workflows/deploy.yml', 'utf8');
const prWorkflow = fs.readFileSync('.github/workflows/pr.yml', 'utf8');

describe('fast Cloud Run deployment workflow', () => {
  it('uses Node 24-compatible actions on a pinned runner', () => {
    expect(workflow).toContain('runs-on: ubuntu-24.04');
    expect(workflow).toContain('actions/checkout@v5');
    expect(workflow).toContain('google-github-actions/auth@v3');
    expect(workflow).toContain('google-github-actions/deploy-cloudrun@v3');
    expect(workflow).toContain('docker/login-action@v4');
    expect(prWorkflow).toContain('actions/checkout@v5');
    expect(prWorkflow).toContain('actions/setup-node@v5');
    expect(prWorkflow).toContain('docker/login-action@v4');
    expect(`${workflow}\n${prWorkflow}`).not.toMatch(
      /actions\/checkout@v4|actions\/setup-node@v4|docker\/login-action@v3/,
    );
  });

  it('builds on the GitHub runner from the shared cross-PR cache', () => {
    expect(workflow).toContain('docker/build-push-action@v7');
    expect(workflow).toContain('push: true');
    expect(workflow).toContain('cache-from: type=registry,ref=${{ env.CACHE_REF }}');
    expect(workflow).toContain('ghcr.io/${{ github.repository }}:buildcache');
  });

  it('promotes the exact validated PR image with a cached-build fallback', () => {
    expect(prWorkflow).toContain('push: ${{ github.event.pull_request.head.repo.full_name == github.repository }}');
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

  it('deploys an immutable image and verifies the service health', () => {
    expect(workflow).toContain('fredy/fredy:${{ github.sha }}');
    expect(workflow).toContain('image: ${{ env.IMAGE }}');
    expect(workflow).toContain('"$SERVICE_URL/health"');
  });
});
