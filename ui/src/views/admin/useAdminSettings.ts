/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Toast } from '@douyinfe/semi-ui-19';

import { xhrPost, errorMessage } from '../../services/xhr';
import { useTranslation } from '../../services/i18n/i18n.jsx';
import { CONNECTIVITY_SOURCES } from '../../components/connectivity/connectivityFormat.js';

/** A translation lookup, matching the shape returned by {@link useTranslation}. */
type Translate = (key: string, variables?: Record<string, string | number>) => string;

/** The three editable parts of the working-hours window. */
export type WorkingHourEdge = 'from' | 'to' | 'timeZone';

/** The working-hours window as the form edits it. */
export interface WorkingHoursForm {
  from: string | null;
  to: string | null;
  timeZone: string | null;
}

/** The stored admin settings, normalised into the shape the forms edit. */
export interface AdminSettingsForm {
  port: number | string;
  baseUrl: string;
  listingRetentionDays: number | string;
  demoMode: boolean;
  interval: number | string;
  workingHours: WorkingHoursForm;
  proxyUrl: string;
  priceTrackingEnabled: boolean;
  priceCheckIntervalDays: number | string;
  priceCheckLimitPerRun: number | string;
  priceChangeThresholdPercent: number | string;
  connectivityEnabled: boolean;
  connectivitySources: Record<string, boolean>;
  connectivityLimitPerRun: number | string;
  connectivityMaxAgeDays: number | string;
}

/** A value settable through {@link AdminSettingsContext.setField}, one per form key. */
type AdminSettingsFieldValue = AdminSettingsForm[keyof AdminSettingsForm];

/**
 * The shape shared with the admin pages through the router outlet context. Each page reads the
 * subset it owns; the layout provides the whole object.
 */
export interface AdminSettingsContext {
  t: Translate;
  form: AdminSettingsForm;
  setField: (name: keyof AdminSettingsForm, value: AdminSettingsFieldValue) => void;
  setWorkingHour: (edge: WorkingHourEdge, value: string | null) => void;
  systemDirty: boolean;
  executionDirty: boolean;
  connectivityDirty: boolean;
  savingSystem: boolean;
  savingExecution: boolean;
  savingConnectivity: boolean;
  saveSystem: () => Promise<void>;
  saveExecution: () => Promise<void>;
  saveConnectivity: () => Promise<void>;
}

/** The global settings blob the store hands over, read loosely and normalised by {@link toForm}. */
export interface GeneralSettings {
  port?: number | string | null;
  baseUrl?: string | null;
  listingRetentionDays?: number | string | null;
  demoMode?: boolean;
  interval?: number | string | null;
  workingHours?: { from?: string | null; to?: string | null; timeZone?: string | null } | null;
  proxyUrl?: string | null;
  priceTrackingEnabled?: boolean;
  priceCheckIntervalDays?: number | string | null;
  priceCheckLimitPerRun?: number | string | null;
  priceChangeThresholdPercent?: number | string | null;
  connectivityEnabled?: boolean;
  connectivitySources?: Record<string, boolean> | null;
  connectivityLimitPerRun?: number | string | null;
  connectivityMaxAgeDays?: number | string | null;
  [key: string]: unknown;
}

/** The fields the System page owns. */
export const SYSTEM_FIELDS: Array<keyof AdminSettingsForm> = ['port', 'baseUrl', 'listingRetentionDays', 'demoMode'];

/** The fields the Connectivity page owns. */
export const CONNECTIVITY_FIELDS: Array<keyof AdminSettingsForm> = [
  'connectivityEnabled',
  'connectivitySources',
  'connectivityLimitPerRun',
  'connectivityMaxAgeDays',
];

/** The fields the Execution page owns. */
export const EXECUTION_FIELDS: Array<keyof AdminSettingsForm> = [
  'interval',
  'workingHours',
  'proxyUrl',
  'priceTrackingEnabled',
  'priceCheckIntervalDays',
  'priceCheckLimitPerRun',
  'priceChangeThresholdPercent',
];

const nullOrEmpty = (val: unknown): boolean => val == null || String(val).length === 0;

/**
 * The stored settings, normalised into the shape the forms edit.
 *
 * Every field gets a defined value so that "unchanged" can be decided by comparison rather than by
 * tracking which inputs the user has touched.
 *
 * @param settings Global settings from the store.
 */
