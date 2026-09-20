/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useState, useEffect } from 'react';
import { Modal, Radio, RadioGroup, Typography, Checkbox } from '@douyinfe/semi-ui-19';
import { useTranslation } from '../services/i18n/i18n.jsx';

const { Text } = Typography;

type DeleteType = 'soft' | 'hard';

interface ListingDeletionModalProps {
  visible: boolean;
  onConfirm: (hardDelete: boolean, remember?: boolean) => void | Promise<void>;
  onCancel: () => void;
  title?: string;
  showOptions?: boolean;
  message?: string;
  defaultDeleteType?: DeleteType;
}

const ListingDeletionModal = ({
  visible,
  onConfirm,
  onCancel,
  title,
  showOptions = true,
  message,
  defaultDeleteType = 'soft',
}: ListingDeletionModalProps) => {
  const t = useTranslation();
  const resolvedTitle = title ?? t('listing.deletion.title');
  const resolvedMessage = message ?? t('listing.deletion.message');
  const [deleteType, setDeleteType] = useState<DeleteType>('soft');
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    if (visible) {
      setDeleteType(defaultDeleteType);
      setRemember(false);
    }
  }, [visible, defaultDeleteType]);

  const handleOk = () => {
    if (showOptions) {
      onConfirm(deleteType === 'hard', remember);
    } else {
      onConfirm(true);
    }
  };

  return (
    <Modal
      title={resolvedTitle}
      visible={visible}
      onOk={handleOk}
      onCancel={onCancel}
      okText={t('listing.deletion.confirm')}
      cancelText={t('listing.deletion.cancel')}
      style={{ maxWidth: '500px' }}
    >
      <div style={{ marginBottom: 16 }}>
        <Text>{resolvedMessage}</Text>
      </div>
      {showOptions && (
        <>
          <RadioGroup
            value={deleteType}
            onChange={(e) => setDeleteType(e.target.value as DeleteType)}
            style={{ width: '100%' }}
          >
            <Radio value="soft" style={{ alignItems: 'flex-start', width: '100%' }}>
              <div style={{ marginLeft: 8 }}>
                <Text strong>{t('listing.deletion.softLabel')}</Text>
                <br />
                <Text type="secondary">{t('listing.deletion.softDescription')}</Text>
              </div>
            </Radio>
            <Radio value="hard" style={{ marginTop: 16, alignItems: 'flex-start', width: '100%' }}>
              <div style={{ marginLeft: 8 }}>
                <Text strong>{t('listing.deletion.hardLabel')}</Text>
                <br />
                <Text type="secondary">
                  {t('listing.deletion.hardDescription')}
                  <br />
                  <Text type="warning">{t('listing.deletion.hardConsequence')}</Text>
                </Text>
              </div>
            </Radio>
          </RadioGroup>
          <Checkbox
            checked={remember}
            onChange={(e) => setRemember(e.target.checked ?? false)}
            style={{ marginTop: 16 }}
          >
            {t('listing.deletion.rememberChoice')}
          </Checkbox>
        </>
      )}
    </Modal>
  );
};

export default ListingDeletionModal;
