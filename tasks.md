# Fredy modernization tasks

The canonical tracker is current through PR #60 and records the reopened UI convergence plus complete TypeScript/Rust migration goals.

## Reopened after customer review

- [x] Audit every production route against the approved wireframes at rendered component level — Luna audit confirmed a real behavioral migration over materially reused legacy visible components; Saved Searches is the clearest mismatch.
- [ ] Replace materially reused legacy Fredy components with the approved wireframe components in small, independently deployable PRs; preserve the two-destination information architecture and validated accessibility behavior.
- [x] Make Saved Search and associated listing visibility owner-or-explicit-share only for every role, including admins; retain read-only partner sharing — PR #54 rebase-merged as `b30e4d9`; combined Pages + Cloud Run deployment succeeded in 60 seconds and live frontend/API health returned HTTP 200.
- [x] Present Saved Search sharing as “Share with your partner” and allow any other account to be selected explicitly, independent of admin role — implemented and parent-validated in PR #54, rebase-merged as `b30e4d9`.
- [x] Restrict Quiet-feed provider controls to providers that have accessible listings for the current user, while preserving a selected provider long enough to clear it — PR #53 merged and deployed Pages-only in 48 seconds; live frontend and backend health returned HTTP 200.
- [ ] Complete the TypeScript and Rust migration program defined below; narrow seams and dormant parity routes are milestones, not completion.

## Wireframe convergence sequence

Each visible replacement must preserve its existing deep behavior modules and accessibility contracts, delete the legacy presentation boundary it replaces, and migrate every touched production component/test to strict TypeScript/TSX.

- [x] Slice 1 — replaced the legacy `JobGrid`/`JobsTable` Saved Searches index with the approved name/criteria/state/last-run/contextual-action rows; deleted obsolete production imports while preserving SSE/run/pause/edit/clone/delete/shared-read-only behavior. PR #57 rebase-merged as `73c9a0c`; independent zero-context review passed the real-mock direct/overflow actions, disabled running/read-only states, status-only state, provider selection/save, desktop/mobile containment, and console cleanliness. Combined Pages + Cloud Run deployment run 35499492377 succeeded in 110 seconds; live Pages and API `/health` returned HTTP 200, and the served bundle contains the approved Slice 1 copy.
- [ ] Slice 2 — replace Home's generic `Headline` and legacy Quiet rows with the approved local heading and photo-led card-light composition; migrate `Home.jsx` to TSX while preserving the single URL/query/listing state — implementation worker `f36c9e78` and compiler/freshness correction `cd85d60a` completed on `feat/home-quiet-tsx`. Independent reviewer `a17416b8` found 32px action targets and dropped listing-return context. Operator screenshot review adds exact blocking fidelity requirements: remove the Search submit button; use icon-only list and map view controls with accessible labels, never “Quiet mode”/“List + map”; match approved fonts/colors and green selected states; use the approved provider multiselect; match mobile profile icon/colors; and compact mobile controls/cards enough to show roughly 3–4 results on landing. Full fidelity correction worker `44be7474` is active; independent re-review remains required before publication.
- [ ] Slice 3 — converge Home List + map framing and decision rows without creating a second map or listing query; preserve marker keyboard access and all Home state across view switches.
- [ ] Slice 4 — replace `ProviderTable` in guided Saved Search with provider-choice cards showing URL, capability, connection/profile readiness, and source-local application policy; keep the four-step controller and payload seam.
- [ ] Slice 5 — replace the listing-detail outer Semi card/grid/header cluster with the approved Fit/evidence/activity/action-rail composition; preserve inquiry safety, lifecycle, map/transit, notes, and the validated mobile dock. Replace the current listing-source link icon with the approved diagonal outbound-arrow icon as an isolated fidelity fix before or with this slice — worker `a3b3a7bc` completed in `fix/listing-outbound-icon`; both changed files passed parent review and rendered desktop/mobile evidence, and publication validation is pending.
- [ ] Slice 6 — replace the personal `SettingsShell` heading/tab/card grammar with the approved My account composition while preserving deep links and one account-menu destination.
- [ ] Slice 7 — migrate personal settings pages and then optional Admin pages away from page-local `SegmentPart` presentation, one independently deployable page group at a time; preserve admin guards, backup/debug safety, and shared unsaved admin state.
- [x] Keep applicant onboarding and the mobile bottom navigation/action dock stable unless later rendered evidence identifies a concrete mismatch; their defined contracts already match.

## TypeScript and Rust migration completion target

Current baseline after PR #60:

- TypeScript: 19 `.ts`/`.tsx` files under `ui/src` (including declaration boundaries and `vite-env.d.ts`) versus 143 `.js`/`.jsx` files; separate strict browser-source and Node-aware frontend-test compiler configurations are active.
- Rust: dormant `/health`, `/api/auth/config`, and real Firebase `/api/auth/me`; 0% of production traffic.
- Production authority: Node owns the Cloud Run process, API, Firebase authorization, Firestore access, scheduling, providers, notifications, and SSE.

Completion means all of the following:

- [ ] Migrate all frontend application source and frontend tests to strict TypeScript/TSX, leaving JavaScript only for explicitly audited build/tool configuration that cannot reasonably move — future migration PRs should convert roughly 10 cohesive source/test files per domain batch when dependencies permit, rather than continuing one- or two-file slices.
- [x] Keep each TypeScript conversion behind a real domain/component boundary with executable behavior tests; do not create shallow pass-through seams or one mechanical mega-PR — `listingFilters.ts` shipped in PR #55 and `guidedSearchForm.ts` shipped in PR #58 (`a993bdd`, Pages-only run 35500637948, 39 seconds), both with live Pages/API HTTP 200. The `providerUrl` source/test migration rebase-merged in PR #59 as `366d27e` and deployed Pages-only in 83 seconds via run 35501384403. The real `jobValidation` domain/test migration rebase-merged in PR #60 as `0022fe9` and deployed Pages-only in 48 seconds via run 35501710228. Live Pages/API returned HTTP 200 after both deployments.
- [ ] Tighten the frontend compiler/CI boundary as migration advances so converted code cannot silently fall back to `any` or unchecked JavaScript.
- [ ] Implement Rust Firebase bearer verification, per-request Firestore allowlist enforcement, exact-origin CORS, authenticated SSE, and the frozen HTTP error contract — dormant `/api/auth/me` with real RS256/X.509, bounded cert/OAuth/unknown-key caches, Firestore REST + emulator contracts, exact bearer/error/CORS parity, and a Rust-1.85-compatible lock graph shipped in PR #56, rebase-merged as `be1e069`; no deployment run was created because Rust remains excluded from production inputs, and live Pages/Node API health stayed HTTP 200. After two no-change worker failures, cwd-pinned worker `941395e8` implemented the dormant SSE route/broker with native tests and no lock/deployment changes. Parent review found two blockers: the `"*"` broadcast sentinel can collide with a valid Firebase UID and leak targeted events cross-tenant, and the listener spawns unbounded pre-auth threads with no initial read timeout/cap. Correction worker `5b7dd04b` removed the wildcard sentinel and added bounded admission/read timeout. Fresh parent review found two remaining blockers: the production initial-read timeout is hardcoded to an unsafe 100ms, and the global admission permit is held for long-lived SSE so 128 streams can starve health/auth/API traffic. A production-safe injected timeout and separate/reserved SSE capacity are pending; Rust still owns 0% production traffic.
- [ ] Implement Rust Firestore persistence adapters behind the characterized job/listing/settings/channel/application contracts before cutting over dependent routes.
- [ ] Strangle Node route groups incrementally into Rust with parity tests, explicit traffic ownership, observability, and per-route rollback.
- [ ] Migrate scheduling, provider orchestration, notification delivery, and inquiry safety only after their executable contracts pass natively; move CloakBrowser/browser-heavy providers last.
- [ ] Make the Rust binary the authoritative Cloud Run entrypoint and remove the Node production runtime only after full provider, notification, persistence, auth, SSE, and schedule parity is verified.
- [ ] Keep the broad `FredyPipelineExecutioner` refactor out of scope unless a later independently approved design replaces it behind existing contracts.

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
- [x] PR #44: establish and visually validate the centralized Paper/forest token baseline — merged and deployed to Pages successfully in 38 seconds; component-level wireframe convergence remains open.
- [x] Run accessibility, responsive, and new-user usability review with screenshots/recordings — rendered audit complete and verified fixes shipped in PRs #48–#49.
- [x] PR #49: publish verified accessibility fixes — merged and deployed to Pages successfully in 43 seconds; live frontend returned HTTP 200.
- [x] PR #48: publish verified responsive fixes — merged and deployed to Pages successfully in 40 seconds; live frontend returned HTTP 200.

## Last-mile product work

- [x] PR #45: add mandatory applicant-profile setup after first registration while keeping My account edit-only afterward — merged via rebase and deployed to Pages and Cloud Run successfully in 65 seconds; all live probes returned HTTP 200.
- [x] Rewrite the customer README for the current shipped product — PR #50; revise product-fidelity wording as convergence slices land.
- [x] Capture current production-state screenshots — PR #52; these are baseline evidence of the remaining visual convergence gaps.
- [x] Create and link a separate developer/operator guide — PR #51.
