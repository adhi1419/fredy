# Fredy modernization tasks

The canonical tracker is current through PR #52.

## Completed architecture and delivery

- [x] Make Firestore the sole persistence implementation.
- [x] Replace Fredy sessions with direct Firebase bearer authentication and per-request allowlist enforcement.
- [x] Serve the frontend from GitHub Pages and keep Cloud Run API-only.
- [x] Fix exact-origin CORS and authenticated SSE across Pages → Cloud Run.
- [x] Rename the protected branch to `main`; enforce rebase-only linear history and automatic branch cleanup.
- [x] Combine validation into one Pull Request workflow while preserving `Check the source code` and `PR Gate`.
- [x] Combine Pages and Cloud Run production delivery into one conditional Deploy workflow.
- [x] Add parallel backend validation, cross-PR GHCR cache, exact candidate-image promotion, and linked application layers.
- [x] Reach a 44-second representative steady-state Cloud Run deployment.
- [x] Keep standard `node:22-trixie-slim` + CloakBrowser; reject a Fredy-owned base image.

## Completed upstream-surface cleanup

- [x] Remove MCP transports, OAuth/token surfaces, UI, dependencies, and tests.
- [x] Remove SQLite, migrations, native database dependencies, `/db`, and volume/config contracts.
- [x] Remove analytics phone-home and consent UI through PR #10.
- [x] Remove release polling, `/api/version`, and update banner through PR #12.
- [x] Remove in-app donation UI while preserving attribution, license, README sponsorship, and shared assets through PR #17.
- [x] Remove bundled What's New UI/data/state through PR #18.

## Architecture migration program

- [x] PR #19: Bun 1.3.14 and strict TypeScript foundation; Bun owns frontend CI/Pages, Yarn remains for Node backend/Docker.
- [x] PR #20: freeze pagination, similarity tombstone, deletion cascade, and travel-time projection behavior in Firestore contract tests.
- [x] PR #21: Firebase identity deep module — merged and deployed successfully.
- [x] PR #22: authenticated transport deep module — merged and deployed in 39 seconds.
- [x] PR #23: home-address/travel-time settings deep module — merged and deployed successfully.
- [x] Draft unified application lifecycle/provider capability architecture; publication remains pending the separate persistence-model gate.
- [x] PR #25: freeze the first Rust wire contract for health, Firebase auth, CORS, and SSE — merged; test/document-only change correctly did not deploy.
- [x] PR #27: extract listings state as the first strict TypeScript domain-state module — merged and deployed in 35 seconds.
- [x] PR #26: implement phase-one listing/application lifecycle unification with real production callers — merged and deployed successfully.
- [x] PR #33: define per-Saved-Search provider-source application policy with legacy compatibility and sensitive-field exclusion — merged and deployed to Cloud Run successfully in 59 seconds; execution cutover remains separate.
- [x] PR #39: cut automatic inquiry execution over to exact provider-source policy with capability and listing-eligibility checks — merged and deployed to Cloud Run successfully in 52 seconds.
- [x] PR #29: freeze provider, notification, and schedule Rust parity contracts — merged; test/document-only change correctly did not deploy.
- [x] PR #28: expose conservative provider application capabilities and listing-dependent eligibility — merged and deployed successfully in 61 seconds.
- [x] PR #30: extract Saved Searches state as the next strict TypeScript domain module — merged and deployed successfully in 39 seconds.
- [x] PR #32: extract the complete user-settings state/effect contract as the next strict TypeScript domain module — merged and deployed to Pages successfully in 47 seconds.
- [x] PR #36: freeze the remaining Cloud Run deployment and Rust cutover contract — merged; test/document-only change correctly did not deploy.
- [x] PR #35: extract finance state as the next strict TypeScript domain module — merged and deployed to Pages successfully in 48 seconds.
- [x] PR #38: extract notification adapter/channel state as the next strict TypeScript domain module — merged and deployed to Pages successfully in 51 seconds.
- [ ] Continue splitting frontend state into deep domain modules while preserving selector/action compatibility.
- [x] PR #41: migrate the deep Home URL/query/lifecycle model into the path-sorted strict TypeScript seam — merged and deployed to Pages successfully in 44 seconds.
- [ ] Migrate remaining nonvisual frontend services, state, and hooks to strict TypeScript in small PRs.
- [x] PR #42: implement the first executable Rust health route and parity test behind the frozen contract without production cutover — merged after native fmt/check/test/clippy validation; correctly did not deploy.
- [x] PR #46: implement dormant Rust `/api/auth/config` parity with exact public wire behavior and no production cutover — merged after native fmt/check/test/clippy validation; correctly did not deploy.
- [ ] Replace remaining backend route groups incrementally with Rust behind frozen contracts; avoid a big-bang rewrite.
- [x] Keep `FredyPipelineExecutioner` architectural refactoring explicitly out of this program; only separately approved feature integration may touch it.

