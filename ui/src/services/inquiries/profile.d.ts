/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/* Copyright (c) 2026 by Christian Kellner. */

export interface InquirySendEligibility {
  providerSupported: boolean;
  profileReady: boolean;
  messageReady: boolean;
  statusAllowsSend: boolean;
  canRetry: boolean;
  canSend: boolean;
}

export function isInquiryProviderSupported(providerId?: string, listing?: unknown): boolean;
export function inquiryProviderRequiresMessage(providerId?: string, listing?: unknown): boolean;
export function getInquirySendEligibility(input?: {
  providerId?: string;
  listing?: unknown;
  profile?: unknown;
  message?: unknown;
  status?: unknown;
}): InquirySendEligibility;
export function isInquiryContactProfileReady(
  profile: Record<string, unknown> | null | undefined,
  providerId?: string,
): boolean;
