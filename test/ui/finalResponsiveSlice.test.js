/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const jobMutationStyles = read('ui/src/views/jobs/mutation/JobMutation.less');
const navigationStyles = read('ui/src/components/navigation/Navigate.less');
const onboardingStyles = read('ui/src/views/onboarding/ApplicantProfileOnboardingPage.less');
const jobGridSource = read('ui/src/components/grid/jobs/JobGrid.jsx');
const jobGridStyles = read('ui/src/components/grid/jobs/JobGrid.less');
const jobsTableSource = read('ui/src/components/table/JobsTable.jsx');

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

  it('names the activity control and all five job actions in card and table layouts', () => {
    expect(jobGridSource).toContain("aria-label={t('jobs.cardActive')}");
    expect(jobGridSource.match(/aria-label={t\('jobs\.popover[^']+'\)}/g)).toHaveLength(5);
    expect(jobGridSource).toMatch(/IconPlayCircle[\s\S]*aria-label={t\('jobs\.popoverRunJob'\)}/);
    expect(jobGridSource).toMatch(/IconDelete[\s\S]*aria-label={t\('jobs\.popoverDeleteJob'\)}/);

    expect(jobsTableSource).toContain("aria-label={t('jobs.cardActive')}");
    expect(jobsTableSource.match(/aria-label={t\('jobs\.table[^']+'\)}/g)).toHaveLength(5);
    expect(jobsTableSource).toMatch(/IconPlayCircle[\s\S]*aria-label={t\('jobs\.tableRunJob'\)}/);
    expect(jobsTableSource).toMatch(/IconDelete[\s\S]*aria-label={t\('jobs\.tableDeleteJob'\)}/);
  });

  it('wraps narrow-card actions into five 44px columns without overflow', () => {
    expect(jobGridStyles).toMatch(
      /@media \(max-width: 480px\)[\s\S]*grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/,
    );
    expect(jobGridStyles).toMatch(/&__actions[\s\S]*width:\s*100%[\s\S]*display:\s*grid/);
    expect(jobGridStyles).toMatch(/\.semi-button[\s\S]*min-width:\s*44px[\s\S]*min-height:\s*44px/);
    expect(jobGridStyles).toMatch(
      /\.semi-switch-native-control[\s\S]*width:\s*44px !important[\s\S]*height:\s*44px !important/,
    );
  });
});