## Selected UX direction

- [x] Use exactly two primary destinations: Home and Saved Searches.
- [x] Use Quiet feed as Home's default and List + map as a state-preserving alternate view.
- [x] Keep New, Applied, Viewed, and Archived mutually exclusive; add Archive as a listing action.
- [x] Add provider multi-select and sorting by newest, travel time, distance, price, and size.
- [x] Reduce the account menu to My account, optional Admin panel, and Sign out.
- [x] Freeze Home/Saved Searches navigation at the bottom on mobile.
- [x] Freeze mobile listing CTAs above navigation: Apply on the left, Google Maps icon in the middle, Open listing icon on the right.
- [x] Make Applied open a scrollable popover containing the submitted application message.
- [x] Apply operator-directed post-approval polish and validate CTA order as Apply → Google Maps → Open listing.
- [x] Unify provider/manual application outcomes with listing status; include I applied myself, notes, viewing, and archive actions.
- [x] Use a guided Saved Search add/edit flow and a minimal mobile Step N of 4 indicator.
- [x] Use compact heading regions everywhere except the Saved Searches index.
- [x] Consolidate the interactive artifact from three competing options into one selected hybrid direction.
- [x] Exercise all Feed/List+map × New/Applied/Viewed/Archived states plus Saved Searches, Listing, guided Search, and Account surfaces.
- [x] Validate self-contained HTML, inline JavaScript, light/dark, desktop/mobile, compact headings, one-handed CTA order, and HTTP 200 preview serving.
- [x] Deliver the current self-contained HTML and visual evidence through the dashboard because the work-host loopback URL is not reachable from macOS Firefox.
- [ ] Complete future Connect account interaction; provider capabilities are merged in PR #28 and source policy is merged in PR #33.
- [x] Perform final human interaction review and approve the UX specification — approved by the operator on 2026-09-19.
- [x] Freeze the approved decision document and interactive HTML for rebase-auto-merge publication.
- [x] PR #24: merge the approved simplified two-tab UX specification.
- [x] PR #31: merge operator-directed Google Maps CTA and Applied-message popover refinement.

## After UX approval

- [x] PR #34: publish the implemented, parent-validated, and isolated-review-corrected two-tab shell/account entry points — merged and deployed to Pages successfully in 42 seconds.
- [x] PR #40: implement Home Quiet feed with state-preserving List + map, exclusive activity, provider multi-select, and sorting — merged and deployed to Pages and Cloud Run successfully in 63 seconds.
- [x] PR #37: implement one-handed mobile listing detail and unified lifecycle actions — merged and deployed to Pages successfully in 34 seconds.
- [x] PR #43: implement the four-step guided Saved Search add/edit flow with per-source application policy controls — merged and deployed to Pages successfully in 51 seconds.
- [x] PR #44: apply and visually validate the final Paper/forest styling through centralized theme tokens only — merged and deployed to Pages successfully in 38 seconds.
- [x] Run accessibility, responsive, and new-user usability review with screenshots/recordings — rendered audit complete and verified fixes shipped in PRs #48–#49.
- [x] PR #49: publish verified accessibility fixes — merged and deployed to Pages successfully in 43 seconds; live frontend returned HTTP 200.
- [x] PR #48: publish verified responsive fixes — merged and deployed to Pages successfully in 40 seconds; live frontend returned HTTP 200.

## Last-mile product work

- [x] PR #45: add mandatory applicant-profile setup after first registration while keeping My account edit-only afterward — merged via rebase and deployed to Pages and Cloud Run successfully in 65 seconds; all live probes returned HTTP 200.
- [x] Rewrite the customer README for the finished product — PR #50.
- [x] Capture final product screenshots only from the finished UI — PR #52.
- [x] Create and link a separate developer/operator guide — PR #51.
