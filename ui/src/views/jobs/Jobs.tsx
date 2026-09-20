/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useNavigate } from 'react-router';
import { Button } from '@douyinfe/semi-ui-19';
import { IconPlusCircle } from '@douyinfe/semi-icons';
import { useTranslation } from '../../services/i18n/i18n.jsx';
import SavedSearchesIndex from './SavedSearchesIndex';
import './Jobs.less';

export default function Jobs() {
  const t = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="jobs">
      <header className="jobs__heading">
        <div className="jobs__headingCopy">
          <p className="jobs__eyebrow">{t('jobs.index.eyebrow')}</p>
          <h1>{t('jobs.index.heading')}</h1>
          <p className="jobs__description">{t('jobs.index.description')}</p>
        </div>
        <Button type="primary" theme="solid" icon={<IconPlusCircle />} onClick={() => navigate('/jobs/new')}>
          {t('jobs.newJob')}
        </Button>
      </header>
      <SavedSearchesIndex />
    </div>
  );
}
