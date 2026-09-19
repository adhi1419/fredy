# Rust plugin contract

This contract freezes the externally observed plugin boundaries needed for Rust parity. The shared
fixture is [`test/contract/fixtures/plugin-contracts.json`](../../test/contract/fixtures/plugin-contracts.json).
A future Rust implementation may use different modules, registries, and schedulers, but it must
preserve the fixture's values and the behavior described here.

## Contract table

| Surface | Frozen behavior | Authoritative executable coverage |
| --- | --- | --- |
| Provider identity | Each shipped provider has a stable `id`, display `name`, `baseUrl`, and country list. The fixture freezes all 19 records. | [`test/contract/pluginContracts.contract.test.js`](../../test/contract/pluginContracts.contract.test.js), [`test/provider/providerMetaInformation.test.js`](../../test/provider/providerMetaInformation.test.js) |
| Provider static config | The static template has `url: null`, no bound `filter`, a required-field list, and a callable `normalize`. The required fields are frozen per provider. | [`test/contract/pluginContracts.contract.test.js`](../../test/contract/pluginContracts.contract.test.js), [`test/provider/statelessProviders.test.js`](../../test/provider/statelessProviders.test.js) |
| Provider run config | `createConfig(sourceConfig, blacklist)` returns a fresh run-scoped config. The run carries the source URL and enabled state, exposes `normalize` and a callable blacklist `filter`, and does not mutate the static template or another run. | [`test/contract/pluginContracts.contract.test.js`](../../test/contract/pluginContracts.contract.test.js), [`test/provider/statelessProviders.test.js`](../../test/provider/statelessProviders.test.js) |
| Provider countries | Country codes are lowercase ISO alpha-2 values, deduplicated and sorted. Missing, empty, or unusable declarations fall back to `['de']`; provider-specific declarations override that default. | [`test/contract/pluginContracts.contract.test.js`](../../test/contract/pluginContracts.contract.test.js), [`test/provider/providerMetaInformation.test.js`](../../test/provider/providerMetaInformation.test.js), [`test/services/providerCountries.test.js`](../../test/services/providerCountries.test.js) |
| Adapter discovery | Shipped adapters are the dynamically discovered modules with a config `id`; helper modules without a config id are not channels. The fixture freezes all 17 shipped adapter ids and names. | [`test/contract/pluginContracts.contract.test.js`](../../test/contract/pluginContracts.contract.test.js), [`test/notification/shippedAdapters.test.js`](../../test/notification/shippedAdapters.test.js) |
| Adapter declaration | Each adapter exposes declarative `fields`. The fixture freezes field names, types, optionality, and the `secret` and `target` flags. Secret fields are credentials and target marks the safe destination field; these flags are part of the channel contract, not UI-only hints. | [`test/contract/pluginContracts.contract.test.js`](../../test/contract/pluginContracts.contract.test.js), [`test/notification/adapterSummary.test.js`](../../test/notification/adapterSummary.test.js), [`test/notification/shippedAdapters.test.js`](../../test/notification/shippedAdapters.test.js) |
| Adapter send | Dispatch calls `send({ serviceName, newListings, notificationConfig, jobKey, baseUrl })` once for each configured, discoverable adapter. Unknown ids are skipped. The payload key set and values are frozen; adapter return values remain adapter-defined promises/values. | [`test/contract/pluginContracts.contract.test.js`](../../test/contract/pluginContracts.contract.test.js), [`test/notification/testFire.test.js`](../../test/notification/testFire.test.js), [`test/notification/priceChangeFanout.test.js`](../../test/notification/priceChangeFanout.test.js) |
| Startup cron tasks | Active-listing checks, geocoding, listing retention, and connectivity run once during initialization and then on their schedules. | [`test/contract/fixtures/plugin-contracts.json`](../../test/contract/fixtures/plugin-contracts.json), [`test/services/crons/connectivity-cron.test.js`](../../test/services/crons/connectivity-cron.test.js), [`test/services/crons/listing-retention-cron.test.js`](../../test/services/crons/listing-retention-cron.test.js) |
| Schedule-only tasks | Price tracking and travel-time sweeps are registered without an initialization run. Demo cleanup is schedule-only and is registered only when `demoMode` is enabled. | [`test/contract/fixtures/plugin-contracts.json`](../../test/contract/fixtures/plugin-contracts.json), [`test/services/crons/demo-cleanup-cron.test.js`](../../test/services/crons/demo-cleanup-cron.test.js) |
| Schedule cadence | The fixture freezes each cron expression: active checker `0 */4 * * *`, geocoding `0 */6 * * *`, demo cleanup `0 0 * * *`, retention `30 3 * * *`, price tracking `0 5 */2 * *`, travel time `20 */2 * * *`, and connectivity `40 * * * *`. | [`test/contract/pluginContracts.contract.test.js`](../../test/contract/pluginContracts.contract.test.js), individual cron tests under [`test/services/crons/`](../../test/services/crons/) |

## Rust-facing shape

The provider and adapter records in the fixture are data, not a module-loading recipe. A Rust
registry can deserialize them directly and provide equivalent callables through traits or services.
The fixture intentionally does not contain JavaScript function bodies, import paths, file names, or
Node-specific objects. `sendCall.object` names the stable adapter payload; the `arguments` entry
records the legacy dispatcher input order where a caller still uses positional arguments.

A provider implementation must keep normalized output compatible with its frozen
`requiredFieldNames`. The fixture does not prescribe how raw portal data is obtained or how each
provider parses it. A provider may use HTTP, a browser, or a Rust parser as long as it supplies the
same normalized fields and blacklist decision at the provider boundary.

## Startup and scheduling boundary

The startup classification concerns the background sweep itself, not the application bootstrap
sequence. It does not require Rust to call functions named `init*Cron`, use `node-cron`, or preserve
Node's fire-and-forget details. It requires only that the same task is (or is not) run during startup,
that its schedule is equivalent, and that demo cleanup remains conditional on demo mode.

The job execution scheduler and external-trigger mode are intentionally outside this table. They are
orchestration concerns, as is the ordering and implementation of
`FredyPipelineExecutioner`. This contract does not freeze or authorize changes to those components.

## Not contractual

- Dynamic import order, directory names, module paths, and the presence of a JavaScript adapter helper
  file without `config.id`.
- Function identity, JavaScript arity, closures, `node-cron` objects, timers, and promise
  implementation details.
- Adapter vendor HTTP request formatting, retry policy, throttling, and response parsing. The adapter
  boundary and declarative field metadata are frozen; vendor wire protocols are separate parity work.
- Provider HTML/API request mechanics, browser usage, parser internals, and provider capability
  production metadata beyond the identity/country/required-field records in the fixture.
- `FredyPipelineExecutioner`, application lifecycle, persistence, workflows, frontend state/UI, and
  package or wireframe structure.

## Remaining parity gaps

1. Rust provider implementations still need provider-specific raw-input fixtures and normalized
   listing golden cases; this contract freezes the boundary shape, not every portal parser result.
2. Rust notification adapters still need vendor-request golden cases and error/ retry semantics.
3. Rust schedule runners still need task-level execution/overlap/error cases where a cron test does
   not already cover them; this document freezes startup classification and cadence only.
4. Job orchestration, persistence, HTTP routes, and application lifecycle remain separate contracts.
