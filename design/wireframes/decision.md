# Fredy simplified UX wireframes

**Status:** APPROVED AND FROZEN.

**Approval:** APPROVED by the operator on 2026-09-19.

## Approval record

The operator approved this specification after desktop/mobile, light/dark, Home feed/map, listing lifecycle, account menu, and guided Saved Search review. Production implementation must match this document and the interactive HTML. Any change to primary navigation, Home activity states, mobile frozen actions, or the guided flow requires a new explicit design decision.

## Decision already made

Fredy has exactly two primary destinations:

1. **Home** — the former Dashboard and Listings surfaces become one continuous discovery and decision loop.
2. **Saved Searches** — create, edit, run, pause, and repair searches.

Settings and Administration live behind the account menu. Listing detail and search editing remain deep-linkable routes, but they do not become primary tabs. Critical operational states such as active debug capture or stopped execution may appear beside the account control; routine settings may not compete with the core navigation.

The earlier Command center, Discovery canvas, and Guided journey options were rejected as too cluttered because they preserved too many route-shaped destinations and controls. They are superseded by this round.

## Fixed product journey

1. Open **Home** and see new or saved homes.
2. Filter or change the representation without navigating to a separate listings section.
3. Open a home while preserving filter, scroll, and map state.
4. Assess affordability, commute, transit, source facts, notes, and guarded inquiry readiness.
5. Return to the same Home context or continue to the next home.
6. Open **Saved Searches** only when creating, editing, pausing, running, or repairing a search.
7. Open personal or administrative controls from the account menu.

The numbers and listing names in the HTML are illustrative fixtures, not product metrics. The artifact remains offline and uses the approved Paper/forest light and near-black/sage dark directions.

## Selected Home — Quiet feed + List and map

Home opens as a chronological, card-light Quiet feed. One inline attention row appears only when a Saved Search needs action. The operator can switch to a synchronized List + map view without leaving Home or losing activity, provider, sorting, or search state.

The search controls are intentionally layered:

1. free-text search
2. mutually exclusive activity: **New**, **Applied**, **Viewed**, or **Archived**
3. multi-select provider filter
4. sort by newest, travel time, distance, price, size, and later compatible listing fields
5. Feed or List + map representation

Archived is a user lifecycle action, not a separate deletion mechanism. The Review-one concept is not a default Home layout; focused review may return later as an optional flow if evidence supports it.

**Selected because:** it combines the calm default of Quiet feed with the spatial leverage of List + map while keeping one Home route and one filter state.

## Shared surfaces

### Saved Searches

A simple list shows search name, criteria, state, last run, and one contextual action. Results always return to Home. Search creation begins with a provider URL; rules and delivery unfold only after recognition.

### Listing detail

Listing detail preserves Home query, selected representation, map position, and scroll context. Fit appears first; route/transit and source evidence reveal progressively. The guarded inquiry action remains explicit and never retries an unknown outcome automatically.

### Account menu

The account menu has at most three actions:

1. **My account** — rolls personal preferences, travel and addresses, affordability, notifications, inquiry profile, theme, and language into one destination.
2. **Admin panel** — appears only for administrators and rolls execution, connectivity, users, access, backup, and debug into one destination.
3. **Sign out**.

Only critical state such as active debug capture or stopped execution may add a compact warning beside the account control. Individual preferences never become menu items.

## Heading density

Every product surface except the Saved Searches index uses a compact heading: small context label, short title, one-line explanation, and only a minimal action when required. Listing detail, Home, guided search steps, and account/admin pages may not reserve a large hero-like header region. Saved Searches may retain a larger heading because it is the management entry point and carries Create search.

## One-handed mobile listing contract

Mobile primary navigation is frozen at the bottom, not the top. Listing detail has a second frozen action row immediately above it:

- primary **Apply** action on the left
- icon-only **Open in Google Maps** in the middle, with an accessible label
- icon-only **Open provider listing** on the right, with an accessible label

The listing owns one lifecycle: New, Applied, Viewed, Archived, offer, or rejected. A confirmed provider application automatically moves the listing to **Applied**. The Apply control becomes **Applied** and opens a scrollable popover containing the submitted application message; the message is evidence attached to the applied listing rather than another status. The same screen provides **I applied myself**, **Add notes**, and **Got a viewing**, and **Archive**; these update that lifecycle instead of maintaining a separate inquiry status.

## Guided Saved Search and provider capability model

Add and edit use one guided flow:

1. Providers and search URLs
2. Home criteria
3. Real-world fit: commute and affordability
4. Delivery and review

The wireframe models the technical direction as:

- each Saved Search may contain multiple provider sources
- auto-apply policy is enabled independently for each provider source
- every resulting job-listing owns its application lifecycle and delivery attempt outcome
- provider capability metadata declares whether applications are supported and whether an account connection is required
- future providers may expose a **Connect account** action without changing the Saved Search flow

This replaces the current single job-level auto-apply boolean. It remains a model hypothesis until the exact Saved Search → provider source → job-listing relationship is confirmed.

## Responsive contract

Desktop opens in Quiet feed and may switch to List + map. Mobile freezes Home and Saved Searches at the bottom for one-handed reach, keeps Home list-first, stacks listing evidence, and freezes Open listing + Apply above primary navigation. Touch targets remain at least 44 CSS pixels in production and respect the safe-area inset.

Loading reserves the selected Home shape. Empty states retain the minimum search/filter context and lead to **Create search**. Errors preserve successful listing data and offer local recovery. A broken search cannot block other searches or Home.

## Route and migration contract

Visible navigation changes do not require destructive route changes. Existing listing, job/search, settings, and admin deep links should resolve into the new shell. The Bun/TypeScript migration should first define typed contracts for authenticated transport, Home listings, Saved Searches, provider capabilities, unified listing/application lifecycle, user settings, and account/admin scope. Broad TSX conversion and final Paper/forest production styling wait for explicit selection of the Home option.

## Implementation boundary

The UX specification is approved. The separate persistence decision for provider-source auto-apply policy and per-job-listing lifecycle remains an architecture-program gate; its implementation may not alter the approved navigation, activity labels, frozen mobile actions, or guided flow without renewed UX approval.
