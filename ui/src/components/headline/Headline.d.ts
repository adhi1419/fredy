/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import type { ComponentType, ReactNode } from 'react';

interface HeadlineProps {
  text: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

const Headline: ComponentType<HeadlineProps>;
export default Headline;
