/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Select, Typography } from '@douyinfe/semi-ui-19';

import { SegmentPart } from '../../../components/segment/SegmentPart.jsx';
import { FieldLabel, NumberField } from './ProfileForm.jsx';
import { formatEuro } from '../../../components/cards/chartTheme.js';
import { BUNDESLAENDER, GRUNDERWERBSTEUER } from '../../../services/finance/constants.js';
import { useTranslation, useLocale } from '../../../services/i18n/i18n.jsx';
import type { ClosingCostsView, FinancingParams } from '../../../types/finance.js';

import './FinanceForms.less';

const { Text } = Typography;

/** Look up a Bundesland's default transfer-tax rate; unknown codes contribute nothing. */
const transferTaxFor = (code: string): number => (GRUNDERWERBSTEUER as Record<string, number>)[code] ?? 0;

interface PropertyFormProps {
  financing: FinancingParams;
  /** Closing-cost breakdown for the current draft, from the server. */
  costs: ClosingCostsView | null;
  /** Purchase price plus closing costs. */
  totalCost: number | null;
  /** What has to be borrowed after equity. */
  loanAmount: number | null;
  /** Shallow-merged into profile.financing. */
  onChange: (patch: Partial<FinancingParams>) => void;
}

/**
 * The property itself: price, equity, and the Kaufnebenkosten that come with it.
 *
 * The cost breakdown updates as you type, because the gap between the asking price and what
 * you actually have to fund is the thing most buyers underestimate.
 */
export default function PropertyForm({ financing, costs, totalCost, loanAmount, onChange }: PropertyFormProps) {
  const t = useTranslation();
  const locale = useLocale();

  // The Kaufnebenkosten and the loan they imply are computed server-side and handed in with the
  // draft's calculation. Deriving them here meant a second copy of the Grunderwerbsteuer rules.
  // Until the first answer arrives there is nothing to show, which is a blank breakdown rather
  // than a wrong one.
  const total = totalCost ?? 0;
  const loan = loanAmount ?? 0;

  return (
    <SegmentPart name={t('finance.form.propertyTitle')} helpText={t('finance.form.propertyHelp')}>
      <div className="financeForm__grid">
        <NumberField
          label={t('finance.form.purchasePrice')}
          value={financing.purchasePrice}
          step={5000}
          suffix="€"
          help={t('finance.form.purchasePriceHelp')}
          onChange={(purchasePrice) => onChange({ purchasePrice: purchasePrice ?? 0 })}
        />
        <NumberField
          label={t('finance.form.equity')}
          value={financing.equity}
          step={5000}
          suffix="€"
          help={t('finance.form.equityHelp')}
          onChange={(equity) => onChange({ equity: equity ?? 0 })}
        />
      </div>

      <div className="financeForm__grid">
        <label className="financeField">
          <FieldLabel label={t('finance.form.bundesland')} help={t('finance.form.bundeslandHelp')} />
          <Select
            className="financeField__input"
            value={financing.bundesland}
            onChange={(bundesland) =>
              // Switching state resets the manual override, so the new state's rate takes
              // effect instead of silently keeping the old one.
              onChange({ bundesland: String(bundesland), grunderwerbsteuerPct: transferTaxFor(String(bundesland)) })
            }
          >
            {BUNDESLAENDER.map((land) => (
              <Select.Option key={land.code} value={land.code}>
                {land.name} · {transferTaxFor(land.code)} %
              </Select.Option>
            ))}
          </Select>
        </label>

        <NumberField
          label={t('finance.form.grunderwerbsteuer')}
          value={financing.grunderwerbsteuerPct ?? transferTaxFor(financing.bundesland)}
          step={0.1}
          max={100}
          suffix="%"
          help={t('finance.form.grunderwerbsteuerHelp')}
          onChange={(grunderwerbsteuerPct) => onChange({ grunderwerbsteuerPct: grunderwerbsteuerPct ?? 0 })}
        />
        <NumberField
          label={t('finance.form.notary')}
          value={financing.notaryPct}
          step={0.1}
          max={100}
          suffix="%"
          help={t('finance.form.notaryHelp')}
          onChange={(notaryPct) => onChange({ notaryPct: notaryPct ?? 0 })}
        />
        <NumberField
          label={t('finance.form.makler')}
          value={financing.maklerPct}
          step={0.01}
          max={100}
          suffix="%"
          help={t('finance.form.maklerHelp')}
          onChange={(maklerPct) => onChange({ maklerPct: maklerPct ?? 0 })}
        />
      </div>

      <div className="financeForm__readout">
        <div className="financeForm__readout-row">
          <Text type="tertiary" size="small">
            {t('finance.form.closingCostsTotal')}
          </Text>
          <span className="financeForm__readout-value">
            {costs == null ? '-' : `${formatEuro(costs.total, locale)} · ${costs.totalPct.toFixed(2)} %`}
          </span>
        </div>
        <div className="financeForm__readout-row">
          <Text type="tertiary" size="small">
            {t('finance.form.totalCost')}
          </Text>
          <span className="financeForm__readout-value">{formatEuro(total, locale)}</span>
        </div>
        <div className="financeForm__readout-row financeForm__readout-row--emphasis">
          <Text type="tertiary" size="small">
            {t('finance.form.loanAmount')}
          </Text>
          <span className="financeForm__readout-value">{formatEuro(loan, locale)}</span>
        </div>
      </div>
    </SegmentPart>
  );
}

PropertyForm.displayName = 'PropertyForm';
