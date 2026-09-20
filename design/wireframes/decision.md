# Fredy holy-grail wireframe revision

**Status:** APPROVED AND FROZEN — DIRECTION A · STAY CARDS.

**Approval:** Direction A signed off by the operator on 2026-09-20.

**Supersedes:** the 2026-09-19 visual specification. Direction A, with Fredy’s forest/sage palettes and Airbnb-style layout patterns, is now the production visual authority.

## Why the design was reopened

The operator requested one coherent product pass rather than incremental changes against the prior wireframe:

- repurpose listing state symbols for **Applied** and **Viewed** and use the same vocabulary in Home filters
- replace destructive listing removal with **Archive**
- remove **Watch** and generic **Status** entries
- manage lifecycle only through explicit lifecycle actions
- replace affordability in the listing’s primary card/widget with travel time and distance
- make Saved Search runs idempotent repair passes that reconcile missing data and safely perform missed actions
- make the whole Saved Search card open Edit; remove Edit from overflow
- keep only one Create Search entry, at the bottom of Saved Searches
- move the visual language toward Airbnb-style marketplace clarity: photo-first, airy, rounded, direct, and mobile-friendly

The self-contained source of truth is `design/wireframes/index.html`. It exposes all three candidates in one script-free comparison board, including Home, Saved Searches, Listing Detail, responsive behavior, and the idempotent run contract.

## Product structure that remains fixed

Fredy retains exactly two primary destinations:

1. **Home** — listings, activity filters, provider filtering, sorting, and feed/map representations.
2. **Saved Searches** — create, edit, run, pause, duplicate, and repair searches.

Listing Detail and Edit Search remain deep routes. Personal settings and Administration remain behind the account control. A visible status must describe something actionable; routine technical state does not compete with primary navigation.

## New non-negotiable behavior contract

### One listing lifecycle

A listing has one lifecycle state used everywhere:

- **New** — no explicit symbol on the card; appears in the New filter.
- **Applied** — check-in-circle symbol and Applied label; appears in the Applied filter.
- **Viewed** — eye symbol and Viewed label; appears in the Viewed filter.
- **Archived** — archive symbol only where history needs it; appears in the Archived filter and leaves the active feed.

The symbol, Listing Detail state, and Home filter state are three views of the same persisted value. They may not drift or be maintained as separate booleans.

The only user-facing lifecycle mutations are:

1. **Mark applied**
2. **Mark viewed**
3. **Archive**

There is no Watch action, generic Status action, or Delete action in listing UI. Archive is reversible through Archived history. A provider-confirmed inquiry may set Applied automatically. Submitted inquiry text is evidence attached to Applied, not another status.

### Travel replaces affordability in the listing’s primary presentation

Listing cards and the first Listing Detail fact show the selected reference route:

- travel duration
- travel distance
- reference label, such as Work
- mode or route freshness when useful

Example: **12 min · 3.8 km to Work**.

Affordability is removed from the listing’s primary card/widget. It may remain in deeper criteria, filters, or evidence only if later implementation scope preserves it; it must not displace route usefulness in the main listing scan.

### Saved Search cards are direct edit targets

- Clicking the body of a Saved Search card opens Edit Search.
- Edit is absent from the overflow menu.
- The overflow menu may contain Run & repair, Pause/Resume, and Duplicate.
- A dedicated Run & repair button may remain visible on desktop; mobile may keep it in overflow when space is constrained.
- Search results still return to Home.

### One Create Search entry

Saved Searches has no Create Search action in the page heading. The only Create Search entry is the bottom creation card, after existing searches. Empty state uses that same creation card rather than introducing a second control.

## Idempotent Saved Search run contract

Every manual or scheduled run is a repeatable **search + reconcile + act** pass. Re-running the same search over the same listing must repair incomplete state without creating duplicate external effects.

### Repairable listing fields

Each run recomputes and reconciles at least:

1. **Location** — normalized address, geocode, coordinates, and route-dependent location data where inputs are available.
2. **Inquiry text** — regenerate or restore the deterministic intended message when it is missing or stale, while preserving immutable submitted evidence.
3. **Notification status boolean** — reconcile whether notification work is complete from the action ledger rather than trusting a stale flag.

Repairs are field-scoped and preserve owner, lifecycle, notes, submitted evidence, and unrelated user edits.

### Previously missed actions

A run may perform an action that was previously missed only when its action ledger proves one of these states:

- never attempted
- explicitly failed before an external side effect
- externally idempotent under the same stable action key

Every external action uses a stable identity derived from search, listing, action type, and intended payload/version. The completed action record is written durably so the next run becomes a no-op.

An **unknown external outcome is not “missed.”** It remains a visible manual-review item and is never retried blindly. This preserves the existing rule against duplicate provider inquiries or duplicate notifications when the remote side may already have accepted the first request.

### Run result presentation

Run & repair summarizes outcomes rather than exposing implementation steps as controls:

- listings discovered
- locations repaired
- inquiry text restored
- notification state reconciled
- missed actions completed safely
- unknown outcomes requiring review

A failure on one listing does not block repair or discovery for other listings. Repeating the run must be safe.

## Candidate visual directions

All three candidates implement the same behavior above. Selection is only about layout, density, and emphasis.

