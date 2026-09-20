/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..');
const fixture = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, 'test/contract/fixtures/cloud-run-runtime.json'), 'utf8'),
);

function readContractFile(name) {
  const relativePath = fixture.files[name];
  expect(relativePath, `fixture file mapping for ${name}`).toBeTypeOf('string');
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

function expectAllIncluded(source, values, sourceName) {
  for (const value of values) {
    expect(source, `${sourceName} must preserve ${value}`).toContain(value);
  }
}

describe('Cloud Run runtime contract', () => {
  it('keeps the backend container and CloakBrowser process boundary intact', () => {
    const dockerfile = readContractFile('dockerfile');

    expectAllIncluded(dockerfile, fixture.container.required, 'Dockerfile');
    for (const forbiddenCopy of fixture.container.mustNotCopy) {
      expect(dockerfile, `Dockerfile must not copy frontend content: ${forbiddenCopy}`).not.toContain(forbiddenCopy);
    }
  });

  it('keeps startup validation, PORT precedence, initialization ordering, and API-only routing', () => {
    const startup = readContractFile('startup');
    const api = readContractFile('api');

    expectAllIncluded(startup, fixture.startup.required, 'index.js');
    expectAllIncluded(api, fixture.startup.apiRequired, 'lib/api/api.js');
    expect(startup.indexOf('initJobExecutionService({ providers, intervalMs: INTERVAL });')).toBeLessThan(
      startup.indexOf("await import('./lib/api/api.js');"),
    );
  });

  it('keeps the ADC boundary and external scheduler mode explicit', () => {
    const firestore = readContractFile('firestore');
    const firebaseAdmin = readContractFile('firebaseAdmin');
    const jobs = readContractFile('jobs');
    const trigger = readContractFile('trigger');

    expectAllIncluded(firestore, fixture.adc.firestoreRequired, 'FirestoreConnection.js');
    expectAllIncluded(firebaseAdmin, fixture.adc.firebaseAdminRequired, 'firebaseAdmin.js');
    expectAllIncluded(jobs, fixture.startup.schedulerRequired, 'jobExecutionService.js');
    expectAllIncluded(
      trigger,
      ["request.headers['x-trigger-token']", 'reply.status(404).send({ success: false })'],
      'triggerRoute.js',
    );
  });

  it('keeps the HTTP wire contract linked to the existing Firebase/CORS/SSE fixture', () => {
    const http = readContractFile('http');
    const sse = readContractFile('sse');
    const security = readContractFile('security');
    const wire = JSON.parse(readContractFile('wire'));

    expectAllIncluded(http, ['Access-Control-Allow-Origin', 'Access-Control-Allow-Headers'], 'http.js');
    expectAllIncluded(sse, ['text/event-stream'], 'jobRouter.js');
    expectAllIncluded(security, ['Authorization', 'Bearer ([^\\s]+)', 'invalid authorization'], 'security.js');
    expect(wire.assumptions).toEqual(fixture.wire.requiredAssumptions);
    expect(wire.sse.contentType).toBe(fixture.wire.requiredSse.contentType);
    expect(wire.sse.heartbeatIntervalMs).toBe(fixture.wire.requiredSse.heartbeatIntervalMs);
  });

  it('keeps immutable image promotion, cache fallback, and image-only Cloud Run deployment', () => {
    const workflow = readContractFile('workflow');
    const imageKey = readContractFile('imageKey');

    expectAllIncluded(workflow, fixture.deployment.workflowRequired, 'deploy.yml');
    expectAllIncluded(workflow, fixture.deployment.productionInputs, 'deploy.yml production filters');
    for (const forbiddenPath of fixture.deployment.workflowMustNotContain) {
      expect(workflow, `deploy.yml must not deploy for ${forbiddenPath}`).not.toContain(forbiddenPath);
    }
    expect(imageKey).toContain('git ls-files -s -- Dockerfile package.json yarn.lock index.js lib');
    for (const forbiddenFlag of fixture.deployment.workflowMustNotReplace) {
      expect(workflow, `steady-state workflow must not replace environment with ${forbiddenFlag}`).not.toContain(
        forbiddenFlag,
      );
    }
  });

  it('keeps the one-time bootstrap environment and scheduler boundary explicit', () => {
    const bootstrap = readContractFile('bootstrap');

    expectAllIncluded(bootstrap, fixture.bootstrap.required, 'deploy-cloud-run.sh');
  });

  it('keeps this documentation executable and separates current behavior from future work', () => {
    const document = readContractFile('document');

    expectAllIncluded(document, fixture.documentMarkers, 'cloud-run-runtime.md');
  });

  it('recognizes the dormant Rust health executable without making it deployable', () => {
    const rustSource = readContractFile('rustHealth');
    const workflow = readContractFile('workflow');

    expect(fixture.rustHealth.productionEnabled).toBe(false);
    expect(fixture.rustHealth.nodeRemainsAuthoritative).toBe(true);
    expect(rustSource).toContain('pub const BIND_ADDRESS: &str = "0.0.0.0";');
    expect(rustSource).toContain('pub const DEFAULT_PORT: u16 = 9998;');
    expect(workflow).not.toContain("- 'rust/**'");
    expect(workflow).not.toContain('rust/health-route');
  });

  it('only freezes source paths that the deployment workflow can actually observe', () => {
    const workflow = readContractFile('workflow');

    expect(workflow).not.toContain("- 'test/**'");
    expect(workflow).not.toContain("- 'doc/**'");
    expect(fixture.files.document).toBe('doc/contracts/cloud-run-runtime.md');
  });
});
