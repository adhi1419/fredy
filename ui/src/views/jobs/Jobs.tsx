/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useTranslation } from '../../services/i18n/i18n.jsx';
import SavedSearchesIndex from './SavedSearchesIndex';
import './Jobs.less';

export default function Jobs() {
  const t = useTranslation();

  return (
    <div className="jobs">
      <header className="jobs__heading">
        <div className="jobs__headingCopy">
          <p className="jobs__eyebrow">{t('jobs.index.eyebrow')}</p>
          <h1>{t('jobs.index.heading')}</h1>
          <p className="jobs__description">{t('jobs.index.description')}</p>
        </div>
      </header>
      <SavedSearchesIndex />
    </div>
  );
}
