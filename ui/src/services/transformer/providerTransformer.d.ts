/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

interface ProviderTransformerApplicationPolicy {
  automatic?: 'enabled' | 'disabled';
}

interface ProviderTransformerSource {
  name?: string;
  id?: string;
  enabled?: boolean;
  url?: string;
  applicationPolicy?: ProviderTransformerApplicationPolicy;
}

export function transform(source: ProviderTransformerSource): ProviderTransformerSource;
