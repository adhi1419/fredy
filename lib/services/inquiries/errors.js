/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * A provider rejected an inquiry, or its delivery result cannot be determined safely.
 */
export class InquiryDeliveryError extends Error {
  /**
   * @param {string} message
   * @param {{outcome?: 'failed'|'unknown', status?: number|null, missingFields?: string[], cause?: unknown}} [details]
   */
  constructor(message, { outcome = 'failed', status = null, missingFields = [], cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'InquiryDeliveryError';
    this.outcome = outcome;
    this.status = status;
    this.missingFields = missingFields;
  }
}
