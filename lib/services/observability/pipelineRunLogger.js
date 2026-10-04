/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import logger from '../logger.js';

export const PIPELINE_RUN_PREFIX = 'PIPELINE_RUN ';

function rowCount(value) {
  return Array.isArray(value) ? value.length : null;
}

function roundedDuration(started, finished) {
  return Math.max(0, Math.round((finished - started) * 10) / 10);
}

/**
 * Build a run trace that emits one privacy-safe summary after a scrape or repair pass.
 *
 * Stage names, durations, row counts, opaque ids, outcomes, and error class names are the complete
 * contract. Raw inputs, outputs, URLs, listing content, applicant data, and error messages are never
 * retained, so adding timing cannot copy provider or user data into production logs.
 *
 * @param {Object} input
 * @param {string} input.jobId
 * @param {string} input.providerId
 * @param {'job'|'scrape'|'repair'} input.runType
 * @param {string} [input.executionId]
 * @param {number} [input.startedAt]
 * @param {() => number} [input.monotonicNow]
 * @param {(line:string) => void} [input.emit]
 * @returns {Object}
 */
export function createPipelineRunTrace({
  jobId,
  providerId,
  runType,
  executionId = randomUUID(),
  startedAt = Date.now(),
  monotonicNow = () => performance.now(),
  emit = (line) => logger.info(line),
}) {
  const runStarted = monotonicNow();
  const stages = [];
  let finished = false;

  function startStage(name, inputValue) {
    const stageStarted = monotonicNow();
    let stageFinished = false;
    return {
      finish(outputValue, outcome = 'completed', error = null) {
        if (stageFinished) return;
        stageFinished = true;
        const inputCount = rowCount(inputValue);
        const outputCount = rowCount(outputValue);
        stages.push({
          name,
          durationMs: roundedDuration(stageStarted, monotonicNow()),
          outcome,
          ...(inputCount == null ? {} : { inputCount }),
          ...(outputCount == null ? {} : { outputCount }),
          ...(error == null ? {} : { errorType: error?.name ?? 'Error' }),
        });
      },
    };
  }

  async function stage(name, inputValue, task) {
    const timer = startStage(name, inputValue);
    try {
      const output = await task(inputValue);
      timer.finish(output);
      return output;
    } catch (error) {
      timer.finish(null, error?.name === 'NoNewListingsWarning' ? 'no-results' : 'failed', error);
      throw error;
    }
  }

  function finish(outcome, error = null) {
    if (finished) return null;
    finished = true;
    const event = {
      event: 'pipeline_run',
      schemaVersion: 1,
      executionId,
      jobId: String(jobId ?? ''),
      providerId: String(providerId ?? ''),
      runType,
      startedAt,
      durationMs: roundedDuration(runStarted, monotonicNow()),
      outcome,
      stages,
      ...(error == null ? {} : { errorType: error?.name ?? 'Error' }),
    };
    emit(`${PIPELINE_RUN_PREFIX}${JSON.stringify(event)}`);
    return event;
  }

  return { executionId, stage, startStage, finish };
}
