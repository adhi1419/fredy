/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  nextTabIndex,
  prefersReducedMotion,
  resolveActiveSection,
} from '../../ui/src/components/scrollspy/ScrollspyTabs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const componentSource = fs.readFileSync(path.join(root, 'ui/src/components/scrollspy/ScrollspyTabs.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'ui/src/components/scrollspy/ScrollspyTabs.less'), 'utf8');

const ids = ['a', 'b', 'c'];

describe('ScrollspyTabs active-section resolver', () => {
  it('picks the topmost intersecting section', () => {
    const entries = [
      { id: 'a', isIntersecting: false, top: -200 },
      { id: 'b', isIntersecting: true, top: 40 },
      { id: 'c', isIntersecting: true, top: 320 },
    ];
    expect(resolveActiveSection(entries, 'a', ids)).toBe('b');
  });

  it('keeps the previous active id when nothing is intersecting mid-scroll', () => {
    const entries = ids.map((id) => ({ id, isIntersecting: false, top: 999 }));
    expect(resolveActiveSection(entries, 'b', ids)).toBe('b');
  });

  it('falls back to the first section with no previous and nothing intersecting', () => {
    const entries = ids.map((id) => ({ id, isIntersecting: false, top: 999 }));
    expect(resolveActiveSection(entries, null, ids)).toBe('a');
    expect(resolveActiveSection([], null, ids)).toBe('a');
    expect(resolveActiveSection([], null, [])).toBeNull();
  });
});

describe('ScrollspyTabs keyboard index', () => {
  it('wraps forward and backward across arrow keys', () => {
    expect(nextTabIndex(0, 'ArrowRight', 3)).toBe(1);
    expect(nextTabIndex(2, 'ArrowRight', 3)).toBe(0);
    expect(nextTabIndex(0, 'ArrowLeft', 3)).toBe(2);
    expect(nextTabIndex(1, 'ArrowDown', 3)).toBe(2);
    expect(nextTabIndex(1, 'ArrowUp', 3)).toBe(0);
  });

  it('jumps to the ends with Home and End and ignores other keys', () => {
    expect(nextTabIndex(2, 'Home', 3)).toBe(0);
    expect(nextTabIndex(0, 'End', 3)).toBe(2);
    expect(nextTabIndex(1, 'Tab', 3)).toBe(1);
    expect(nextTabIndex(0, 'ArrowRight', 0)).toBe(0);
  });
});

describe('prefersReducedMotion', () => {
  it('is false in a non-browser runtime', () => {
    // The test runs in the node environment where window is undefined.
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe('ScrollspyTabs accessible sticky rail', () => {
  it('is a generic, reusable tablist keyed only on sections/label/icon props', () => {
    expect(componentSource).toContain('export interface ScrollspySection');
    expect(componentSource).toContain('sections: readonly ScrollspySection[]');
    expect(componentSource).toContain('icon?: ReactNode');
    // No host-specific coupling: it never imports a job/listing/account module.
    expect(componentSource).not.toMatch(/from '\.\.\/\.\.\/(views|services\/jobs)\//);
  });

  it('exposes tab semantics, aria-current, roving tabindex, and IntersectionObserver', () => {
    expect(componentSource).toContain('role="tablist"');
    expect(componentSource).toContain('role="tab"');
    expect(componentSource).toContain('aria-controls={section.id}');
    expect(componentSource).toContain("aria-current={active ? 'true' : undefined}");
    expect(componentSource).toContain('tabIndex={active ? 0 : -1}');
    expect(componentSource).toContain('new IntersectionObserver');
  });

  it('smooth-scrolls but honours reduced motion', () => {
    expect(componentSource).toContain("behavior: prefersReducedMotion() ? 'auto' : 'smooth'");
    expect(componentSource).toContain('scrollIntoView');
  });

  it('is sticky, horizontally scrollable, pill-shaped, and 44px tall', () => {
    expect(styles).toMatch(/\.scrollspyTabs\s*{[\s\S]*?position:\s*sticky;/);
    expect(styles).toMatch(/\.scrollspyTabs\s*{[\s\S]*?overflow-x:\s*auto;/);
    expect(styles).toMatch(/&__tab\s*{[\s\S]*?min-height:\s*44px;/);
    expect(styles).toMatch(/&__tab\s*{[\s\S]*?border-radius:\s*@radius-pill;/);
    // Sections opt into scroll-margin so a jumped-to heading clears the sticky rail.
    expect(styles).toMatch(/\.scrollspyTabs-section\s*{[\s\S]*?scroll-margin-top:/);
  });
});

describe('Listing Detail shared scrollspy integration', () => {
  const listingSource = fs.readFileSync(path.join(root, 'ui/src/views/listings/ListingDetail.tsx'), 'utf8');

  it('reuses the shared component instead of maintaining a second scroll listener', () => {
    expect(listingSource).toContain(
      "import ScrollspyTabs, { type ScrollspySection } from '../../components/scrollspy/ScrollspyTabs';",
    );
    expect(listingSource).toContain('scrollRoot={scrollRoot}');
    expect(listingSource).toContain('className="listing-detail__scrollspy"');
    expect(listingSource).not.toContain('function useScrollspy(');
    expect(listingSource).not.toContain('function ScrollspyTabs(');
  });
});
