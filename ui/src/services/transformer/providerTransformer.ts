/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

interface ApplicationPolicy {
  automatic?: string;
}

interface ProviderInput {
  name: string;
  id: string;
  enabled: boolean;
  url: string;
  applicationPolicy?: ApplicationPolicy | null;
}

interface ProviderPayload {
  name: string;
  id: string;
  enabled: boolean;
  url: string;
  applicationPolicy?: { automatic: string };
}

export function transform({ name, id, enabled, url, applicationPolicy }: ProviderInput): ProviderPayload {
  return {
    name,
    id,
    enabled,
    url,
    ...(applicationPolicy?.automatic === 'enabled' || applicationPolicy?.automatic === 'disabled'
      ? { applicationPolicy: { automatic: applicationPolicy.automatic } }
      : {}),
  };
}
