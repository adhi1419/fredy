/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useState, useEffect } from 'react';
import type { ReactElement } from 'react';

import { Banner, Modal, Select, Input } from '@douyinfe/semi-ui-19';
import { IconExternalOpen } from '@douyinfe/semi-icons';
import { transform } from '../../../../../services/transformer/providerTransformer';
import { useSelector } from '../../../../../services/state/store';
import { resolveProviderSource } from '../../../../../services/jobs/guidedSearchForm.js';
import type { GuidedProviderSource, ProviderMetadata } from '../../../../../services/jobs/guidedSearchForm.js';
import { getSafeHttpUrl, validateProviderUrl } from '../../../../../services/jobs/providerUrl.js';
import { labelWithFlags } from '../../../../../services/countryFlags.js';
import { sortProviders } from '../../../../../services/providerOrder.js';

import './ProviderMutator.less';
import { useScreenWidth } from '../../../../../hooks/screenWidth.js';
import { useTranslation } from '../../../../../services/i18n/i18n.jsx';

/** The data handed back when an existing provider row is edited. */
interface ProviderEditData {
  newData: GuidedProviderSource;
  oldProviderToEdit: GuidedProviderSource;
}

interface ProviderMutatorProps {
  onVisibilityChanged: (visible: boolean) => void;
  visible?: boolean;
  onData: (data: GuidedProviderSource) => void;
  onEditData: (data: ProviderEditData) => void;
  providerToEdit?: GuidedProviderSource | null;
}

/** The store slice this dialog reads: the provider catalogue. `countries` is mutable here so the
 *  list satisfies both `sortProviders` and the resolver, which each read it. */
interface ProviderChoice extends ProviderMetadata {
  countries?: string[];
}

interface ProviderMutatorState {
  provider: ProviderChoice[];
}

const returnOriginalSelectedProvider = (
  providerToEdit: GuidedProviderSource,
  provider: readonly ProviderMetadata[],
): ProviderMetadata | null => {
  return resolveProviderSource(providerToEdit, provider).provider;
};