function toForm(settings: GeneralSettings | null | undefined): AdminSettingsForm {
  return {
    port: settings?.port ?? 9998,
    baseUrl: settings?.baseUrl ?? '',
    listingRetentionDays: settings?.listingRetentionDays ?? 14,
    demoMode: settings?.demoMode === true,
    interval: settings?.interval ?? 60,
    workingHours: {
      from: settings?.workingHours?.from ?? null,
      to: settings?.workingHours?.to ?? null,
      // Empty rather than pre-filled with the browser's zone: an installation that has been
      // running in the server's zone must not have its window quietly moved to the operator's
      // zone the next time they save an unrelated field on this page.
      timeZone: settings?.workingHours?.timeZone ?? null,
    },
    proxyUrl: settings?.proxyUrl ?? '',
    priceTrackingEnabled: settings?.priceTrackingEnabled === true,
    priceCheckIntervalDays: settings?.priceCheckIntervalDays ?? 7,
    priceCheckLimitPerRun: settings?.priceCheckLimitPerRun ?? 100,
    priceChangeThresholdPercent: settings?.priceChangeThresholdPercent ?? 1,
    connectivityEnabled: settings?.connectivityEnabled === true,
    // Every source gets a defined value, so an instance whose stored map predates a source still
    // compares equal until somebody actually changes a switch.
    connectivitySources: Object.fromEntries(
      CONNECTIVITY_SOURCES.map((id) => [id, settings?.connectivitySources?.[id] !== false]),
    ),
    connectivityLimitPerRun: settings?.connectivityLimitPerRun ?? 200,
    connectivityMaxAgeDays: settings?.connectivityMaxAgeDays ?? 180,
  };
}

/**
 * Whether any of `fields` differs between two forms.
 *
 * JSON comparison rather than a deep-equal helper: the non-primitives here are `workingHours` and
 * `connectivitySources`, and `toForm` writes both with their keys in a fixed order. Anything added
 * to either object has to be added there too, or an edit to it will not register as a change.
 */
function differs(a: AdminSettingsForm, b: AdminSettingsForm, fields: Array<keyof AdminSettingsForm>): boolean {
  return fields.some((name) => JSON.stringify(a[name]) !== JSON.stringify(b[name]));
}

/**
 * Operator settings: one form, three pages, one save per page.
 *
 * System and Execution used to be tabs sharing a single Save that posted all fields at once.
 * They are separate routes now, and the backend (`generalSettingsRoute.js`) validates and upserts
 * only the keys a request actually
 * carries, so each page can save its own fields and leave the others' values untouched.
 *
 * The hook lives on the Administration layout rather than on any one page so that switching between
 * them does not throw away unsaved edits.
 *
 * @param settings The global settings from the store.
 * @returns The form, a field setter, per-page dirty flags and per-page save handlers.
 */
