/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { authenticatedFetch } from './authenticatedFetch.js';
import { dispatchHttpUnauthorized } from './authenticatedTransport.js';

/** A parsed backend response: the HTTP status plus the decoded JSON body. */
export interface JsonResponse {
  status: number;
  json: unknown;
}

/**
 * post something to our backend.
 */
export function xhrPost(url: string, data: unknown, contentType?: string, isJson?: true): Promise<JsonResponse>;
export function xhrPost(url: string, data: unknown, contentType: string, isJson: false): Promise<Response>;
export function xhrPost(
  url: string,
  data: unknown,
  contentType = 'application/json; charset=utf-8',
  isJson = true,
): Promise<JsonResponse | Response> {
  return executePostOrPutCall(url, contentType, data, isJson, true);
}

/**
 * put request to backend.
 */
export function xhrPut(url: string, data: unknown, contentType?: string, isJson?: true): Promise<JsonResponse>;
export function xhrPut(url: string, data: unknown, contentType: string, isJson: false): Promise<Response>;
export function xhrPut(
  url: string,
  data: unknown,
  contentType = 'application/json; charset=utf-8',
  isJson = true,
): Promise<JsonResponse | Response> {
  return executePostOrPutCall(url, contentType, data, isJson, false);
}

async function executePostOrPutCall(
  url: string,
  contentType: string,
  data: unknown,
  isJson: boolean,
  isPost: boolean,
): Promise<JsonResponse | Response> {
  const response = await authenticatedFetch(url, {
    method: isPost ? 'POST' : 'PUT',
    cache: 'no-cache',
    mode: 'cors',
    headers: { 'Content-Type': contentType },
    body: data == null ? JSON.stringify({}) : JSON.stringify(data),
  });
  return isJson ? parseJSON(response) : response;
}

/**
 * get request to backend.
 */
export function xhrGet(url: string, contentType?: string, isJson?: true): Promise<JsonResponse>;
export function xhrGet(url: string, contentType: string, isJson: false): Promise<Response>;
export async function xhrGet(
  url: string,
  contentType = 'application/json; charset=utf-8',
  isJson = true,
): Promise<JsonResponse | Response> {
  const response = await authenticatedFetch(url, {
    mode: 'cors',
    headers: { 'Content-Type': contentType },
  });
  return isJson ? parseJSON(response) : response;
}

/**
 * delete request to backend.
 */
export async function xhrDelete(
  url: string,
  data: unknown,
  contentType = 'application/json; charset=utf-8',
): Promise<JsonResponse> {
  const response = await authenticatedFetch(url, {
    method: 'DELETE',
    mode: 'cors',
    body: data == null ? JSON.stringify({}) : JSON.stringify(data),
    headers: { 'Content-Type': contentType },
  });
  return parseJSON(response);
}

/**
 * Pull a human-readable message out of a rejected request.
 */
export function errorMessage(rejection: unknown, fallback: string): string {
  const json = (rejection as { json?: unknown } | null | undefined)?.json as
    { error?: unknown; message?: unknown } | null | undefined;
  const message = json?.error ?? json?.message;
  return typeof message === 'string' && message.length > 0 ? message : fallback;
}

function parseJSON(response: Response): Promise<JsonResponse> {
  return new Promise((resolve, reject) =>
    response
      .text()
      .then((text) => {
        const json: unknown = text != null && text.length > 0 ? JSON.parse(text) : {};
        if (response.ok) {
          resolve({ status: response.status, json });
        } else {
          const reason = (json as { reason?: unknown } | null | undefined)?.reason;
          dispatchHttpUnauthorized(response.status, reason);
          reject({ status: response.status, json });
        }
      })
      .catch(() => reject('Error while trying to parse json.')),
  );
}
