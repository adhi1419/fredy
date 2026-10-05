# Fredy

## Find a home that fits your life

[Fredy](https://adhi1419.github.io/fredy/) brings real-estate listings from multiple providers into one focused workspace. Create saved searches, receive new matches through the channels you already use, compare homes by price and size, and check whether a listing fits your commute and daily life.

**[Open Fredy](https://adhi1419.github.io/fredy/)**

Fredy was created by **Christian Kellner**. This fork keeps the original Fredy attribution and source-available license conditions. Read the [license](LICENSE) before redistributing or building a commercial service around Fredy.

## See Fredy in action

Fredy keeps the important choices visible without making the home search feel busy. The same workspace adapts from a quiet desktop feed to a one-handed mobile flow, in light and dark. Every screenshot below follows your system theme; the full set in both themes is in [`doc/screenshots`](doc/screenshots).

<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="doc/screenshots/home-quiet-feed-desktop-dark.png" />
    <img src="doc/screenshots/home-quiet-feed-desktop-light.png" alt="Fredy Home in Quiet feed view: a grid of listing photos with price, size and rooms, activity tabs with counts, a provider picker and labelled sort pills" width="1200" />
  </picture>
  <br />
  <em>Home starts with a quiet feed for scanning new matches.</em>
</div>

<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="doc/screenshots/home-list-map-desktop-dark.png" />
    <img src="doc/screenshots/home-list-map-desktop-light.png" alt="Fredy Home in List plus map view: listings on the left, a map of Berlin with a pin for every match and your saved places on the right" width="1200" />
  </picture>
  <br />
  <em>List + map adds location context. Pan to narrow the list to the area in view; pick a pin to see just that home.</em>
</div>

<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="doc/screenshots/listing-detail-desktop-dark.png" />
    <img src="doc/screenshots/listing-detail-desktop-light.png" alt="Fredy listing detail: a sticky photo and map column beside the facts, a spec strip, and the Apply, Draft inquiry and Open listing actions" width="1200" />
  </picture>
  <br />
  <em>A listing reads like a product page: photo and map stay put while the facts scroll.</em>
</div>

<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="doc/screenshots/saved-searches-desktop-dark.png" />
    <img src="doc/screenshots/saved-searches-desktop-light.png" alt="Fredy Saved Searches page listing Berlin Rentals and Munich Apartments with their run health and actions" width="1200" />
  </picture>
  <br />
  <em>Saved Searches keeps the searches that supply Home easy to manage.</em>
</div>

<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="doc/screenshots/saved-search-step-1-desktop-dark.png" />
    <img src="doc/screenshots/saved-search-step-1-desktop-light.png" alt="Fredy saved-search editor, step 1 of 4, Providers: the search name and the provider sources with their auto-apply policy" width="1200" />
  </picture>
  <br />
  <em>A search is set up in four steps; each provider keeps its own apply policy.</em>
</div>

<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="doc/screenshots/home-quiet-feed-mobile-dark.png" />
    <img src="doc/screenshots/home-quiet-feed-mobile-light.png" alt="Fredy Home on a phone: activity tabs, one listing photo per row, bottom navigation" width="390" />
  </picture>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="doc/screenshots/home-list-map-mobile-dark.png" />
    <img src="doc/screenshots/home-list-map-mobile-light.png" alt="Fredy List plus map view on a phone with the map above the listings" width="390" />
  </picture>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="doc/screenshots/listing-detail-mobile-dark.png" />
    <img src="doc/screenshots/listing-detail-mobile-light.png" alt="Fredy listing detail on a phone with the Apply action docked at the bottom" width="390" />
  </picture>
  <br />
  <em>Mobile keeps the feed, the map and the listing actions within one thumb.</em>
</div>

<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="doc/screenshots/saved-search-step-1-mobile-dark.png" />
    <img src="doc/screenshots/saved-search-step-1-mobile-light.png" alt="Fredy saved-search setup on a phone showing step 1 of 4, Providers, with Back and Continue in a sticky ribbon" width="390" />
  </picture>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="doc/screenshots/my-account-mobile-dark.png" />
    <img src="doc/screenshots/my-account-mobile-light.png" alt="Fredy My account on a phone: Preferences tab with appearance, language and listing deletion settings" width="390" />
  </picture>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="doc/screenshots/admin-panel-mobile-dark.png" />
    <img src="doc/screenshots/admin-panel-mobile-light.png" alt="Fredy Admin panel on a phone: System tab with port, base URL and offline-listing retention" width="390" />
  </picture>
  <br />
  <em>Setup, account and instance settings share one hairline layout.</em>
</div>

<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="doc/screenshots/my-account-desktop-dark.png" />
    <img src="doc/screenshots/my-account-desktop-light.png" alt="Fredy My account on desktop: Preferences, Travel time, Listing details, Notification channels and Inquiry profile tabs over ruled settings sections" width="1200" />
  </picture>
  <br />
  <em>Settings are one column of ruled sections, no boxes.</em>
</div>

## What Fredy does

- Searches 6 real-estate providers across Germany, Austria, and Switzerland.
- Removes duplicate listings found on multiple providers.
- Filters listings by home criteria, location, price, size, rooms, and real-world fit.
- Shows travel time, distance, and map context for each home when the required data is available.
- Delivers new listings through configurable notification channels.
- Tracks what you have done with a listing, including applications, viewings, notes, and archiving.
- Supports light and dark themes with responsive, accessibility-reviewed interfaces.

## Start with the live app

Fredy is available at [adhi1419.github.io/fredy](https://adhi1419.github.io/fredy/). Its backend is API-only and runs at [fredy-vh63vbsl2q-ew.a.run.app](https://fredy-vh63vbsl2q-ew.a.run.app). The app uses Firestore as its only persistence layer.

Access is operator-allowlisted. Sign-in uses Google through direct Firebase bearer authentication. An account must be approved for this Fredy instance before it can use the app.

On your first registration, Fredy asks you to enter these common profile facts explicitly:

- Full name
- Street
- House number
- Postcode
- City

Fredy does not infer your employment, income, household details, address, provider credentials, or consent. Provider-specific information is entered separately and only when you choose to use a feature that needs it.

## Two places to work

Fredy has exactly two primary destinations:

- **Home** is your listing feed. It is designed for quick, quiet review.
- **Saved Searches** is where you create and manage the searches that supply Home.

### Home

Home opens to **Quiet feed**, which keeps the listing stream easy to scan. Switch to **List + map** when location matters. Your selected view and feed state are preserved while you move between them.

Home separates listing activity into exclusive states:

- **New**
- **Applied**
- **Viewed**
- **Archived**

You can select multiple providers and sort by:

- Newest
- Travel time
- Distance
- Price
- Size

Open a listing to see its details, map location, provider source, travel information, and your own actions.

### Saved Searches

Creating a saved search takes four steps:

1. **Providers**. Choose the sources and their search criteria. Each provider source keeps its own application policy.
2. **Home criteria**. Set the place, renting or buying choice, price, rooms, size, and other supported criteria.
3. **Real-world fit**. Add commute limits and affordability information that help identify homes you can live with, not only homes that match a portal filter.
4. **Delivery/review**. Choose notification channels, review the search, and save it.

Fredy then checks the selected providers on the instance schedule and brings new matches to Home.

Affordability results are estimates, not financial advice. Verify taxes, purchase costs, interest rates, and any financing decision with the appropriate professionals.

## Listing actions and applications

On mobile, the primary listing actions appear in this order:

1. **Apply**
2. **Google Maps**
3. **Provider listing**

The listing action menu also includes **I applied myself**, **Add notes**, **Got a viewing**, and **Archive**. When Fredy submits an application, the listing becomes **Applied** and any submitted message is available from the listing.

Application support belongs to each provider source. Fredy can submit applications only where the selected provider, listing, and your profile meet that provider's requirements. Automatic application submission is opt-in per provider source in a saved search. It is never a promise that every matching listing will receive an application.

Current provider-submitted application paths include:

- **ImmoScout24**, with provider validation before a supported submission.
- **Deutsche Wohnen**, with the provider-specific contact and income information it requires.
- **HOWOGE offers surfaced through InBerlinWohnen**, which require the provider's confirmation email after Fredy submits the request.
- **WBM offers surfaced through InBerlinWohnen**, using the provider's direct application form.
- **Stadt und Land offers surfaced through InBerlinWohnen**, when the live Wohnungshelden form does not require a captcha or document upload.
- **Kleinanzeigen**, using an encrypted connected web session and the generated inquiry message.

Degewo, Gewobag, Berlinovo, Gesobau/Immomio, and other providers remain notification-only for provider-submitted applications. You can always open the provider listing and record **I applied myself**.

## Privacy and account expectations

Fredy stores account, search, listing, profile, and activity data in Firestore for this instance. The operator controls who can sign in through the allowlist. Authentication uses a Firebase identity in your browser and a bearer token for protected app requests. Fredy does not create a separate password account or server-side browser session.

Fredy sends information to a provider only when you use a provider feature that requires it and the applicable consent and eligibility checks pass. Application profile fields and provider credentials are not guessed or silently completed. Review provider requirements before enabling automatic application submission.

## Providers

Fredy currently supports these sources:

**Germany:** Deutsche Wohnen, ImmoScout24, InBerlinWohnen, and Kleinanzeigen.

**Austria:** willhaben.

**Switzerland:** Flatfox.

Provider coverage and supported search fields can differ by source because each provider supplies its own listings and search interface. Fredy shows the provider attached to every listing.

## Notifications

Create a notification channel once and reuse it across saved searches. Current customer-facing delivery options include:

- Telegram

Each channel stores the destination and credentials needed by that service. You control which channels receive each saved search.

## Credits and data

Travel planning and transit data come from [Transitous](https://transitous.org/), a community-run [MOTIS](https://github.com/motis-project/motis) instance. Map and street data come from [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors. Please respect the [Transitous usage policy](https://transitous.org/api/).

## Attribution and license

Fredy is the original project of **Christian Kellner**. This fork must retain clear attribution to the original project and author.

Fredy is licensed under Apache-2.0 with two additional conditions. It is **source-available, not OSI open source**.

### Commons Clause

The Licensed Work and its derivative works may not be used by any person or organization to Sell the Licensed Work.

“Sell” or “Selling” means practicing any or all of the rights granted to you under the License to provide to third parties, for a fee or other consideration (including without limitation fees for hosting or consulting/support services related to the Software), a product or service whose value derives, entirely or substantially, from the functionality of the Licensed Work.

This restriction does not apply to internal business purposes or non-commercial use. Self-hosting Fredy for yourself is permitted. Read the full [LICENSE](LICENSE) for the complete terms.

### Attribution and Naming Clause

Any derivative work based on this software must include clear and visible attribution to the original project “Fredy” and its author(s). Derivative works may not be distributed, published, or presented under a different name or branding without the explicit written permission of the original copyright holder.

## Support

For bugs and feature requests, use the [Fredy fork issue tracker](https://github.com/adhi1419/fredy/issues). When reporting a problem, include the provider, saved-search context, and the steps that reproduce it. Do not include passwords, provider credentials, or other private information.

Developers and operators can find setup, deployment, validation, recovery, and extension guidance in the [Developer and Operator Guide](docs/DEVELOPER_OPERATOR_GUIDE.md).