export default function ProviderMutator({
  onVisibilityChanged,
  visible = false,
  onData,
  onEditData,
  providerToEdit,
}: ProviderMutatorProps): ReactElement {
  const t = useTranslation();
  const provider = useSelector<ProviderMutatorState, ProviderChoice[]>((state) => state.provider);
  const [selectedProvider, setSelectedProvider] = useState<ProviderMetadata | null>(null);
  const [providerUrl, setProviderUrl] = useState('');
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  useEffect(() => {
    // The message is cleared along with the fields. It used to be left behind, so tripping the
    // error once meant a stale red banner greeted the next "Add new Provider".
    setValidationMessage(null);
    if (providerToEdit) {
      setSelectedProvider(returnOriginalSelectedProvider(providerToEdit, provider));
      setProviderUrl(providerToEdit.url ?? '');
    } else {
      setSelectedProvider(null);
      setProviderUrl('');
    }
  }, [providerToEdit, visible, provider]);

  const width = useScreenWidth();
  const isMobile = width <= 850;
  const selectedProviderUrl = getSafeHttpUrl(selectedProvider?.baseUrl);

  /**
   * Why the pasted URL cannot be used, in words the user can act on.
   */
  const validate = (): string | null => {
    const { ok, problem, expectedHost } = validateProviderUrl(providerUrl, selectedProvider);
    if (ok) {
      return null;
    }
    switch (problem) {
      case 'bareHost':
        return t('provider.validationBareHost', { host: expectedHost ?? '' });
      case 'wrongHost':
        return t('provider.validationWrongHost', { host: expectedHost ?? '' });
      case 'unparsable':
        return t('provider.validationUnparsable');
      default:
        return t('provider.validationSelectAndUrl');
    }
  };

  const onSubmit = (doStore: boolean) => {
    if (doStore) {
      const validationResult = validate();
      if (validationResult == null) {
        if (providerToEdit != null && selectedProvider != null) {
          onEditData({
            // `transform` types `applicationPolicy.automatic` as `string`, but it only ever emits
            // 'enabled' | 'disabled' (it drops any other value), so the result is a valid source.
            newData: transform({
              url: providerUrl,
              id: selectedProvider.id ?? '',
              name: selectedProvider.name ?? '',
              // A provider being edited keeps whatever enabled state it had; a fresh one added
              // through this dialog is enabled, which is also the downstream default.
              enabled: providerToEdit.enabled ?? true,
              applicationPolicy: providerToEdit.applicationPolicy,
            }) as GuidedProviderSource,
            oldProviderToEdit: providerToEdit,
          });
        } else if (selectedProvider != null) {
          onData(
            transform({
              url: providerUrl,
              id: selectedProvider.id ?? '',
              name: selectedProvider.name ?? '',
              enabled: true,
            }) as GuidedProviderSource,
          );
        }
        setProviderUrl('');
        setSelectedProvider(null);
        setValidationMessage(null);
        onVisibilityChanged(false);
      } else {
        setValidationMessage(validationResult);
      }
    } else {
      setProviderUrl('');
      setSelectedProvider(null);
      setValidationMessage(null);
      onVisibilityChanged(false);
    }
  };

  return (
    <Modal
      title={providerToEdit ? t('provider.editTitle') : t('provider.defaultTitle')}
      visible={visible}
      onOk={() => onSubmit(true)}
      onCancel={() => onSubmit(false)}
      // Three short lines and two fields do not need half a screen. It was 50rem, which left the
      // controls stranded in the left third of an otherwise empty dialog.
      style={{ width: isMobile ? '95%' : '34rem' }}
      okText={t('provider.save')}
    >
      {validationMessage != null && (
        <Banner
          fullMode={false}
          type="danger"
          closeIcon={null}
          title={
            <div style={{ fontWeight: 600, fontSize: '14px', lineHeight: '20px' }}>{t('provider.errorTitle')}</div>
          }
          style={{ marginBottom: '1rem' }}
          description={validationMessage}
        />
      )}
      {providerToEdit != null ? (
        <p>{t('provider.editDescription', { name: providerToEdit.name ?? '' })}</p>
      ) : (
        // Three numbered steps, where there used to be the same instruction written out three
        // times: once as the section's help text, and twice more as paragraphs here.
        <ol className="providerMutator__steps">
          <li>{t('provider.step1')}</li>
          <li>{t('provider.step2')}</li>
          <li>{t('provider.step3')}</li>
        </ol>
      )}
      <Select
        filter
        placeholder={t('provider.selectPlaceholder')}
        className="providerMutator__fields"
        disabled={providerToEdit != null}
        // Sorted by country and then by size, rather than by name: somebody searching in Vienna
        // should not have to read past every German portal, and the one most people want should not
        // sit halfway down the list because of its initial.
        optionList={sortProviders(provider).map((pro) => {
          return {
            otherKey: pro.id,
            value: pro.id,
            // The flags come from what the provider declared it covers, so a portal serving two
            // countries shows both. Only the label carries them - the name stored on the job stays
            // the plain one.
            label: labelWithFlags(pro),
          };
        })}
        style={{ width: '100%' }}
        value={selectedProvider == null ? '' : selectedProvider.id}
        onChange={(value) => {
          setSelectedProvider(provider.find((pro) => pro.id === value) ?? null);
          setValidationMessage(null);
        }}
      />

      {/* A link the user clicks, rather than a window.open() fired from the Select's onChange. That
          opened a tab before they had read a word of the instructions, opened a second one if they
          changed their mind about the portal, and was swallowed without a trace by a popup
          blocker. */}
      {selectedProvider != null && selectedProviderUrl != null && (
        <a className="providerMutator__openLink" href={selectedProviderUrl} target="_blank" rel="noreferrer noopener">
          <IconExternalOpen />
          {t('provider.openInNewTab', { name: selectedProvider.name ?? '' })}
        </a>
      )}

      <Input
        type="text"
        placeholder={t('provider.urlPlaceholder')}
        width={10}
        className="providerMutator__fields providerMutator__url"
        value={providerUrl}
        onChange={(value) => {
          setProviderUrl(value);
          setValidationMessage(null);
        }}
      />
    </Modal>
  );
}
