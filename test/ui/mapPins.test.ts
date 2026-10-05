/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it } from 'vitest';
import { createPinElement, PLACE_GLYPHS, type PinDocument } from '../../ui/src/components/map/pins.js';

/** Just enough of an element for the factory: attributes, children, text and innerHTML. */
class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  className = '';
  title = '';
  textContent = '';
  innerHTML = '';
  constructor(readonly tagName: string) {}
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  appendChild(child: FakeElement) {
    this.children.push(child);
  }
}

const doc: PinDocument = { createElement: (tag) => new FakeElement(tag.toUpperCase()) as unknown as HTMLElement };
const build = (options: Parameters<typeof createPinElement>[0]) =>
  createPinElement(options, doc) as unknown as FakeElement;

describe('createPinElement', () => {
  it('makes result pins real buttons that report their pressed state', () => {
    const pin = build({ role: 'listing', label: 'Ruhige 1-Zimmer', interactive: true });
    expect(pin.tagName).toBe('BUTTON');
    expect(pin.getAttribute('type')).toBe('button');
    expect(pin.className).toBe('fredy-pin fredy-pin--listing');
    expect(pin.getAttribute('aria-pressed')).toBe('false');
    expect(pin.getAttribute('aria-label')).toBe('Ruhige 1-Zimmer');
    expect(pin.title).toBe('Ruhige 1-Zimmer');
    expect(pin.children[0].className).toBe('fredy-pin__head');
    expect(pin.children[0].children).toHaveLength(0);
  });

  it('puts the count in the head of a group pin as an element, so it can be turned upright', () => {
    const pin = build({ role: 'group', count: 3, label: '3 homes here', interactive: true });
    expect(pin.className).toBe('fredy-pin fredy-pin--group');
    expect(pin.children[0].children[0].textContent).toBe('3');
  });

  it('makes place pins decorative images carrying the requested glyph', () => {
    const work = build({ role: 'place', glyph: 'work', label: 'Work' });
    expect(work.tagName).toBe('DIV');
    expect(work.getAttribute('role')).toBe('img');
    expect(work.children[0].innerHTML).toBe(PLACE_GLYPHS.work);
    expect(build({ role: 'place', label: 'Gym' }).children[0].innerHTML).toBe(PLACE_GLYPHS.flag);
  });
});
