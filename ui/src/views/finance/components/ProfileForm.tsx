/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { InputNumber, Switch, Tooltip, Typography } from '@douyinfe/semi-ui-19';
import { IconHelpCircleStroked } from '@douyinfe/semi-icons';

import { SegmentPart } from '../../../components/segment/SegmentPart.jsx';
import { useTranslation } from '../../../services/i18n/i18n.jsx';
import type { FinanceProfile, Person } from '../../../types/finance.js';

import './FinanceForms.less';

const { Text } = Typography;

interface FieldLabelProps {
  label: string;
  /** Shown on hover. Say what the number is *and* what changes when it moves. */
  help?: string;
}

/**
 * The caption above a field, with the explanation of what the field does hanging off an icon.
 *
 * The help lives in a popover rather than under the input on purpose: every field can carry a
 * sentence or two without the form growing, and - because the text no longer takes vertical
 * space - inputs sitting next to each other stay on one line.
 */
export function FieldLabel({ label, help }: FieldLabelProps) {
  return (
    <span className="financeField__label">
      {label}
      {help && (
        <Tooltip content={help} position="top" showArrow>
          <span className="financeField__help" tabIndex={0} role="note" aria-label={help}>
            <IconHelpCircleStroked size="small" />
          </span>
        </Tooltip>
      )}
    </span>
  );
}

interface NumberFieldProps {
  label: string;
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  suffix?: string;
  /** Explanation shown in the label popover. */
  help?: string;
  min?: number;
  max?: number;
  step?: number;
  /**
   * When true, clearing the field yields `null` rather than 0, so a field with a meaningful
   * default can tell "left blank" from "deliberately zero".
   */
  allowEmpty?: boolean;
  /** Shown while the field is empty, e.g. the default that applies. */
  placeholder?: string;
  /** Fired when the field loses focus, for save-on-blur. */
  onBlur?: () => void;
}

/**
 * A labelled numeric field. Every input on this page is a number, so this keeps the forms
 * from becoming a wall of repeated markup.
 */
export function NumberField({
  label,
  value,
  onChange,
  suffix,
  help,
  min = 0,
  max,
  step = 1,
  allowEmpty = false,
  placeholder,
  onBlur,
}: NumberFieldProps) {
  return (
    <label className="financeField">
      <FieldLabel label={label} help={help} />
      <InputNumber
        className="financeField__input"
        value={value ?? ''}
        min={min}
        max={max}
        step={step}
        hideButtons
        placeholder={placeholder}
        suffix={suffix ? <span className="financeField__suffix">{suffix}</span> : undefined}
        onBlur={onBlur}
        onChange={(next) => {
          const isBlank = next === '' || next == null;
          if (isBlank) {
            onChange(allowEmpty ? null : 0);
            return;
          }
          onChange(Number.isFinite(Number(next)) ? Number(next) : allowEmpty ? null : 0);
        }}
      />
    </label>
  );
}

interface ProfileFormProps {
  profile: FinanceProfile;
  /** Shallow-merged into the profile. */
  onChange: (patch: Partial<FinanceProfile>) => void;
}

/**
 * Income, age and living costs for one or two people, plus any debt already being serviced.
 */
