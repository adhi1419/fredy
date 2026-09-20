/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import type { ComponentType } from 'react';
import type { GuidedProviderSource } from '../../../../../services/jobs/guidedSearchForm.js';

type ProviderEditData = { newData: GuidedProviderSource; oldProviderToEdit: GuidedProviderSource };

interface ProviderMutatorProps {
  onVisibilityChanged: (visible: boolean) => void;
  visible?: boolean;
  onData: (data: GuidedProviderSource) => void;
  onEditData: (data: ProviderEditData) => void;
  providerToEdit?: GuidedProviderSource | null;
}

const ProviderMutator: ComponentType<ProviderMutatorProps>;
export default ProviderMutator;