export function useAdminSettings(settings: GeneralSettings | null | undefined): AdminSettingsContext {
  const t = useTranslation();

  // The values as stored. Re-derived whenever the store hands over a new object, which happens
  // once the settings request lands - this may well have mounted before that.
  const baseline = useMemo(() => toForm(settings), [settings]);
  const [form, setForm] = useState<AdminSettingsForm>(baseline);
  const [saving, setSaving] = useState<Array<keyof AdminSettingsForm> | null>(null);

  useEffect(() => {
    setForm(baseline);
  }, [baseline]);

  const setField = useCallback((name: keyof AdminSettingsForm, value: AdminSettingsFieldValue) => {
    setForm((previous) => ({ ...previous, [name]: value }));
  }, []);

  const setWorkingHour = useCallback((edge: WorkingHourEdge, value: string | null) => {
    setForm((previous) => ({ ...previous, workingHours: { ...previous.workingHours, [edge]: value } }));
  }, []);

  /**
   * Post one page's fields.
   *
   * @param fields
   * @param validate Returns a message when the values must not be sent.
   * @param reload Whether the page has to come back up on the new configuration.
   */
  const save = useCallback(
    async (fields: Array<keyof AdminSettingsForm>, validate: () => string | null, reload: boolean): Promise<void> => {
      const complaint = validate();
      if (complaint != null) {
        Toast.error(complaint);
        return;
      }

      const payload: Record<string, unknown> = {};
      for (const name of fields) {
        payload[name] = form[name];
      }
      // Numbers arrive from InputNumber as numbers already, but a hand-edited field can leave a
      // string behind, and the backend's bounds checks are stricter than its coercion.
      if (fields.includes('listingRetentionDays')) {
        payload.listingRetentionDays = Number(form.listingRetentionDays);
      }
      if (fields.includes('connectivityLimitPerRun')) {
        payload.connectivityLimitPerRun = Number(form.connectivityLimitPerRun);
        payload.connectivityMaxAgeDays = Number(form.connectivityMaxAgeDays);
      }
      if (fields.includes('priceCheckIntervalDays')) {
        payload.priceCheckIntervalDays = Number(form.priceCheckIntervalDays);
        payload.priceCheckLimitPerRun = Number(form.priceCheckLimitPerRun);
        payload.priceChangeThresholdPercent = Number(form.priceChangeThresholdPercent);
        payload.proxyUrl = form.proxyUrl?.trim() ?? '';
      }

      setSaving(fields);
      try {
        await xhrPost('/api/admin/generalSettings', payload);
      } catch (exception) {
        console.error(exception);
        // The backend returns the concrete reason (e.g. a 403 "Only admins can change these
        // settings."), which errorMessage() reads from whichever key the route used.
        Toast.error(errorMessage(exception, t('settings.toastSaveError')));
        return;
      } finally {
        setSaving(null);
      }

      if (reload) {
        Toast.success(t('settings.toastSavedReloading'));
        setTimeout(() => {
          location.reload();
        }, 3000);
        return;
      }
      Toast.success(t('settings.toastSaved'));
    },
    [form, t],
  );

  const saveSystem = useCallback(
    () =>
      save(
        SYSTEM_FIELDS,
        () => {
          if (nullOrEmpty(form.port)) {
            return t('settings.toastPortEmpty');
          }
          // A cleared field must not be sent: the backend would have to guess, and guessing on a
          // setting that drives an irreversible delete is the wrong default either way.
          if (
            form.listingRetentionDays === '' ||
            form.listingRetentionDays == null ||
            !Number.isInteger(Number(form.listingRetentionDays))
          ) {
            return t('settings.toastListingRetentionInvalid');
          }
          return null;
        },
        // The port only takes effect on the process that reads it at boot, and the browser is
        // talking to that process.
        true,
      ),
    [save, form, t],
  );

  const saveConnectivity = useCallback(
    () =>
      save(
        CONNECTIVITY_FIELDS,
        () => {
          // The same reasoning as the price dials: both numbers decide how much traffic Fredy
          // sends at somebody else's public service, so a cleared field must not be coerced into
          // a value the operator never chose.
          if (
            !Number.isInteger(Number(form.connectivityLimitPerRun)) ||
            Number(form.connectivityLimitPerRun) < 1 ||
            !Number.isInteger(Number(form.connectivityMaxAgeDays)) ||
            Number(form.connectivityMaxAgeDays) < 7
          ) {
            return t('settings.toastConnectivityInvalid');
          }
          return null;
        },
        false,
      ),
    [save, form, t],
  );

  const saveExecution = useCallback(
    () =>
      save(
        EXECUTION_FIELDS,
        () => {
          if (nullOrEmpty(form.interval)) {
            return t('settings.toastIntervalEmpty');
          }
          const { from, to } = form.workingHours;
          if ((!nullOrEmpty(from) && nullOrEmpty(to)) || (nullOrEmpty(from) && !nullOrEmpty(to))) {
            return t('settings.toastWorkingHoursIncomplete');
          }
          // Only the interval and the limit are guarded here. They decide how much traffic Fredy
          // sends at the portals, so a cleared field must not be silently coerced into a value the
          // operator never chose - the threshold is allowed to be 0, which legitimately means
          // "notify me about anything".
          if (
            !Number.isInteger(Number(form.priceCheckIntervalDays)) ||
            Number(form.priceCheckIntervalDays) < 1 ||
            !Number.isInteger(Number(form.priceCheckLimitPerRun)) ||
            Number(form.priceCheckLimitPerRun) < 1
          ) {
            return t('settings.toastPriceTrackingInvalid');
          }
          return null;
        },
        false,
      ),
    [save, form, t],
  );

  return {
    t,
    form,
    setField,
    setWorkingHour,
    systemDirty: differs(form, baseline, SYSTEM_FIELDS),
    executionDirty: differs(form, baseline, EXECUTION_FIELDS),
    connectivityDirty: differs(form, baseline, CONNECTIVITY_FIELDS),
    savingSystem: saving === SYSTEM_FIELDS,
    savingExecution: saving === EXECUTION_FIELDS,
    savingConnectivity: saving === CONNECTIVITY_FIELDS,
    saveSystem,
    saveExecution,
    saveConnectivity,
  };
}