export default function ProfileForm({ profile, onChange }: ProfileFormProps) {
  const t = useTranslation();

  const setPerson = (key: 'personA' | 'personB', patch: Partial<Person>) =>
    onChange({ [key]: { ...profile[key], ...patch } });

  return (
    <>
      <SegmentPart name={t('finance.form.householdTitle')} helpText={t('finance.form.householdHelp')}>
        <div className="financeForm__person">
          <Text strong className="financeForm__person-title">
            {t('finance.form.personA')}
          </Text>
          <div className="financeForm__grid">
            <NumberField
              label={t('finance.form.age')}
              value={profile.personA.age}
              min={16}
              max={99}
              help={t('finance.form.ageHelp')}
              onChange={(age) => setPerson('personA', { age: age ?? 0 })}
            />
            <NumberField
              label={t('finance.form.primaryIncome')}
              value={profile.personA.primaryIncome}
              step={50}
              suffix="€"
              help={t('finance.form.primaryIncomeHelp')}
              onChange={(primaryIncome) => setPerson('personA', { primaryIncome: primaryIncome ?? 0 })}
            />
            <NumberField
              label={t('finance.form.secondaryIncome')}
              value={profile.personA.secondaryIncome}
              step={50}
              suffix="€"
              help={t('finance.form.secondaryIncomeHelp')}
              onChange={(secondaryIncome) => setPerson('personA', { secondaryIncome: secondaryIncome ?? 0 })}
            />
          </div>
        </div>

        <div className="financeForm__person">
          <div className="financeForm__person-header">
            <Text strong className="financeForm__person-title">
              {t('finance.form.personB')}
            </Text>
            <Switch
              size="small"
              checked={profile.personB?.enabled === true}
              aria-label={t('finance.form.addPartner')}
              onChange={(enabled) => setPerson('personB', { enabled })}
            />
          </div>
          {profile.personB?.enabled ? (
            <div className="financeForm__grid">
              <NumberField
                label={t('finance.form.age')}
                value={profile.personB.age}
                min={16}
                max={99}
                help={t('finance.form.ageHelp')}
                onChange={(age) => setPerson('personB', { age: age ?? 0 })}
              />
              <NumberField
                label={t('finance.form.primaryIncome')}
                value={profile.personB.primaryIncome}
                step={50}
                suffix="€"
                help={t('finance.form.primaryIncomeHelp')}
                onChange={(primaryIncome) => setPerson('personB', { primaryIncome: primaryIncome ?? 0 })}
              />
              <NumberField
                label={t('finance.form.secondaryIncome')}
                value={profile.personB.secondaryIncome}
                step={50}
                suffix="€"
                help={t('finance.form.secondaryIncomeHelp')}
                onChange={(secondaryIncome) => setPerson('personB', { secondaryIncome: secondaryIncome ?? 0 })}
              />
            </div>
          ) : (
            <Text type="tertiary" size="small">
              {t('finance.form.addPartnerHint')}
            </Text>
          )}
        </div>
      </SegmentPart>

      <SegmentPart name={t('finance.form.outgoingsTitle')} helpText={t('finance.form.outgoingsHelp')}>
        <div className="financeForm__grid">
          <NumberField
            label={t('finance.form.livingCosts')}
            value={profile.livingCosts}
            step={50}
            suffix="€"
            help={t('finance.form.livingCostsHelp')}
            onChange={(livingCosts) => onChange({ livingCosts: livingCosts ?? 0 })}
          />
        </div>
      </SegmentPart>

      <SegmentPart name={t('finance.form.existingDebtTitle')} helpText={t('finance.form.existingDebtHelp')}>
        <div className="financeForm__grid">
          <NumberField
            label={t('finance.form.existingDebt')}
            value={profile.existingDebt}
            step={500}
            suffix="€"
            help={t('finance.form.existingDebtAmountHelp')}
            onChange={(existingDebt) => onChange({ existingDebt: existingDebt ?? 0 })}
          />
          <NumberField
            label={t('finance.form.existingDebtRate')}
            value={profile.existingDebtRate}
            step={25}
            suffix="€"
            help={t('finance.form.existingDebtRateHelp')}
            onChange={(existingDebtRate) => onChange({ existingDebtRate: existingDebtRate ?? 0 })}
          />
          <NumberField
            label={t('finance.form.existingDebtInterest')}
            value={profile.existingDebtInterest}
            step={0.1}
            max={100}
            suffix="%"
            help={t('finance.form.existingDebtInterestHelp')}
            onChange={(existingDebtInterest) => onChange({ existingDebtInterest: existingDebtInterest ?? 0 })}
          />
        </div>
        {(profile.existingDebt ?? 0) > 0 && (profile.existingDebtRate ?? 0) > 0 && (
          <label className="financeForm__toggle">
            <Switch
              size="small"
              checked={profile.rollFreedBudgetIntoMortgage === true}
              onChange={(rollFreedBudgetIntoMortgage) => onChange({ rollFreedBudgetIntoMortgage })}
            />
            <span>
              <span className="financeForm__toggle-label">{t('finance.form.rollOver')}</span>
              <span className="financeForm__toggle-hint">{t('finance.form.rollOverHint')}</span>
            </span>
          </label>
        )}
      </SegmentPart>
    </>
  );
}

ProfileForm.displayName = 'ProfileForm';
