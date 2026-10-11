/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { getGoogleAccessToken } from '../firebaseAdmin.js';

const TABLE_PATTERN = /^[a-z0-9][a-z0-9-]{4,61}[a-z0-9]\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/;

async function billingRequest(url, init = {}) {
  const token = await getGoogleAccessToken();
  const response = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`BigQuery ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.json();
}

function queryParameter(name, timestamp) {
  return { name, parameterType: { type: 'TIMESTAMP' }, parameterValue: { value: new Date(timestamp).toISOString() } };
}

async function waitForQuery(project, response) {
  let body = response;
  for (let attempt = 0; body.jobComplete !== true && attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const jobId = body.jobReference?.jobId;
    if (!jobId) break;
    const url = new URL(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(project)}/queries/${encodeURIComponent(jobId)}`,
    );
    if (body.jobReference?.location) url.searchParams.set('location', body.jobReference.location);
    body = await billingRequest(url);
  }
  return body;
}

/** Read net MTD cost (cost plus credits) from an optional standard Billing Export table. */
export async function loadActualBillingCost(start, end) {
  const table = process.env.GCP_BILLING_EXPORT_TABLE ?? '';
  if (table === '') return { status: 'not-configured', amount: null, runtimeAmount: null, currency: null };
  if (!TABLE_PATTERN.test(table))
    return { status: 'unavailable', reason: 'GCP_BILLING_EXPORT_TABLE is invalid', amount: null };
  const project = table.split('.')[0];
  const query = `
    SELECT
      ANY_VALUE(currency) AS currency,
      SUM(cost + IFNULL((SELECT SUM(credit.amount) FROM UNNEST(credits) AS credit), 0)) AS project_actual,
      SUM(IF(service.description IN ('Cloud Run', 'Cloud Firestore', 'Firestore'),
        cost + IFNULL((SELECT SUM(credit.amount) FROM UNNEST(credits) AS credit), 0), 0)) AS runtime_actual,
      MAX(export_time) AS through_time
    FROM \`${table}\`
    WHERE usage_start_time >= @start AND usage_start_time < @end
      AND export_time >= TIMESTAMP_SUB(@start, INTERVAL 2 DAY)
  `;
  try {
    const body = await waitForQuery(
      project,
      await billingRequest(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(project)}/queries`,
        {
          method: 'POST',
          body: JSON.stringify({
            query,
            useLegacySql: false,
            parameterMode: 'NAMED',
            queryParameters: [queryParameter('start', start), queryParameter('end', end)],
            timeoutMs: 10_000,
            maximumBytesBilled: String(100 * 1024 * 1024),
            ...(process.env.GCP_BILLING_EXPORT_LOCATION ? { location: process.env.GCP_BILLING_EXPORT_LOCATION } : {}),
          }),
        },
      ),
    );
    const fields = body.schema?.fields?.map((field) => field.name) ?? [];
    const values = body.rows?.[0]?.f?.map((field) => field.v) ?? [];
    const row = Object.fromEntries(fields.map((field, index) => [field, values[index]]));
    return {
      status: 'available',
      currency: row.currency ?? null,
      amount: Number(row.project_actual) || 0,
      runtimeAmount: Number(row.runtime_actual) || 0,
      through: row.through_time ? Date.parse(row.through_time) : null,
      bytesProcessed: Number(body.totalBytesProcessed) || 0,
    };
  } catch (error) {
    return {
      status: 'unavailable',
      reason: error instanceof Error ? error.message : 'Billing Export unavailable',
      amount: null,
      runtimeAmount: null,
      currency: null,
    };
  }
}

/** Extend delayed actual project spend to now using its observed MTD rate. */
export function estimateProjectCost(actual, start, end) {
  if (actual?.status !== 'available' || actual.through == null || actual.amount == null) {
    return { status: actual?.status ?? 'unavailable', amount: null, currency: actual?.currency ?? null };
  }
  if (actual.through < start) {
    return {
      status: 'unavailable',
      amount: null,
      currency: actual.currency,
      reason: 'Billing data predates this month',
    };
  }
  const observedMs = Math.max(1, Math.min(end, actual.through) - start);
  const requestedMs = Math.max(1, end - start);
  return {
    status: 'estimated',
    amount: actual.amount * (requestedMs / observedMs),
    currency: actual.currency,
    basedOnActualThrough: actual.through,
  };
}
