/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * One income earner in the household. Person B is only counted when `enabled` is true.
 *
 * This file mirrors the JSDoc typedefs that used to live here and in lib/types/. The frontend must
 * not import out of lib/ - that code is server-side and free to grow a Node built-in at any time,
 * which would break the Vite build with an error pointing nowhere near the cause. The lib/ copy
 * stays JSDoc; the shapes are identical.
 */
export interface Person {
  /** Display name, e.g. "Me" / "Partner". */
  label?: string;
  /** Whether this person counts towards the budget. */
  enabled?: boolean;
  /** Current age in years. */
  age: number;
  /** Monthly net income from the main job. */
  primaryIncome: number;
  /** Monthly net income from any other source. */
  secondaryIncome: number;
}

/**
 * One interest-rate scenario to simulate. Percent values are stored as percent
 * (3.8 means 3.8 %), matching what the user types.
 */
export interface RateScenario {
  id: string;
  label: string;
  /** Nominal interest rate (Sollzins) in percent. */
  annualRate: number;
  /** Initial amortization (anfängliche Tilgung) in percent per year. */
  tilgung: number;
  /** Fixed-rate period (Zinsbindung) in years. */
  fixedYears: number;
  /** Explicit instalment in EUR. Overrides `tilgung` when set. */
  monthlyPayment?: number | null;
  /** Extra repayment in EUR applied once a year. */
  sondertilgungPerYear?: number;
}

/** Everything about the property and the loan, as opposed to the household. */
export interface FinancingParams {
  /** Kaufpreis in EUR. */
  purchasePrice: number;
  /** Eigenkapital in EUR. */
  equity: number;
  /** Two-letter code driving the Grunderwerbsteuer default. */
  bundesland: string;
  /** Explicit override in percent. */
  grunderwerbsteuerPct?: number;
  /** Notar + Grundbuch in percent. */
  notaryPct?: number;
  /** Buyer's share of the agent commission in percent. */
  maklerPct?: number;
  /** Below this a listing is treated as a rental. */
  purchasePriceThreshold?: number;
  scenarios: RateScenario[];
}

/** Everything about renting, as opposed to the household or a purchase. */
export interface RentParams {
  /**
   * Surcharge on the quoted cold rent that makes it warm, in percent. `null` when the user left
   * the field blank, in which case the default surcharge applies downstream.
   */
  nebenkostenPct: number | null;
}

/**
 * The persisted per-user profile, stored as the `finance_profile` settings key.
 *
 * The household fields apply to both halves; `renting` and `financing` each apply only to jobs of
 * the matching deal type.
 */
export interface FinanceProfile {
  personA: Person;
  personB?: Person;
  /** Monthly living costs excluding rent. */
  livingCosts: number;
  /** Outstanding consumer debt in EUR. */
  existingDebt?: number;
  /** Monthly instalment on that debt. */
  existingDebtRate?: number;
  /** Interest rate on that debt in percent. */
  existingDebtInterest?: number;
  /** Redirect the consumer-debt instalment into the mortgage once it clears. */
  rollFreedBudgetIntoMortgage?: boolean;
  renting?: RentParams;
  financing: FinancingParams;
}

export interface ScheduleMonth {
  /** 1-based month index. */
  month: number;
  /** Interest paid this month. */
  interest: number;
  /** Principal repaid this month, including any Sondertilgung. */
  principal: number;
  /** Total paid this month. */
  payment: number;
  /** Remaining debt after this month. */
  balance: number;
}

export interface AmortizationSchedule {
  /** The regular instalment. */
  monthlyPayment: number;
  months: ScheduleMonth[];
  /** Months until the debt is cleared; `null` if it never is. */
  payoffMonths: number | null;
  totalInterest: number;
  totalPaid: number;
  /** Remaining debt at the end of the Zinsbindung. */
  restschuld: number | null;
  restschuldAtMonth: number | null;
  /** True when the instalment does not cover the interest. */
  neverPaysOff: boolean;
}

export interface ClosingCosts {
  grunderwerbsteuer: number;
  notar: number;
  makler: number;
  total: number;
  /** Combined rate in percent. */
  totalPct: number;
}

export interface FinancingResult {
  purchasePrice: number;
  equity: number;
  closingCosts: ClosingCosts;
  /** Purchase price plus Kaufnebenkosten. */
  totalCost: number;
  loanAmount: number;
  /** Share of the total cost covered from own funds. */
  equityRatio: number;
  scenarios: Array<
    RateScenario & {
      schedule: AmortizationSchedule;
      monthlyPayment: number;
      payoffMonths: number | null;
      totalInterest: number;
      restschuld: number | null;
      neverPaysOff: boolean;
    }
  >;
  /** The first scenario, used wherever a single answer is needed. */
  primary: unknown;
}

