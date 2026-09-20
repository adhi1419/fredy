/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import './FredyFooter.less';
import { Layout } from '@douyinfe/semi-ui-19';
import { useTranslation } from '../../services/i18n/i18n.jsx';

export default function FredyFooter() {
  const t = useTranslation();
  const { Footer } = Layout;

  return (
    <Footer className="fredyFooter">
      <span className="fredyFooter__credit">
        <a href="https://github.com/orangecoding/fredy" target="_blank" rel="noreferrer">
          {t('footer.poweredByJobEngine')}
        </a>{' '}
        · {t('footer.originalProjectBy')}{' '}
        <a href="https://github.com/orangecoding" target="_blank" rel="noreferrer">
          Christian Kellner
        </a>
      </span>
    </Footer>
  );
}