### Direction A — Stay cards (selected)

**Desktop:** a three-column, photo-first marketplace grid with a large rounded search bar, pill filters, restrained listing metadata, and Applied/Viewed symbols floating over imagery.

**Mobile:** one generous card per row, horizontal lifecycle filter pills, bottom primary navigation, and the existing one-handed Listing Detail dock.

**Saved Searches:** full-width rounded cards with direct edit behavior; Run & repair is visible on desktop; the only Create Search card closes the list.

**Why recommend it:** it is the clearest expression of the requested Airbnb-style direction, creates the fastest visual scan, and requires the least new interaction grammar. Travel distance fits naturally into secondary card facts without clutter.

**Trade-off:** fewer listings are visible above the fold than in Direction C.

### Direction B — Map explorer

**Desktop:** compact listing cards in a left rail and a persistent map on the right. Price pins and the selected listing remain synchronized. Lifecycle symbols and travel distance stay in the list.

**Mobile:** list-first; the map becomes an explicit view rather than a split layout.

**Saved Searches and Edit Search:** same direct-edit/idempotent-run contract as Direction A.

**Why choose it:** strongest when location is the primary decision factor.

**Trade-off:** more visual weight and higher implementation/testing cost; less calm for users who mostly scan new listings.

### Direction C — Editorial stays

**Desktop:** a narrower, denser vertical list with wide landscape thumbnails, larger editorial titles, square-ish controls, and stronger comparison rhythm.

**Mobile:** compact single-column cards designed to show more listings per screen.

**Saved Searches:** flatter rows with less card chrome while retaining direct edit and one bottom Create Search card.

**Why choose it:** highest information density and fastest keyboard/desktop comparison.

**Trade-off:** least recognizably Airbnb-style and less visually immersive than Direction A.

## Shared surface specification

### Home

Home keeps one query model and offers:

1. free-text search
2. mutually exclusive New, Applied, Viewed, and Archived filters
3. provider multi-select
4. sort by newest, travel time, distance, price, and size
5. feed or map representation

Applied and Viewed filter pills reuse the same check/eye icon language as listing symbols. There is no Watch filter and no separate generic status filter.

### Listing cards

A card contains:

- listing image
- Applied or Viewed symbol when relevant
- title and district
- price
- rooms/size summary
- selected travel duration and distance
- provider/rating only when useful
- explicit lifecycle overflow containing Mark applied, Mark viewed, and Archive

The image/title opens Listing Detail. No heart/watch affordance is shown.

### Listing Detail

The first decision evidence is travel duration and distance. Lifecycle actions appear together and mutate the one lifecycle. Applied opens submitted inquiry evidence. Unknown inquiry outcomes remain visible and require review.

The mobile dock remains:

- Apply or Applied on the left
- icon-only Open in Google Maps
- icon-only Open provider listing

### Saved Searches

The heading contains title and explanation only. Existing search cards follow immediately. Each card shows:

- name and concise criteria
- run health and last-run time
- whether manual review is needed
- the promise that every run repairs incomplete listing work

Clicking the card opens Edit Search. The bottom Create Search card is the sole creation entry.

### Edit Search

The existing four-step flow remains:

1. Providers and search URLs
2. Home criteria
3. Real-world fit
4. Delivery and review

Edit Search explains that Save & run repair applies changed intent to future matches and safely reconciles prior listings. It does not imply that unknown external outcomes will be retried.

## Airbnb-style design language

The selected direction should use marketplace principles rather than copy Airbnb branding. “Airbnb-style” applies only to layout, density, imagery, spacing, cards, pills, and interaction patterns. Fredy's established Paper/forest light palette and near-black/sage dark palette remain authoritative:

- photo-first hierarchy
- rounded cards and pill controls
- generous whitespace
- short plain-language labels
- dark neutral text and restrained borders
- Fredy's deep forest action accent with sage supporting tones
- price and route facts optimized for scanning
- motion limited to small hover/focus/selection transitions

Fredy remains visibly Fredy. Existing attribution, privacy, accessibility, light/dark support, and source-available license presentation remain unchanged.

## Responsive and accessibility contract

- Touch targets are at least 44 CSS pixels.
- Controls have visible focus and semantic labels.
- State is never color-only; Applied, Viewed, and Archived each pair icon and text.
- Cards remain operable by keyboard without nesting conflicting interactive elements in production.
- Desktop may use a split map; mobile is list-first.
- Mobile primary navigation remains fixed at the bottom and respects safe-area insets.
- Loading reserves the selected layout. Errors preserve successful listing data and offer local recovery.

## Approval and implementation authority

The operator selected **A · Stay cards** after reviewing the complete comparison board. Directions B and C remain rejected alternatives, not implementation targets.

Implementation must now:

1. Treat Direction A as **APPROVED AND FROZEN**.
2. Treat the Direction A section as the visual authority.
3. Update the modernization roadmap and implementation slices against it.
4. Re-scope any queued PR whose UI assumptions conflict with this revision.
5. Implement behavior contracts behind executable lifecycle and idempotency tests before claiming visual completion.

**Approval record:** Direction A is signed off. Preserve Fredy’s forest/sage semantic color roles: inactive dark-mode activity pills use sage/green text; the selected pill uses deep forest fill with white text.
