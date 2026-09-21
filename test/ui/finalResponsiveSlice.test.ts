/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getSavedSearchDirectAction, shouldShowPause } from '../../ui/src/views/jobs/savedSearchActions';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const read = (relativePath: string): string => fs.readFileSync(path.join(root, relativePath), 'utf8');

const jobMutationStyles = read('ui/src/views/jobs/mutation/JobMutation.less');
const navigationStyles = read('ui/src/components/navigation/Navigate.less');
const onboardingStyles = read('ui/src/views/onboarding/ApplicantProfileOnboardingPage.less');
const savedSearchesSource = read('ui/src/views/jobs/SavedSearchesIndex.tsx');
const savedSearchActionsSource = read('ui/src/views/jobs/savedSearchActions.ts');
const savedSearchesStyles = read('ui/src/views/jobs/SavedSearchesIndex.less');
const settingsLayoutStyles = read('ui/src/views/settings/SettingsLayout.less');
const settingsShellStyles = read('ui/src/components/settingsShell/SettingsShell.less');
const jobsSource = read('ui/src/views/jobs/Jobs.tsx');
const jobMutationSource = read('ui/src/views/jobs/mutation/JobMutation.tsx');

describe('final responsive slice', () => {
  it('does not leak a fixed select popup width from the job mutation stylesheet', () => {
    expect(jobMutationStyles).not.toMatch(/semi-select-option-list-wrapper/);
    expect(jobMutationStyles).not.toMatch(/width:\s*25rem/);
  });

  it('hides the footer only after a rendered mobile primary navigation', () => {
    const mobileRule = navigationStyles.indexOf('.fredy-shell-nav__mobile-primary + .app__main .fredyFooter');
    const mobileMedia = navigationStyles.indexOf('@media (max-width: 768px)');

    expect(mobileRule).toBeGreaterThan(mobileMedia);
    expect(navigationStyles).toMatch(
      /\.fredy-shell-nav__mobile-primary \+ \.app__main \.fredyFooter\s*{\s*display:\s*none;/,
    );
    expect(navigationStyles).not.toMatch(/\.fredy-shell-nav\s+\.fredyFooter/);
  });

  it('keeps the onboarding grid responsive while making every input wrapper 44px', () => {
    expect(onboardingStyles).toMatch(/\.semi-input-wrapper\s*{\s*min-height:\s*44px;/);
    expect(onboardingStyles).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(onboardingStyles).toMatch(/@media \(max-width: 640px\)[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  });

  it('renders the approved Saved Searches fields as one semantic row/card surface', () => {
    expect(jobsSource).toContain("import SavedSearchesIndex from './SavedSearchesIndex';");
    expect(jobsSource).toContain('className="jobs__heading"');
    expect(jobsSource).toContain("t('jobs.index.eyebrow')");
    expect(jobsSource).toContain("t('jobs.index.heading')");
    expect(jobsSource).toContain("t('jobs.index.description')");
    expect(savedSearchesSource).toContain('className="savedSearches__createCard"');
    expect(savedSearchesSource).toContain("t('jobs.index.addAnother')");
    expect(savedSearchesSource).toContain("t('jobs.index.addAnotherHelp')");
    expect(savedSearchesSource).toContain('className="savedSearches__identity"');
    expect(savedSearchesSource).toContain('className="savedSearches__middle"');
    expect(savedSearchesSource).toContain('className="savedSearches__state"');
    expect(savedSearchesSource).toContain('className="savedSearches__lastRun"');
    expect(savedSearchesSource).toContain('className="savedSearches__rowActions"');
    expect(savedSearchesSource).toContain("t('jobs.index.criteria')");
    expect(savedSearchesSource).toContain("t('jobs.index.neverRun')");
  });

  it('keeps the row actions and read-only state accessible', () => {
    expect(savedSearchesSource).toContain('role="menu"');
    expect(savedSearchesSource).toContain('role="menuitem"');
    expect(savedSearchesSource).toContain("aria-label={t('jobs.index.overflowFor'");
    expect(savedSearchesSource).toContain("aria-label={t('jobs.index.directActionFor'");
    // Direction A: a self-describing state chip (icon + text, never colour-only) replaces the
    // generic Semi Tag so Ready/Paused/Running/Shared each read without relying on hue alone.
    expect(savedSearchesSource).toContain('savedSearches__stateChip savedSearches__stateChip--');
    expect(savedSearchesSource).not.toContain('<Tag');
    expect(savedSearchesSource).not.toContain('<Switch');
    expect(savedSearchesSource).toContain('disabled={readOnly}');
    expect(savedSearchesSource).toContain('disabled={directAction.disabled}');
  });

  it('renders the Direction A marketplace card evidence: run health, repair promise, and edit cue', () => {
    expect(savedSearchesSource).toContain("t('jobs.index.runHealthReady')");
    expect(savedSearchesSource).toContain("t('jobs.index.repairPromise')");
    expect(savedSearchesSource).toContain('className="savedSearches__editCue"');
    expect(savedSearchesSource).toContain('className="savedSearches__repairNote"');
    // The whole card stays the direct edit target; the cue is a hint, not a second control.
    expect(savedSearchesSource).toContain("{t('jobs.index.editHint')} →");
    // The stack is spaced cards, not a bordered dense list.
    expect(savedSearchesStyles).toMatch(/&__list\s*{[\s\S]*?gap:\s*@space-4;/);
    expect(savedSearchesStyles).toMatch(/&__row\s*{[\s\S]*?border-radius:\s*@radius-card;/);
    expect(savedSearchesStyles).toMatch(/&__stateChip\s*{/);
    expect(savedSearchesStyles).toContain('grid-template-columns: minmax(0, 1fr) 44px auto;');
    expect(savedSearchesStyles).toMatch(/\.savedSearches__search\s*{[\s\S]*?grid-column:\s*1 \/ -1;/);
    expect(savedSearchesStyles).toMatch(/\.savedSearches__sortDirection\s*{[\s\S]*?width:\s*44px;/);
  });

  it('preserves SSE, run, pause, filters, and pagination behavior in the deep feature module', () => {
    for (const marker of [
      'createAuthenticatedEventStream',
      'xhrPost(`/api/jobs/${jobId}/run`, {})',
      'xhrPut(`/api/jobs/${jobId}/status`',
      'FilterDrawer',
      'Pagination',
      'setJobRunning',
      'pendingJobIdRef',
    ]) {
      expect(savedSearchesSource).toContain(marker);
    }
  });

  it('keeps the migrated Saved Searches source explicit at legacy boundaries', () => {
    expect(savedSearchesSource).not.toContain('@ts-expect-error');
    expect(jobsSource).not.toContain('@ts-expect-error');
    expect(savedSearchesSource).not.toMatch(/\bas any\b/);
    expect(jobsSource).not.toMatch(/\bas any\b/);
  });
  it('opens editable Saved Search rows directly and keeps one Create action', () => {
    expect(savedSearchesSource).toContain("role: 'button' as const");
    expect(savedSearchesSource).toContain('tabIndex: 0');
    expect(savedSearchesSource).toContain("event.key === 'Enter' || event.key === ' '");
    expect(savedSearchesSource).toContain("event.target.closest('.savedSearches__rowActions')");
    expect(savedSearchesSource).toContain("t('jobs.index.runAndRepair')");
    expect(savedSearchesSource).toContain('onRepair={onJobRun}');
    expect(savedSearchesSource).not.toContain("action(t('jobs.index.edit')");
    expect(savedSearchesSource).not.toContain('/repair`');
    expect(savedSearchesSource).not.toContain('eslint-disable');
    expect(jobsSource).not.toContain("navigate('/jobs/new')");
    expect(savedSearchesSource.match(/navigate\('\/jobs\/new'\)/g)).toHaveLength(1);
  });

  it('uses direct state actions and a separate overflow trigger', () => {
    expect(savedSearchesSource).toContain('className="savedSearches__directAction"');
    expect(savedSearchesSource).toContain('className="savedSearches__overflowButton"');
    expect(savedSearchesSource).toContain('IconMoreStroked');
    expect(savedSearchesSource).toContain("t('jobs.index.pause')");
    expect(savedSearchActionsSource).toContain("t('jobs.index.resume')");
    expect(savedSearchActionsSource).toContain("t('jobs.index.running')");
    expect(savedSearchActionsSource).toContain("t('jobs.index.readOnlyAction')");
    expect(savedSearchesSource).not.toContain("t('jobs.index.actions')");
    expect(fs.existsSync(path.join(root, 'ui/src/components/grid/jobs/JobGrid.jsx'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'ui/src/components/table/JobsTable.jsx'))).toBe(false);
  });

  it('models direct actions and active-only pause behavior', () => {
    const t = (key: string) => key;
    expect(getSavedSearchDirectAction({ enabled: true, running: false, isOnlyShared: false }, t)).toEqual({
      kind: 'run',
      label: 'jobs.index.run',
      disabled: false,
    });

    expect(getSavedSearchDirectAction({ enabled: false, running: false, isOnlyShared: false }, t)).toEqual({
      kind: 'resume',
      label: 'jobs.index.resume',
      disabled: false,
    });
    expect(getSavedSearchDirectAction({ enabled: true, running: true, isOnlyShared: false }, t)).toEqual({
      kind: 'running',
      label: 'jobs.index.running',
      disabled: true,
    });
    expect(getSavedSearchDirectAction({ enabled: true, running: false, isOnlyShared: true }, t)).toEqual({
      kind: 'readOnly',
      label: 'jobs.index.readOnlyAction',
      disabled: true,
    });
    expect(shouldShowPause({ enabled: true, isOnlyShared: false })).toBe(true);
    expect(shouldShowPause({ enabled: false, isOnlyShared: false })).toBe(false);
    expect(shouldShowPause({ enabled: true, isOnlyShared: true })).toBe(false);
  });

  it('defines each direct-action locale key once and removes obsolete generic controls', () => {
    for (const locale of ['en', 'de', 'tr']) {
      const source = read(`ui/src/locales/${locale}.json`);
      expect(source.match(/"jobs\.index\.run":/g)).toHaveLength(1);
      expect(source).not.toContain('"jobs.index.actions":');
      expect(source).not.toContain('"jobs.index.actionsFor":');
      expect(source).not.toContain('"jobs.index.toggle":');
    }
  });

  it('keeps Admin tabs on one horizontally scrollable row', () => {
    expect(settingsShellStyles).toMatch(
      /&__tabbar\.semi-tabs-bar\s*{[\s\S]*?display:\s*flex;[\s\S]*?flex-wrap:\s*nowrap;[\s\S]*?overflow-x:\s*auto;/,
    );
  });

  it('keeps iPhone Settings centered with symmetric contained gutters', () => {
    const mobile = settingsLayoutStyles.slice(settingsLayoutStyles.indexOf('@media (max-width: 768px)'));
    expect(mobile).toMatch(/\.settingsLayout\s*{[\s\S]*?box-sizing:\s*border-box;/);
    expect(mobile).toMatch(/padding:\s*@space-4 @space-4 calc\(80px \+ env\(safe-area-inset-bottom\)\)/);
    expect(mobile).toMatch(/&__nav\s*{[\s\S]*?max-width:\s*100%;[\s\S]*?overflow-x:\s*auto;/);
  });

  it('keeps mobile action targets at least 44px', () => {
    expect(savedSearchesStyles).toMatch(/&__sortDirection\s*{[\s\S]*min-height:\s*44px;/);

    expect(savedSearchesStyles).toMatch(/&__stateControl\s*{[\s\S]*min-height:\s*44px;/);
    expect(savedSearchesStyles).toMatch(/&__directAction\s*{[\s\S]*min-height:\s*44px;/);
    expect(savedSearchesStyles).toMatch(/&__overflowButton\s*{[\s\S]*min-height:\s*44px;/);
    expect(savedSearchesStyles).toMatch(/&__menuAction\s*{[\s\S]*min-height:\s*44px;/);
    expect(savedSearchesStyles).toMatch(/&__createCard\s*{/);
    expect(savedSearchesStyles).toMatch(
      /@media \(max-width: 640px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto/,
    );
  });
});

describe('lane B: saved searches merged card, review health, and pill actions', () => {
  const savedSearchesSource = read('ui/src/views/jobs/SavedSearchesIndex.tsx');
  const savedSearchesStyles = read('ui/src/views/jobs/SavedSearchesIndex.less');
  const savedSearchActionsSource = read('ui/src/views/jobs/savedSearchActions.ts');
  const guidedFormSource = read('ui/src/views/jobs/mutation/GuidedJobForm.tsx');
  const cardsSource = read('ui/src/views/jobs/mutation/components/provider/ProviderChoiceCards.tsx');
  const guidedStyles = read('ui/src/views/jobs/mutation/GuidedJobForm.less');

  it('merges last-run health and status into one middle column', () => {
    expect(savedSearchesSource).toContain('className="savedSearches__middle"');
    // Both the merged sub-blocks still exist inside that column.
    expect(savedSearchesSource).toContain('className="savedSearches__lastRun"');
    expect(savedSearchesSource).toContain('className="savedSearches__state"');
    expect(savedSearchesStyles).toMatch(/&__middle\s*{[\s\S]*?align-content:\s*center;/);
  });

  it('surfaces a review-unknown health line without fabricating an absent count', () => {
    expect(savedSearchesSource).toContain("t('jobs.index.runHealthReview'");
    expect(savedSearchesSource).toContain("t('jobs.index.runHealthReviewNote')");
    expect(savedSearchesSource).toContain('resolveSavedSearchHealth(job)');
    expect(savedSearchActionsSource).toContain('resolveSavedSearchHealth');
    expect(savedSearchActionsSource).toContain('manualReviewCount');
    // A warning tone is defined and paired with an icon, never colour alone.
    expect(savedSearchesStyles).toMatch(/&__health--review\s*{[\s\S]*?color:\s*@color-warning;/);
    expect(savedSearchesSource).toContain('savedSearches__health--review');
    expect(savedSearchesSource).toContain('IconTickCircle');
  });

  it('relabels only the runnable primary action to Run & repair', () => {
    expect(savedSearchesSource).toContain(
      "directAction.kind === 'run' ? t('jobs.index.runAndRepair') : directAction.label",
    );
  });

  it('rounds the row action controls to the pill radius', () => {
    expect(savedSearchesStyles).toMatch(/&__directAction\s*{[\s\S]*?border-radius:\s*@radius-pill;/);
    expect(savedSearchesStyles).toMatch(/&__overflowButton\s*{[\s\S]*?border-radius:\s*@radius-pill;/);
  });

  it('moves destructive actions from card overflow into the Edit Search danger zone', () => {
    expect(savedSearchesSource).not.toContain("action(t('jobs.index.deleteListings')");
    expect(savedSearchesSource).not.toContain("action(t('jobs.index.delete')");
    // Pause, Run & repair and Duplicate remain the only overflow items.
    expect(savedSearchesSource).toContain("action(t('jobs.index.pause')");
    expect(savedSearchesSource).toContain("action(t('jobs.index.runAndRepair')");
    expect(savedSearchesSource).toContain("action(t('jobs.index.clone')");
    // Saved Searches owns no permanently hidden deletion modal; Edit Search owns both operations.
    expect(savedSearchesSource).not.toContain('ListingDeletionModal');
    expect(savedSearchesSource).not.toContain("xhrDelete('/api/jobs'");
    expect(jobMutationSource).toContain(
      "import ListingDeletionModal from '../../../components/ListingDeletionModal.jsx'",
    );
    expect(jobMutationSource).toContain("xhrDelete('/api/jobs'");
    expect(jobMutationSource).toContain("xhrDelete('/api/listings/job'");
    expect(jobMutationSource).toContain("onClearListings={() => requestDeletion('listings')}");
    expect(jobMutationSource).toContain("onDeleteSearch={() => requestDeletion('job')}");
    expect(guidedFormSource).toContain('id="guided-section-danger"');
  });

  it('renders provider URLs host-only in the Edit Search view while keeping the full URL', () => {
    expect(cardsSource).toContain('providerUrlLabel(displaySource.url)');
    expect(cardsSource).toContain('normalizeHost');
    // Full URL preserved in title/aria; never used as the visible link text or as the href fallback.
    expect(cardsSource).toContain('title={displaySource.url ?? undefined}');
    expect(cardsSource).toContain("t('jobs.mutation.viewUrlOpenAria'");
    expect(cardsSource).not.toContain('>{displaySource.url}<');
    expect(guidedStyles).toMatch(/providerChoiceCards__urlLink[\s\S]*?text-overflow:\s*ellipsis;/);
  });

  it('places the edit cue in the actions column above Run & repair', () => {
    const actionsStart = savedSearchesSource.indexOf('className="savedSearches__rowActions"');
    const editCue = savedSearchesSource.indexOf('className="savedSearches__editCue"');
    const actionRow = savedSearchesSource.indexOf('className="savedSearches__actionRow"');
    expect(actionsStart).toBeGreaterThan(0);
    expect(editCue).toBeGreaterThan(actionsStart);
    expect(actionRow).toBeGreaterThan(editCue);
    expect(savedSearchesSource.match(/className="savedSearches__editCue"/g)).toHaveLength(1);
  });
  it('wires the shared ScrollspyTabs rail into Edit Search with per-section anchors', () => {
    expect(guidedFormSource).toContain(
      "import ScrollspyTabs, { type ScrollspySection } from '../../../components/scrollspy/ScrollspyTabs';",
    );
    expect(guidedFormSource).toContain('<ScrollspyTabs');
    expect(guidedFormSource).toContain("ariaLabel={t('jobs.mutation.sectionsNavLabel')}");
    expect(guidedFormSource).toContain('className="scrollspyTabs-section"');
    expect(guidedFormSource).toContain('id="guided-section-providers"');
  });

  it('keeps the mobile step footer in flow and clear of bottom navigation', () => {
    const mobile = guidedStyles.slice(guidedStyles.indexOf('@media (max-width: 850px)'));
    expect(mobile).toMatch(/guidedJobForm__footer\s*{[\s\S]*?position:\s*static;/);
    expect(mobile).toMatch(
      /guidedJobForm__footer\s*{[\s\S]*?margin:\s*@space-4 0 calc\(80px \+ env\(safe-area-inset-bottom\)\)/,
    );
    expect(mobile).not.toMatch(/guidedJobForm__footer\s*{[\s\S]*?position:\s*(?:fixed|sticky);/);
  });
});
