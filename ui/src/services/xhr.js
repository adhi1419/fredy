/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { authenticatedFetch } from './authenticatedFetch.js';

/**
 * post something to our backend.
 * @param {string} url
 * @param {unknown} data
 * @param {string} [contentType]
 * @param {boolean} [isJson]
 * @returns {Promise<{status:number,json:Object}>}
 */
export function xhrPost(url, data, contentType = 'application/json; charset=utf-8', isJson = true) {
  return executePostOrPutCall(url, contentType, data, isJson, true);
}

/**
 * put request to backend.
 * @param {string} url
 * @param {unknown} data
 * @param {string} [contentType]
 * @param {boolean} [isJson]
 * @returns {Promise<{status:number,json:Object}>}
 */
export function xhrPut(url, data, contentType = 'application/json; charset=utf-8', isJson = true) {
  return executePostOrPutCall(url, contentType, data, isJson, false);
}

async function executePostOrPutCall(url, contentType, data, isJson, isPost) {
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
 * @param {string} url
 * @param {string} [contentType]
 * @param {boolean} [isJson]
 * @returns {Promise<{status:number,json:Object}|Response>}
 */
export async function xhrGet(url, contentType = 'application/json; charset=utf-8', isJson = true) {
  const response = await authenticatedFetch(url, {
    mode: 'cors',
    headers: { 'Content-Type': contentType },
  });
  return isJson ? parseJSON(response) : response;
}

/**
 * delete request to backend.
 * @param {string} url
 * @param {unknown} data
 * @param {string} [contentType]
 * @returns {Promise<{status:number,json:Object}>}
 */
export async function xhrDelete(url, data, contentType = 'application/json; charset=utf-8') {
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
 * @param {unknown} rejection
 * @param {string} fallback
 * @returns {string}
 */
export function errorMessage(rejection, fallback) {
  const json = rejection?.json;
  const message = json?.error ?? json?.message;
  return typeof message === 'string' && message.length > 0 ? message : fallback;
}

function parseJSON(response) {
  return new Promise((resolve, reject) =>
    response
      .text()
      .then((text) => {
        const json = text != null && text.length > 0 ? JSON.parse(text) : {};
        if (response.ok) {
          resolve({ status: response.status, json });
        } else {
          if (
            (response.status === 401 || (response.status === 403 && json?.reason === 'not allowed')) &&
            typeof window !== 'undefined'
          ) {
            window.dispatchEvent(new CustomEvent('fredy:unauthorized'));
          }
          reject({ status: response.status, json });
        }
      })
      .catch(() => reject('Error while trying to parse json.')),
  );
}
