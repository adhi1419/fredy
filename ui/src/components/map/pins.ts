/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * The one pin shape every Fredy map uses, as a DOM element MapLibre can anchor.
 *
 * MapLibre's own marker is a blue teardrop with a white dot, painted from an SVG it owns, so it
 * cannot follow the palette. These are built from the same teardrop silhouette but take their
 * colour from the stylesheet (`.fredy-pin` in `Map.less`), which is what lets them read as ink on
 * paper in one theme and paper on ink in the other.
 *
 * Roles:
 * - `listing` - a result. Ink; inverted to paper when selected.
 * - `group`   - several results at one address. Same pin, carrying the count.
 * - `place`   - a saved address. Paper with an ink glyph, so it never reads as a result.
 *
 * Anchor every one of them with `anchor: 'bottom'`: the tip is the location.
 */

export type PinRole = 'listing' | 'group' | 'place';

/** Glyphs for saved places, stroked so they read at 14px on both basemaps. */
export const PLACE_GLYPHS = {
  work: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="1"/><path d="M8 7V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M3 12h18"/></svg>',
  flag: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4M5 4h12l-2 4 2 4H5"/></svg>',
} as const;

export type PlaceGlyph = keyof typeof PLACE_GLYPHS;

export interface PinOptions {
  role: PinRole;
  /** Accessible name; also the title. */
  label: string;
  /** Count shown in the head of a `group` pin. */
  count?: number;
  /** Glyph shown in the head of a `place` pin. */
  glyph?: PlaceGlyph;
  /** Interactive pins are buttons so they take focus and fire click; decorative ones are images. */
  interactive?: boolean;
}

/** The slice of `Document` the factory touches, so a test can hand in a fake without a DOM. */
export interface PinDocument {
  createElement(tag: string): HTMLElement;
}

/**
 * Builds a pin element. The caller owns it: attach listeners, hand it to `new Marker({ element })`,
 * and remove the marker when done.
 *
 * @param {PinOptions} options
 * @param {PinDocument} [doc] Defaults to the page's document.
 * @returns {HTMLElement}
 */
export function createPinElement(
  { role, label, count, glyph, interactive = false }: PinOptions,
  doc: PinDocument = document,
): HTMLElement {
  const element = doc.createElement(interactive ? 'button' : 'div');
  if (interactive) element.setAttribute('type', 'button');
  element.className = `fredy-pin fredy-pin--${role}`;
  element.setAttribute(interactive ? 'aria-pressed' : 'role', interactive ? 'false' : 'img');
  element.setAttribute('aria-label', label);
  element.title = label;

  const head = doc.createElement('span');
  head.className = 'fredy-pin__head';
  head.setAttribute('aria-hidden', 'true');
  if (role === 'group' && count != null) {
    // A child rather than a text node, so the stylesheet can turn it upright inside the rotated head.
    const number = doc.createElement('span');
    number.textContent = String(count);
    head.appendChild(number);
  }
  if (role === 'place') head.innerHTML = PLACE_GLYPHS[glyph ?? 'flag'];
  if (role === 'listing') {
    // The classic dot in the opposite colour: it flips with the fill, so a selected pin reads as
    // selected at a glance rather than as an empty head.
    const dot = doc.createElement('span');
    dot.className = 'fredy-pin__dot';
    head.appendChild(dot);
  }
  element.appendChild(head);
  return element;
}
