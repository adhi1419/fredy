/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import React from 'react';

import { formatEuro } from '../../../components/cards/chartTheme.js';
import { useTranslation, useLocale } from '../../../services/i18n/i18n.jsx';
import type { FinanceResultView } from '../../../types/finance.js';

import './MilestoneTimeline.less';

interface MilestoneTimelineProps {
  /** Output of computeFinanceResult. */
  result?: FinanceResultView | null;
}

interface Milestone {
  key: string;
  year: number | null;
  title: string;
  detail: string;
  note: string;
  tone: 'accent' | 'muted' | 'warning' | 'success' | 'error';
}

/**
 * The four moments that decide how a purchase actually plays out.
 *
 * These are a genuine sequence with real dates attached, which is why they are drawn as a
 * timeline rather than a list: the gap between buying and clearing the debt is the thing
 * being communicated. The Zinsbindung node carries the Restschuld, because that is the
 * amount that has to be refinanced at unknown future rates.
 */
export default function MilestoneTimeline({ result }: MilestoneTimelineProps) {
  const t = useTranslation();
  const locale = useLocale();

  const milestones = React.useMemo<Milestone[]>(() => {
    if (result == null) {
      return [];
    }
    const startYear = new Date().getFullYear();
    const primary = result.financing.primary;
    const items: Milestone[] = [
      {
        key: 'purchase',
        year: startYear,
        title: t('finance.timeline.purchase'),
        detail: formatEuro(result.financing.totalCost, locale),
        note: t('finance.timeline.purchaseNote'),
        tone: 'accent',
      },
    ];

    if (result.existingDebt?.payoffMonths != null) {
      items.push({
        key: 'consumer-debt',
        year: startYear + Math.ceil(result.existingDebt.payoffMonths / 12),
        title: t('finance.timeline.consumerDebtCleared'),
        detail: formatEuro(result.budget.existingDebtRate, locale),
        note: result.existingDebt.rolledIntoMortgage
          ? t('finance.timeline.consumerDebtRolled')
          : t('finance.timeline.consumerDebtFreed'),
        tone: 'muted',
      });
    }

    if (primary.fixedYears > 0) {
      const restschuld = primary.restschuld ?? 0;
      items.push({
        key: 'zinsbindung',
        year: startYear + primary.fixedYears,
        title: t('finance.timeline.zinsbindungEnds'),
        detail: restschuld > 0 ? formatEuro(restschuld, locale) : t('finance.timeline.nothingLeft'),
        note: restschuld > 0 ? t('finance.timeline.restschuldNote') : t('finance.timeline.paidEarlyNote'),
        tone: restschuld > 0 ? 'warning' : 'success',
      });
    }

    const payoffMonths = primary.payoffMonths;

    if (payoffMonths == null) {
      items.push({
        key: 'never',
        year: null,
        title: t('finance.timeline.neverPaidOff'),
        detail: '-',
        note: t('finance.timeline.neverPaidOffNote'),
        tone: 'error',
      });
    } else {
      const ages = result.debtFreeAges
        .filter((person) => person.ageWhenDebtFree != null)
        .map((person) => `${person.label} ${person.ageWhenDebtFree}`)
        .join(' · ');
      items.push({
        key: 'debt-free',
        year: startYear + Math.ceil(payoffMonths / 12),
        title: t('finance.timeline.debtFree'),
        detail: ages || '-',
        note: t('finance.timeline.debtFreeNote'),
        tone: 'success',
      });
    }

    return items;
  }, [result, t, locale]);

  if (milestones.length === 0) {
    return <div className="chartCard__no__data">{t('finance.chart.noData')}</div>;
  }

  return (
    <ol className="milestoneTimeline">
      {milestones.map((milestone) => (
        <li key={milestone.key} className={`milestoneTimeline__item milestoneTimeline__item--${milestone.tone}`}>
          <div className="milestoneTimeline__marker" aria-hidden="true" />
          <div className="milestoneTimeline__body">
            <span className="milestoneTimeline__year">{milestone.year ?? '-'}</span>
            <span className="milestoneTimeline__title">{milestone.title}</span>
            <span className="milestoneTimeline__detail">{milestone.detail}</span>
            <span className="milestoneTimeline__note">{milestone.note}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

MilestoneTimeline.displayName = 'MilestoneTimeline';
