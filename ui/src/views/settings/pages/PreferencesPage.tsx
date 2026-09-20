/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { IconMoon, IconSave, IconSun } from '@douyinfe/semi-icons';
import { Button, Checkbox, Radio, RadioGroup, Select, Toast, Typography } from '@douyinfe/semi-ui-19';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { useTranslation, availableLanguages } from '../../../services/i18n/i18n.jsx';
import { useActions, useIsLoading, useSelector } from '../../../services/state/store.js';
import type {
  ListingDeletionPreference,
  UserSettingsEffects,
  UserSettingsRootState,
} from '../../../services/state/userSettingsState.js';
import { DEFAULT_THEME } from '../../../services/theme/theme.js';
import type { Theme } from '../../../services/theme/theme.js';
import { errorMessage } from '../../../services/xhr.js';
import { listingDeletionDraft, listingDeletionDraftChanged } from './personalSettingsDrafts.js';

import './PersonalSettingsPages.less';

const { Text } = Typography;

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
  const storedDeletion = useSelector<UserSettingsRootState, ListingDeletionPreference | undefined>(
    (state) => state.userSettings.settings.listing_deletion_preference,
  );
  const savingLanguage = useIsLoading(actions.userSettings.setLanguage);
  const savingTheme = useIsLoading(actions.userSettings.setTheme);
  const savingDeletion = useIsLoading(actions.userSettings.setListingDeletionPreference);
  const initialDeletion = listingDeletionDraft(storedDeletion);
  const [hardDelete, setHardDelete] = useState(initialDeletion.hardDelete);
  const [skipPrompt, setSkipPrompt] = useState(initialDeletion.skipPrompt);

  useEffect(() => {
    const next = listingDeletionDraft(storedDeletion);
    setHardDelete(next.hardDelete);
    setSkipPrompt(next.skipPrompt);
  }, [storedDeletion]);

  const deletionDraft = { hardDelete, skipPrompt };
  const dirty = listingDeletionDraftChanged(deletionDraft, storedDeletion);

  const handleSave = async () => {
    try {
      await actions.userSettings.setListingDeletionPreference(deletionDraft);
      Toast.success(t('settings.userSettingsSaved'));
    } catch (error: unknown) {
      Toast.error(errorMessage(error, t('settings.userSettingsSaveError')));
    }
  };

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

      <section className="personalSettingsPage__section" aria-labelledby="preferences-deletion-title">
        <header className="personalSettingsPage__header">
          <h2 id="preferences-deletion-title">{t('settings.listingDeletion')}</h2>
          <p>{t('settings.listingDeletionHelp')}</p>
        </header>
        <div className="personalSettingsPage__content">
          <RadioGroup
            value={hardDelete ? 'hard' : 'soft'}
            onChange={(event) => setHardDelete(event.target.value === 'hard')}
          >
            <Radio value="soft">
              <div>
                <Text strong>{t('settings.listingDeletionSoftLabel')}</Text>
                <br />
                <Text type="secondary">{t('settings.listingDeletionSoftDesc')}</Text>
              </div>
            </Radio>
            <Radio value="hard">
              <div>
                <Text strong>{t('settings.listingDeletionHardLabel')}</Text>
                <br />
                <Text type="secondary">
                  {t('settings.listingDeletionHardDesc')}
                  <br />
                  <Text type="warning">{t('settings.listingDeletionHardConsequence')}</Text>
                </Text>
              </div>
            </Radio>
          </RadioGroup>
          <Checkbox
            checked={skipPrompt}
            onChange={(event) => setSkipPrompt(event.target.checked === true)}
            style={{ marginTop: 12 }}
          >
            {t('settings.listingDeletionSkipPrompt')}
          </Checkbox>
        </div>
      </section>

      <div className="personalSettingsPage__saveRow">
        <Button
          icon={<IconSave />}
          theme="solid"
          type="primary"
          onClick={handleSave}
          disabled={!dirty}
          loading={savingDeletion}
        >
          {t('settings.save')}
        </Button>
      </div>
    </div>
  );
}

PreferencesPage.displayName = 'PreferencesPage';