export interface Budget {
  /** Combined monthly net income. */
  netIncome: number;
  livingCosts: number;
  existingDebtRate: number;
  /** What is left after living costs and existing debt. */
  disposable: number;
  /** 35 % of net income. */
  ruleCap: number;
  /** 40 % of net income. */
  stretchCap: number;
  /** `ruleCap` minus existing debt service. */
  headroom: number;
  /** `stretchCap` minus existing debt service. */
  stretchHeadroom: number;
}

export type Verdict = 'affordable' | 'stretch' | 'unaffordable';

export interface ListingAffordability {
  id: string | null;
  title: string | null;
  address: string | null;
  price: number;
  loanAmount: number;
  closingCosts: number;
  monthlyPayment: number;
  payoffMonths: number | null;
  payoffYears: number | null;
  totalInterest: number;
  restschuld: number | null;
  neverPaysOff: boolean;
  rateShareOfNetIncome: number | null;
  verdict: Verdict;
}

/** The cold-rent ceilings a household's budget allows. */
export interface RentThresholds {
  /** Highest cold rent still inside the 35 % rule. */
  affordableMaxRent: number;
  /** Highest cold rent still inside the 40 % stretch bound. */
  stretchMaxRent: number;
  /** The same ceiling expressed as warm rent. */
  warmAffordable: number;
  warmStretch: number;
  /** The surcharge used to convert between the two. */
  nebenkostenPct: number;
}

/** A rental scored against the household budget - the rent counterpart of ListingAffordability. */
export interface RentAffordability {
  id: string | null;
  title: string | null;
  address: string | null;
  dealType: 'rent';
  /** Cold rent as quoted by the provider. */
  price: number;
  coldRent: number;
  warmRent: number;
  nebenkosten: number;
  /** The surcharge used, in percent. */
  nebenkostenPct: number;
  /** What actually leaves the account each month, i.e. the warm rent. */
  monthlyPayment: number;
  /** Disposable income left once the warm rent is paid. */
  remainingAfterRent: number;
  rateShareOfNetIncome: number | null;
  verdict: Verdict;
}

/*
 * View shapes below describe the server calculation payloads (POST /api/finance/calculate,
 * /affordability) as the finance charts and panels actually read them. They are deliberately
 * partial and forgiving: the browser holds no finance math, so these mirror what the server sends
 * rather than re-deriving it. Every field a component dereferences is named here so the components
 * can be strict without `any`.
 */

/** One year of an amortization schedule, as the server rolls the months up. */
export interface ScheduleYear {
  year: number;
  balance: number;
  interest: number;
  principal: number;
}

/** A scenario as the server calculated it, richer than the {@link RateScenario} the user entered. */
export interface ComputedScenario {
  id?: string;
  label?: string;
  annualRate: number;
  tilgung: number;
  fixedYears: number;
  monthlyPayment: number;
  payoffMonths: number | null;
  totalInterest: number;
  restschuld: number | null;
  neverPaysOff: boolean;
  schedule?: {
    months?: unknown[];
    years?: ScheduleYear[];
  };
}

/** The closing-cost breakdown for a draft, computed server-side. */
export interface ClosingCostsView {
  grunderwerbsteuer: number;
  notar: number;
  makler: number;
  total: number;
  totalPct: number;
}

/** The financing half of a calculation result. */
export interface FinancingResultView {
  purchasePrice: number;
  closingCosts: ClosingCostsView;
  totalCost: number;
  loanAmount: number;
  scenarios: ComputedScenario[];
  primary: ComputedScenario;
}

/** The household budget for a draft. */
export interface BudgetView {
  netIncome: number;
  livingCosts: number;
  existingDebtRate: number;
  disposable: number;
  ruleCap: number;
}

/** How much a debt-servicing person has left, and the age they clear it. */
export interface DebtFreeAge {
  label: string;
  ageWhenDebtFree: number | null;
}

/** The full result of a finance calculation, as the panels and charts read it. */
export interface FinanceResultView {
  financing: FinancingResultView;
  budget: BudgetView;
  verdict: Verdict;
  rateShareOfNetIncome: number | null;
  rateAboveCeiling?: boolean;
  recommendation: { recommendedRate: number; maxAffordablePrice: number };
  existingDebt?: { payoffMonths: number | null; rolledIntoMortgage?: boolean } | null;
  debtFreeAges: DebtFreeAge[];
}

/** A scored listing on the affordability scatter/table. */
export interface AffordabilityItem {
  id: string;
  title?: string | null;
  price: number;
  monthlyPayment: number;
  payoffYearsAtBudget?: number | null;
  dealType?: string;
  verdict: Verdict;
}
