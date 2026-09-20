/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import type { ReactNode } from 'react';
import './Headline.less';

/**
 * A page heading, optionally with a line of context and a row of actions.
 *
 * `subtitle` is for the standing facts about a page - what it shows, what it leaves out - which
 * used to be written as info Banners. A Banner reads as "something happened just now" and takes a
 * full-width coloured strip to say something that is true every time you open the page; as a quiet
 * line under the title it is read once and then stops competing with the content.
 */
interface HeadlineProps {
  text: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export default function Headline({ text, subtitle, actions }: HeadlineProps) {
  return (
    <div className="page-heading">
      <div className="page-heading__row">
        <div>
          <h1 className="page-heading__title">{text}</h1>
          {subtitle && <p className="page-heading__subtitle">{subtitle}</p>}
        </div>
        {actions && <div>{actions}</div>}
      </div>
      <div className="page-heading__line" />
    </div>
  );
}
