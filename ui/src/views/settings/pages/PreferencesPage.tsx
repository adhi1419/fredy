/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { IconMoon, IconSun } from '@douyinfe/semi-icons';
import { Radio, RadioGroup, Select, Toast } from '@douyinfe/semi-ui-19';
import type { ReactNode } from 'react';

import { useTranslation, availableLanguages } from '../../../services/i18n/i18n.jsx';
import { useActions, useIsLoading, useSelector } from '../../../services/state/store.js';
import type { UserSettingsEffects, UserSettingsRootState } from '../../../services/state/userSettingsState.js';
import { DEFAULT_THEME } from '../../../services/theme/theme.js';
import type { Theme } from '../../../services/theme/theme.js';
import { errorMessage } from '../../../services/xhr.js';

import './PersonalSettingsPages.less';

interface PreferencesActions {
  userSettings: UserSettingsEffects;
}

export default function PreferencesPage(): ReactNode {
  const t = useTranslation();
  const actions = useActions<PreferencesActions>();
  const language = useSelector<UserSettingsRootState, string | undefined>(
    (state) => state.userSettings.settings.language,
  );
  const theme =
    useSelector<UserSettingsRootState, Theme | undefined>((state) => state.userSettings.settings.theme) ??
    DEFAULT_THEME;
  const savingLanguage = useIsLoading(actions.userSettings.setLanguage);
  const savingTheme = useIsLoading(actions.userSettings.setTheme);

  return (
    <div className="settingsShell__page personalSettingsPage">
      <section className="personalSettingsPage__section" aria-labelledby="preferences-theme-title">
        <header className="personalSettingsPage__header">
          <h2 id="preferences-theme-title">{t('settings.theme')}</h2>
          <p>{t('settings.themeHelp')}</p>
        </header>
        <div className="personalSettingsPage__content">
          <RadioGroup
            type="button"
            value={theme}
            onChange={async (event) => {
              const nextTheme = event.target.value;
              if (nextTheme !== 'dark' && nextTheme !== 'light') return;
              try {
                await actions.userSettings.setTheme(nextTheme);
              } catch (error: unknown) {
                Toast.error(errorMessage(error, t('settings.themeSaveError')));
              }
            }}
          >
            <Radio value="dark" disabled={savingTheme}>
              <IconMoon size="small" style={{ marginRight: 6 }} />
              {t('settings.themeDark')}
            </Radio>
            <Radio value="light" disabled={savingTheme}>
              <IconSun size="small" style={{ marginRight: 6 }} />
              {t('settings.themeLight')}
            </Radio>
          </RadioGroup>
        </div>
      </section>

      <section className="personalSettingsPage__section" aria-labelledby="preferences-language-title">
        <header className="personalSettingsPage__header">
          <h2 id="preferences-language-title">{t('settings.language')}</h2>
          <p>{t('settings.languageHelp')}</p>
        </header>
        <div className="personalSettingsPage__content">
          <Select
            style={{ width: 240, maxWidth: '100%' }}
            value={language ?? 'en'}
            disabled={savingLanguage}
            optionList={availableLanguages.map((availableLanguage) => ({
              label: `${availableLanguage.flag} ${availableLanguage.name}`,
              value: availableLanguage.code,
            }))}
            onChange={async (value) => {
              if (typeof value !== 'string') return;
              try {
                await actions.userSettings.setLanguage(value);
              } catch (error: unknown) {
                Toast.error(errorMessage(error, t('settings.languageSaveError')));
              }
            }}
          />
        </div>
      </section>
    </div>
  );
}

PreferencesPage.displayName = 'PreferencesPage';
