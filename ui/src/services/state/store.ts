/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Zustand store for Fredy ui state.
 */
import { create, type StateCreator } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { xhrGet, xhrPost, xhrDelete } from '../xhr.js';
import queryString from 'query-string';
import { createJobsDataState, createJobsEffects, type JobsDataState } from './jobsState.js';
import { createListingsDataState, createListingsEffects, type ListingsDataState } from './listingsState.js';
import { createUserSettingsState, createUserSettingsEffects, type UserSettingsState } from './userSettingsState.js';
import { createFinanceState, createFinanceEffects, type FinanceState } from './financeState.js';
import {
  createNotificationEffects,
  createNotificationState,
  type NotificationAdapter,
  type NotificationChannelsState,
} from './notificationState.js';

/**
 * Optional state-change logging, off unless VITE_DEBUG_STORE is set.
 *
 * It used to log the whole previous and next state on every single `set` in development. That
 * retains two full snapshots per action in the console - including every loaded listing page - and
 * makes the devtools sluggish exactly when the app has enough data to be worth debugging.
 *
 * VITE_DEBUG_STORE is a development-only flag not declared on the shared ImportMetaEnv, so it is
 * read through a narrow local view rather than by widening the ambient declaration.
 */
const DEBUG_STORE = (import.meta.env as ImportMetaEnv & { VITE_DEBUG_STORE?: string })?.VITE_DEBUG_STORE === 'true';

/** A grouped, per-slice bag of actions. Values are either async effects or nested action groups. */
export type FredyAction = (...args: never[]) => unknown;
export type FredyActionGroup = Record<string, FredyAction | Record<string, unknown>>;

/** The aggregate store state: one member per domain slice, plus loading flags and the action bag. */
export interface FredyStoreState {
  dashboard: { data: unknown };
  finance: FinanceState;
  notificationAdapter: readonly NotificationAdapter[];
  notificationChannels: NotificationChannelsState;
  listingsData: ListingsDataState;
  generalSettings: { settings: Record<string, unknown> };
  userSettings: UserSettingsState;
  demoMode: { demoMode: boolean };
  provider: readonly unknown[];
  jobsData: JobsDataState;
  user: { currentUser: unknown };
  loading: Record<string, boolean>;
  __actions: { actions: Record<string, Record<string, FredyAction>> };
}

type StoreSet = Parameters<StateCreator<FredyStoreState>>[0];
type StoreGet = Parameters<StateCreator<FredyStoreState>>[1];
type StoreApi = Parameters<StateCreator<FredyStoreState>>[2];

/**
 * A wrapped action carries the dotted path of the flag it toggles, so useIsLoading() can read the
 * flag directly instead of reverse-mapping a function back to its name on every render.
 */
type TrackedAction = FredyAction & { actionPath?: string };

const logger =
  (config: StateCreator<FredyStoreState>): StateCreator<FredyStoreState> =>
  (set, get, api) =>
    config(
      (partial, replace) => {
        if (!DEBUG_STORE) {
          return (set as (p: typeof partial, r?: typeof replace) => void)(partial, replace);
        }
        const prev = get();
        (set as (p: typeof partial, r?: typeof replace) => void)(partial, replace);
        const next = get();
        // Only the keys that actually changed, rather than two copies of everything.
        const prevRecord = prev as unknown as Record<string, unknown>;
        const nextRecord = next as unknown as Record<string, unknown>;
        const changed = Object.keys(nextRecord).filter((key) => nextRecord[key] !== prevRecord[key]);
        /* eslint-disable no-console */
        console.info('[zustand]', changed.join(', '), Object.fromEntries(changed.map((key) => [key, nextRecord[key]])));
        /* eslint-enable no-console */
      },
      get,
      api,
    );

/**
 * Middleware to track loading state of async actions.
 */
const loadingTracker =
  (config: StateCreator<FredyStoreState>): StateCreator<FredyStoreState> =>
  (set, get, api) => {
    const wrappedSet: StoreSet = (partial, replace) => {
      (set as (p: typeof partial, r?: typeof replace) => void)(partial, replace);
    };

    return config(wrappedSet, get, api);
  };

