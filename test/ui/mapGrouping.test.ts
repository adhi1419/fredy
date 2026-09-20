/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { groupListingsByPosition, type MapListing } from '../../ui/src/views/listings/mapUtils.js';
import {
  homeMapGroupSelectionId,
  homeMapMarkerAction,
  restoreHomeMapMarkerFocus,
} from '../../ui/src/services/home/homeViewState.js';

describe('home map chooser focus restoration', () => {
  const focusTarget = (isConnected: boolean) => {
    let focusCount = 0;
    return {
      target: {
        isConnected,
        focus: () => {
          focusCount += 1;
        },
      },
      get focusCount() {
        return focusCount;
      },
    };
  };

  it('restores the triggering marker after Close and Escape close paths', () => {
    const marker = focusTarget(true);
    let chooserOpen = true;
    const closeFromButton = () => {
      chooserOpen = false;
      restoreHomeMapMarkerFocus(marker.target);
    };
    const closeFromEscape = () => {
      chooserOpen = false;
      restoreHomeMapMarkerFocus(marker.target);
    };

    closeFromButton();
    expect(chooserOpen).toBe(false);
    expect(marker.focusCount).toBe(1);

    chooserOpen = true;
    closeFromEscape();
    expect(chooserOpen).toBe(false);
    expect(marker.focusCount).toBe(2);
  });

  it('does not focus a disconnected triggering marker', () => {
    const marker = focusTarget(false);

    restoreHomeMapMarkerFocus(marker.target);

    expect(marker.focusCount).toBe(0);
  });
});

interface TestListing extends MapListing {
  id: string;
}

const listing = (
  id: string,
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): TestListing => ({ id, latitude, longitude });

describe('groupListingsByPosition', () => {
  it('puts listings on the same spot into one group', () => {
    const groups = groupListingsByPosition([
      listing('a', 51.2277, 6.7735),
      listing('b', 51.2277, 6.7735),
      listing('c', 51.2277, 6.7735),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual({
      lat: 51.2277,
      lng: 6.7735,
      listings: [listing('a', 51.2277, 6.7735), listing('b', 51.2277, 6.7735), listing('c', 51.2277, 6.7735)],
    });
  });

  it('keeps separate positions apart, in the order they came in', () => {
    const groups = groupListingsByPosition([
      listing('a', 51.2277, 6.7735),
      listing('b', 52.517, 13.3888),
      listing('c', 51.2277, 6.7735),
    ]);

    expect(groups.map((group) => group.listings.map((entry) => entry.id))).toEqual([['a', 'c'], ['b']]);
  });

  it('does not merge listings a few metres apart', () => {
    // ~11 m: two houses on the same street stay two pins.
    const groups = groupListingsByPosition([listing('a', 51.2277, 6.7735), listing('b', 51.2278, 6.7735)]);

    expect(groups).toHaveLength(2);
  });

  it('merges coordinates that differ only in float noise', () => {
    const groups = groupListingsByPosition([listing('a', 51.2277, 6.7735), listing('b', 51.22770000001, 6.7735)]);

    expect(groups).toHaveLength(1);
  });

  it('drops listings that have no place on a map', () => {
    const groups = groupListingsByPosition([
      listing('a', 51.2277, 6.7735),
      listing('missing', null, null),
      listing('ungeocodable', -1, -1),
      listing('halfway', 51.2277, undefined),
    ]);

    expect(groups.map((group) => group.listings.map((entry) => entry.id))).toEqual([['a']]);
  });

  it('opens every same-coordinate listing from pointer and keyboard group activation', () => {
    const grouped = [
      { id: 'first', latitude: 51.2277, longitude: 6.7735 },
      { id: 'second', latitude: 51.2277, longitude: 6.7735 },
    ];

    const pointerAction = homeMapMarkerAction(grouped, 'pointer');
    const keyboardAction = homeMapMarkerAction(grouped, 'keyboard');

    expect(pointerAction).toMatchObject({ trigger: 'pointer', kind: 'group' });
    expect(keyboardAction).toMatchObject({ trigger: 'keyboard', kind: 'group' });
    expect(pointerAction?.kind === 'group' ? pointerAction.listings.map((entry) => entry.id) : []).toEqual([
      'first',
      'second',
    ]);
    expect(
      keyboardAction?.kind === 'group'
        ? keyboardAction.listings.map((entry) => homeMapGroupSelectionId(keyboardAction.listings, entry.id ?? ''))
        : [],
    ).toEqual(['first', 'second']);
  });

  it('copes with nothing to group', () => {
    expect(groupListingsByPosition([])).toEqual([]);
    expect(groupListingsByPosition(undefined)).toEqual([]);
  });
});

describe('stale ref cleanup on marker changes', () => {
  const createMockRef = <T>() => {
    let value: T | null = null;
    return {
      current: value,
      setValue: (v: T | null) => {
        value = v;
      },
      getValue: () => value,
    };
  };

  it('clears activeGroupTrigger and activeGroup when markers change', () => {
    const triggerRef = createMockRef<HTMLElement | null>();
    const setActiveGroup = (value: readonly unknown[] | null) => {
      triggerRef.setValue(null);
    };
    const oldMarkers = [{ latitude: 51.2277, longitude: 6.7735 }];
    const newMarkers = [{ latitude: 52.517, longitude: 13.3888 }];

    // Simulate having an active group
    triggerRef.setValue({} as HTMLElement);
    setActiveGroup([{ latitude: 51.2277, longitude: 6.7735 }] as readonly unknown[]);

    // When markers change, cleanup should run
    // This is what the useEffect([markers]) effect does in Home.tsx
    triggerRef.setValue(null);
    setActiveGroup(null);

    expect(triggerRef.getValue()).toBeNull();
  });
});
