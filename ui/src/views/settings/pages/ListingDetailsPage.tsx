/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { IconSave } from '@douyinfe/semi-icons';
import { Banner, Button, Checkbox, Select, Toast } from '@douyinfe/semi-ui-19';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { useTranslation } from '../../../services/i18n/i18n.jsx';
import { useActions, useIsLoading, useSelector } from '../../../services/state/store.js';
import type { UserSettingsEffects, UserSettingsRootState } from '../../../services/state/userSettingsState.js';
import { errorMessage } from '../../../services/xhr.js';
import { providerDetailsDraft, providerDetailSettingsChanged } from './personalSettingsDrafts.js';

import './PersonalSettingsPages.less';

interface ProviderMetadata {
  id: string;
  name: string;
}

interface ListingDetailsState extends UserSettingsRootState {
  provider?: readonly ProviderMetadata[];
}

interface ListingDetailsActions {
  userSettings: UserSettingsEffects;
}

export default function ListingDetailsPage(): ReactNode {
  const t = useTranslation();
  const actions = useActions<ListingDetailsActions>();
  const providerDetails = useSelector<ListingDetailsState, readonly string[] | undefined>(
    (state) => state.userSettings.settings.provider_details,
  );
  const blacklistFilter = useSelector<ListingDetailsState, boolean | undefined>(
    (state) => state.userSettings.settings.blacklist_filter_on_provider_details,
  );
  const allProviders = useSelector<ListingDetailsState, readonly ProviderMetadata[] | undefined>(
    (state) => state.provider,
  );
  const savingProviders = useIsLoading(actions.userSettings.setProviderDetails);
  const savingFilter = useIsLoading(actions.userSettings.setBlacklistFilterOnProviderDetails);
  const [selected, setSelected] = useState<string[]>(providerDetailsDraft(providerDetails));
  const [filterEnabled, setFilterEnabled] = useState(blacklistFilter === true);

  useEffect(() => setSelected(providerDetailsDraft(providerDetails)), [providerDetails]);
  useEffect(() => setFilterEnabled(blacklistFilter === true), [blacklistFilter]);

  const dirty = providerDetailSettingsChanged(selected, filterEnabled, providerDetails, blacklistFilter);

  const handleSave = async () => {
    try {
      await actions.userSettings.setProviderDetails(selected);
      await actions.userSettings.setBlacklistFilterOnProviderDetails(filterEnabled);
      Toast.success(t('settings.userSettingsSaved'));
    } catch (error: unknown) {
      Toast.error(errorMessage(error, t('settings.userSettingsSaveError')));
    }
  };

  return (
    <div className="settingsShell__page personalSettingsPage">
      <section className="personalSettingsPage__section" aria-labelledby="listing-details-provider-title">
        <header className="personalSettingsPage__header">
          <h2 id="listing-details-provider-title">{t('settings.providerDetails')}</h2>
          <p>{t('settings.providerDetailsHelp')}</p>
        </header>
        <div className="personalSettingsPage__content">
          <Banner
            type="warning"
            description={t('settings.providerDetailsWarning')}
            closeIcon={null}
            style={{ marginBottom: 12 }}
          />
          <Select
            multiple
            style={{ width: '100%' }}
            value={selected}
            optionList={(allProviders ?? []).map((provider) => ({ label: provider.name, value: provider.id }))}
            placeholder={t('settings.providerDetailsPlaceholder')}
            onChange={(value) =>
              setSelected(
                Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [],
              )
            }
          />
        </div>
      </section>

      <section className="personalSettingsPage__section" aria-labelledby="listing-details-filter-title">
        <header className="personalSettingsPage__header">
          <h2 id="listing-details-filter-title">{t('settings.blacklistFilterOnProviderDetails')}</h2>
          <p>{t('settings.blacklistFilterOnProviderDetailsHelp')}</p>
        </header>
        <div className="personalSettingsPage__content">
          <Checkbox checked={filterEnabled} onChange={(event) => setFilterEnabled(event.target.checked === true)}>
            {t('settings.blacklistFilterOnProviderDetailsEnable')}
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
          loading={savingProviders || savingFilter}
        >
          {t('settings.save')}
        </Button>
      </div>
    </div>
  );
}

ListingDetailsPage.displayName = 'ListingDetailsPage';
