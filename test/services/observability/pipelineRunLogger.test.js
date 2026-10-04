/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it } from 'vitest';
import { PIPELINE_RUN_PREFIX, createPipelineRunTrace } from '../../../lib/services/observability/pipelineRunLogger.js';

function clock(...values) {
  let index = 0;
  return () => values[index++];
}

describe('pipelineRunLogger', () => {
  it('emits one summary with per-stage timing and row counts', async () => {
    const lines = [];
    const trace = createPipelineRunTrace({
      jobId: 'job-1',
      providerId: 'deutscheWohnen',
      runType: 'scrape',
      executionId: 'execution-1',
      startedAt: 1234,
      monotonicNow: clock(100, 105, 117.34, 140),
      emit: (line) => lines.push(line),
    });

    const output = await trace.stage('normalize', [{ id: 1 }, { id: 2 }], async (rows) => rows.slice(0, 1));
    const event = trace.finish('completed');

    expect(output).toHaveLength(1);
    expect(event).toEqual({
      event: 'pipeline_run',
      schemaVersion: 1,
      executionId: 'execution-1',
      jobId: 'job-1',
      providerId: 'deutscheWohnen',
      runType: 'scrape',
      startedAt: 1234,
      durationMs: 40,
      outcome: 'completed',
      stages: [
        {
          name: 'normalize',
          durationMs: 12.3,
          outcome: 'completed',
          inputCount: 2,
          outputCount: 1,
        },
      ],
    });
    expect(JSON.parse(lines[0].slice(PIPELINE_RUN_PREFIX.length))).toEqual(event);
  });

  it('records only the error class and never the raw error message or task data', async () => {
    const lines = [];
    const trace = createPipelineRunTrace({
      jobId: 'job-1',
      providerId: 'provider',
      runType: 'repair',
      executionId: 'execution-2',
      monotonicNow: clock(0, 1, 2, 3),
      emit: (line) => lines.push(line),
    });
    const privateMessage = 'Private provider payload';

    await expect(
      trace.stage('query-candidates', { address: 'Private street' }, async () => {
        throw new TypeError(privateMessage);
      }),
    ).rejects.toThrow(privateMessage);
    const event = trace.finish('failed', new TypeError(privateMessage));

    expect(event.stages[0]).toMatchObject({
      name: 'query-candidates',
      durationMs: 1,
      outcome: 'failed',
      errorType: 'TypeError',
    });
    expect(event.errorType).toBe('TypeError');
    expect(JSON.stringify(event)).not.toMatch(/Private|street|payload/);
    expect(lines).toHaveLength(1);
  });

  it('finishes each stage and run at most once', () => {
    const lines = [];
    const trace = createPipelineRunTrace({
      jobId: 'job-1',
      providerId: 'provider',
      runType: 'scrape',
      monotonicNow: clock(0, 1, 2, 3, 4),
      emit: (line) => lines.push(line),
    });
    const stage = trace.startStage('store', []);

    stage.finish([]);
    stage.finish([], 'failed', new Error('ignored'));
    expect(trace.finish('completed').stages).toHaveLength(1);
    expect(trace.finish('failed')).toBeNull();
    expect(lines).toHaveLength(1);
  });
});
