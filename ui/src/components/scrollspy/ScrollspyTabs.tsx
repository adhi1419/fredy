/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import './ScrollspyTabs.less';

/**
 * One registered section the rail can scroll to. `id` must match the `id` of the section element in
 * the page (the target of `scrollIntoView` and the `aria-controls` link); `label` is the visible
 * tab text; `icon` is an optional leading glyph.
 */
export interface ScrollspySection {
  id: string;
  label: string;
  icon?: ReactNode;
}

export interface ScrollspyTabsProps {
  /** The sections to expose, in document order. */
  sections: readonly ScrollspySection[];
  /** Accessible name for the tab rail (a `tablist`). */
  ariaLabel: string;
  /**
   * Optional scroll container the sections live in. Defaults to the viewport. Passed to the
   * IntersectionObserver as its `root`.
   */
  scrollRoot?: HTMLElement | null;
  /** Optional class appended to the rail wrapper. */
  className?: string;
  /** Notified whenever the active section changes (scroll or click). */
  onActiveChange?: (id: string) => void;
}

/**
 * Choose the active section from the set currently intersecting the root.
 *
 * Pure so it can be unit-tested without a DOM: given the entries the IntersectionObserver reported
 * (each an `{ id, isIntersecting, top }` where `top` is the section's distance from the root's top
 * edge) and the previous active id, return the id that should be marked active.
 *
 * Rules, in order:
 *  1. Prefer the topmost section that is currently intersecting — the one the reader has reached.
 *  2. If nothing is intersecting (e.g. mid-scroll between two tall sections), keep the previous
 *     active id so the rail never flickers back to nothing.
 *  3. With no previous and nothing intersecting, fall back to the first section id.
 */
export function resolveActiveSection(
  entries: ReadonlyArray<{ id: string; isIntersecting: boolean; top: number }>,
  previousActiveId: string | null,
  orderedIds: readonly string[],
): string | null {
  const intersecting = entries.filter((entry) => entry.isIntersecting);
  if (intersecting.length > 0) {
    return intersecting.reduce((topmost, entry) => (entry.top < topmost.top ? entry : topmost)).id;
  }
  if (previousActiveId != null) return previousActiveId;
  return orderedIds[0] ?? null;
}

/** Whether the user has asked the OS to minimise motion. Safe on non-browser (SSR/test) runtimes. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Index of the tab to focus after an arrow/home/end key, wrapping at both ends. */
export function nextTabIndex(current: number, key: string, count: number): number {
  if (count === 0) return 0;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return current;
  }
}

/**
 * A horizontally-scrollable sticky tab rail with one tab per registered section.
 *
 * Clicking or keying to a tab smooth-scrolls its section into view (respecting
 * `prefers-reduced-motion`), and an IntersectionObserver keeps the active tab in step as the user
 * scrolls. The component is deliberately generic — it never knows what a "section" is — so any long
 * page (Edit Search steps, Listing Detail, Account, Admin) can reuse it by passing
 * `sections: [{ id, label, icon? }]`.
 */
export default function ScrollspyTabs({
  sections,
  ariaLabel,
  scrollRoot = null,
  className,
  onActiveChange,
}: ScrollspyTabsProps) {
  const orderedIds = sections.map((section) => section.id);
  const [activeId, setActiveId] = useState<string | null>(orderedIds[0] ?? null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // The click-driven scroll and the observer race: a click sets the active tab immediately, but the
  // scroll it triggers fires observer callbacks for every section it passes through. This ref lets
  // the observer ignore its own reports until the programmatic scroll settles.
  const suppressObserverUntil = useRef(0);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  const applyActive = useCallback(
    (id: string | null) => {
      if (id == null || id === activeIdRef.current) return;
      setActiveId(id);
      onActiveChange?.(id);
    },
    [onActiveChange],
  );

  // Reset to the first section if the registered set changes (e.g. Edit Search switches step).
  useEffect(() => {
    if (orderedIds.length === 0) return;
    if (activeIdRef.current == null || !orderedIds.includes(activeIdRef.current)) {
      applyActive(orderedIds[0]);
    }
    // orderedIds is derived from sections; depend on its joined identity to avoid array churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedIds.join('|'), applyActive]);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || orderedIds.length === 0) return;

    const elements = orderedIds
      .map((id) => (typeof document === 'undefined' ? null : document.getElementById(id)))
      .filter((element): element is HTMLElement => element != null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (observerEntries) => {
        if (Date.now() < suppressObserverUntil.current) return;
        const rootTop = scrollRoot?.getBoundingClientRect().top ?? 0;
        const reported = observerEntries.map((entry) => ({
          id: entry.target.id,
          isIntersecting: entry.isIntersecting,
          top: entry.boundingClientRect.top - rootTop,
        }));
        // Merge with the sections the observer did not mention this tick: treat them as not
        // intersecting so the resolver only ever considers fresh reports plus the sticky previous.
        const merged = orderedIds.map((id) => {
          const hit = reported.find((entry) => entry.id === id);
          return hit ?? { id, isIntersecting: false, top: Number.POSITIVE_INFINITY };
        });
        applyActive(resolveActiveSection(merged, activeIdRef.current, orderedIds));
      },
      {
        root: scrollRoot ?? null,
        // Trip a section active once its heading clears the sticky rail near the top of the root.
        rootMargin: '-96px 0px -55% 0px',
        threshold: [0, 1],
      },
    );

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedIds.join('|'), scrollRoot, applyActive]);

  const scrollToSection = useCallback(
    (id: string) => {
      applyActive(id);
      if (typeof document === 'undefined') return;
      const target = document.getElementById(id);
      if (target == null) return;
      // Give the observer a beat to settle before it takes over again.
      suppressObserverUntil.current = Date.now() + 700;
      target.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'start',
      });
    },
    [applyActive],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      scrollToSection(orderedIds[index]);
      return;
    }
    const target = nextTabIndex(index, event.key, orderedIds.length);
    if (target === index) return;
    event.preventDefault();
    tabRefs.current[target]?.focus();
  };

  if (sections.length === 0) return null;

  return (
    <div className={`scrollspyTabs${className ? ` ${className}` : ''}`} role="tablist" aria-label={ariaLabel}>
      {sections.map((section, index) => {
        const active = section.id === activeId;
        return (
          <button
            key={section.id}
            type="button"
            role="tab"
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            id={`scrollspy-tab-${section.id}`}
            aria-controls={section.id}
            aria-selected={active}
            aria-current={active ? 'true' : undefined}
            tabIndex={active ? 0 : -1}
            className={`scrollspyTabs__tab${active ? ' scrollspyTabs__tab--active' : ''}`}
            onClick={() => scrollToSection(section.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {section.icon != null && (
              <span className="scrollspyTabs__icon" aria-hidden="true">
                {section.icon}
              </span>
            )}
            <span className="scrollspyTabs__label">{section.label}</span>
          </button>
        );
      })}
    </div>
  );
}