// Create the Zustand store with slices and actions
export const useFredyState = create<FredyStoreState>()(
  logger(
    loadingTracker((set: StoreSet) => {
      const jobsEffects = createJobsEffects(set, { get: xhrGet }, queryString.stringify);
      const listingsEffects = createListingsEffects(set, { get: xhrGet, post: xhrPost }, queryString.stringify);
      const financeEffects = createFinanceEffects(set, { get: xhrGet, post: xhrPost });
      const userSettingsEffects = createUserSettingsEffects(set, { get: xhrGet, post: xhrPost }, async () => {
        await financeEffects.getProfileSummary();
      });
      const notificationEffects = createNotificationEffects(set, {
        get: <T>(url: string) => xhrGet(url) as Promise<{ status: number; json: T }>,
        post: <T>(url: string, data: unknown) => xhrPost(url, data) as Promise<{ status: number; json: T }>,
        delete: <T>(url: string) => xhrDelete(url, undefined) as Promise<{ status: number; json: T }>,
      });

      // Async actions that directly set state (no separate reducer concept)
      const effects = {
        dashboard: {
          async getDashboard() {
            try {
              const response = await xhrGet('/api/dashboard');
              set((state) => ({ dashboard: { ...state.dashboard, data: response.json } }));
            } catch (Exception) {
              console.error('Error while trying to get resource for /api/dashboard. Error:', Exception);
            }
          },
        },
        finance: financeEffects,
        notificationAdapter: { ...notificationEffects.notificationAdapter },
        notificationChannels: { ...notificationEffects.notificationChannels },
        generalSettings: {
          async getGeneralSettings() {
            try {
              const response = await xhrGet('/api/admin/generalSettings');
              set((state) => ({
                generalSettings: { ...state.generalSettings, settings: response.json as Record<string, unknown> },
              }));
            } catch (Exception) {
              console.error('Error while trying to get resource for api/admin/generalSettings. Error:', Exception);
            }
          },
        },
        provider: {
          async getProvider() {
            try {
              const response = await xhrGet('/api/jobs/provider');
              set(() => ({ provider: Object.freeze([...(response.json as unknown[])]) }));
            } catch (Exception) {
              console.error(`Error while trying to get resource for api/jobs/provider. Error:`, Exception);
            }
          },
        },
        jobsData: jobsEffects,
        user: {
          /**
           * Loads the logged-in user and returns it, so a caller that needs to act on the
           * answer immediately does not have to wait for the store update to reach its props.
           */
          async getCurrentUser(): Promise<unknown> {
            try {
              const response = await xhrGet('/api/auth/me');
              const currentUser = Object.freeze(response.json);
              set((state) => ({ user: { ...state.user, currentUser } }));
              return currentUser;
            } catch (Exception) {
              set((state) => ({ user: { ...state.user, currentUser: {} } }));
              throw Exception;
            }
          },
          /**
           * Drops the cached current user so the app falls back to the login screen. Triggered when a
           * request returns 401 (expired session) so the UI recovers instead of staying stuck.
           */
          async resetCurrentUser() {
            set((state) => ({ user: { ...state.user, currentUser: {} } }));
          },
        },
        demoMode: {
          async getDemoMode() {
            try {
              const response = await xhrGet('/api/demo');
              set((state) => ({
                demoMode: { ...state.demoMode, demoMode: (response.json as { demoMode?: boolean }).demoMode ?? false },
              }));
            } catch (Exception) {
              console.error('Error while trying to get resource for api/demo. Error:', Exception);
            }
          },
        },
        listingsData: listingsEffects,
        userSettings: userSettingsEffects,
      };

      // Initial state
      const initial = {
        dashboard: { data: null },
        finance: createFinanceState(),
        ...createNotificationState(),
        listingsData: createListingsDataState(),
        generalSettings: { settings: {} },
        userSettings: createUserSettingsState(),
        demoMode: { demoMode: false },
        provider: [],
        jobsData: createJobsDataState(),
        user: { currentUser: null },
      };

      // Expose actions by grouping them per slice
      const actions: Record<string, Record<string, FredyAction>> = {
        dashboard: { ...effects.dashboard },
        finance: { ...effects.finance },
        notificationAdapter: { ...effects.notificationAdapter },
        notificationChannels: { ...effects.notificationChannels },
        generalSettings: { ...effects.generalSettings },
        demoMode: { ...effects.demoMode },
        listingsData: { ...effects.listingsData },
        provider: { ...effects.provider },
        jobsData: { ...effects.jobsData },
        user: { ...effects.user },
        userSettings: { ...effects.userSettings },
      };

      // Wrap actions to track loading state.
      //
      // The wrapper tags itself with the action's path, so useIsLoading() can look the flag up
      // directly instead of scanning every slice and every action on every render to reverse-map
      // a function back to its name.
      const wrappedActions: Record<string, Record<string, FredyAction>> = {};
      Object.keys(actions).forEach((slice) => {
        wrappedActions[slice] = {};
        Object.keys(actions[slice]).forEach((actionName) => {
          const originalAction = actions[slice][actionName];
          if (typeof originalAction === 'function') {
            const fullActionName = `${slice}.${actionName}`;
            const wrapped: TrackedAction = async (...args: never[]) => {
              set((state) => ({ loading: { ...state.loading, [fullActionName]: true } }));
              try {
                return await originalAction(...args);
              } finally {
                set((state) => ({ loading: { ...state.loading, [fullActionName]: false } }));
              }
            };
            wrapped.actionPath = fullActionName;
            wrappedActions[slice][actionName] = wrapped;
          } else {
            wrappedActions[slice][actionName] = originalAction;
          }
        });
      });

      return {
        ...initial,
        loading: {},
        __actions: { actions: wrappedActions },
      } as FredyStoreState;
    }),
  ),
);

/**
 * Selector hook.
 *
 * Wraps the selector in zustand's `useShallow`, so a selector returning a fresh object or array
 * re-renders only when its contents change. zustand v5 removed the second `equalityFn` argument
 * this used to pass; it was accepted and silently ignored, which meant every call site here had
 * reference equality while looking like it had shallow equality.
 */
export function useSelector<State, Selected>(selector: (state: State) => Selected): Selected {
  return useFredyState(useShallow(selector as (state: FredyStoreState) => Selected));
}

/**
 * Actions hook returning grouped async actions per slice.
 * Example: const { jobsData } = useActions(); await jobsData.getJobs();
 */
export function useActions<Actions = Record<string, Record<string, FredyAction>>>(): Actions {
  return useFredyState((s) => s.__actions.actions) as Actions;
}

/**
 * Whether a specific action is currently running.
 *
 * Subscribes to that one flag rather than to the whole `loading` object, so an unrelated request
 * finishing no longer re-renders every component that asks about loading state. The action's path
 * is read off the wrapper the store attached to it, instead of being recovered by scanning every
 * slice on every render.
 */
export function useIsLoading(action: (...arguments_: never[]) => unknown): boolean {
  const actionPath = (action as TrackedAction | null | undefined)?.actionPath ?? null;
  return useFredyState((state) => (actionPath == null ? false : state.loading[actionPath] === true));
}
