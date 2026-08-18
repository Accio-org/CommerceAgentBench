# Third-Party Materials Inventory

Commerce Agent Bench's own contributions are licensed under Apache-2.0
([`LICENSE`](LICENSE)) for code and CC BY 4.0 ([`LICENSE-DATA`](LICENSE-DATA))
for the task suite. Both are permissive and irrevocable, so publishing this
repository grants the world the right to redistribute what it contains —
except for the third-party materials inventoried below.

**Neither license extends to those materials.** Their rights are retained by
their respective owners, and nothing in this repository grants them. An asset
the Licensor does not own cannot be swept in by a license the Licensor grants,
so this page exists to draw that line explicitly rather than leave it implied.

Everything listed here is present because deterministic offline evaluation
requires it: an agent benchmark has to drive a fixed interface and receive
fixed responses, and a live third-party service provides neither. Inclusion
implies no endorsement, affiliation, or sponsorship, and no claim of ownership.

If you hold rights in anything listed here and want it removed or attributed
differently, contact the maintainers (see [`CITATION.cff`](CITATION.cff)) and
we will act on it.

## OpenClaw runtime

Commerce Agent Bench uses a project-published May 2026 runtime image. The suite is
pinned at:

```text
acciolyk/accio_bench@sha256:1e9cf5c72a56794175b7d06ece036b92e296e6b7e9e9a7fa244026f6acea3859
```

The image contains the MIT-licensed
[OpenClaw](https://github.com/openclaw/openclaw) npm package at version
`2026.5.22`, together with the browser environment and Commerce Agent Bench mock
services.

See [`docs/openclaw-runtime-image.md`](docs/openclaw-runtime-image.md) for the
verified image identity, immutable release digest, and customization boundary.

## Shopify Admin interface replica

Two replicas carry this material, with the same captured asset set in each:

| Replica | Status |
|---|---|
| `real_replica_bench/mock_services/shopify_online_store_v2/public/` (310 files) | ships in the runtime image; backs the `browser/shopify/storefront-brand-refresh` task |
| `real_replica_bench/mock_services/shopify_online_store_v3/public/` (310 files) | source only — not registered in `MOCK_SERVICE_REGISTRY`, not in the runtime image, no task yet |

Neither is a hand-drawn lookalike: two of the subtrees in each are **mirrored
static assets** served from Shopify's admin CDN, kept under their original
content-hashed filenames so the replica's stylesheets resolve unmodified.

| Subtree | Files | Contents |
|---|---|---|
| `_polaris/` | 199 | Polaris design-system CSS, `img/` (102 hash-named SVG/PNG/JPG), `shadow/` (78 hash-named CSS chunks), `assets/` fonts |
| `_embedded/` | 12 | embedded-app stylesheets and fonts |
| `_pages/` | 70 | admin page structures |

The remaining files (product SVGs, seed JSON, page templates) are
Commerce Agent Bench fixtures. v3 additionally carries `seeds/themes/` — Liquid
theme sources that are Commerce Agent Bench fixtures, not mirrored assets.

These materials carry Shopify trademarks, product names, interface structure,
and styling. Shopify Inc. retains every right it holds in them. The fonts are
the one component with an affirmative redistribution grant — see below.

## Bundled fonts

Eighteen `.woff2` files ship inside each replica above — the same eighteen, so
thirty-six files in a source checkout and eighteen in the runtime image, which
carries v2 only. All are licensed under the **SIL Open Font License 1.1**, which
permits redistribution provided the license accompanies the fonts:

| Family | Files (per replica) | Copyright | License copy |
|---|---|---|---|
| Inter | 14 | The Inter Project Authors | `_polaris/assets/OFL.txt`, `_embedded/assets/OFL.txt` |
| Geist Mono | 4 | Vercel, in collaboration with basement.studio | `_polaris/assets/OFL.txt` |

Both paths are relative to each replica's `public/` directory:
[v2 `_polaris`](real_replica_bench/mock_services/shopify_online_store_v2/public/_polaris/assets/OFL.txt),
[v2 `_embedded`](real_replica_bench/mock_services/shopify_online_store_v2/public/_embedded/assets/OFL.txt),
[v3 `_polaris`](real_replica_bench/mock_services/shopify_online_store_v3/public/_polaris/assets/OFL.txt),
[v3 `_embedded`](real_replica_bench/mock_services/shopify_online_store_v3/public/_embedded/assets/OFL.txt).

Seven of the Inter files are content-hash-named and were identified from their
internal `name` table rather than their filename. The license copies sit beside
the fonts in every directory that holds them, so they travel with the fonts into
the runtime image as well as through a source checkout.

## Replayed third-party API responses

173 files under `datasets_domain_v1/**/private/mock_runtime/serpapi_*` are
recorded [SerpApi](https://serpapi.com/) response snapshots, replayed by a
task-local server so a run is deterministic and offline. Five tasks use them:

- `api/travel/asia-supplier-tour-handoff` (`serpapi_hotels_replay`)
- `cli/amazon/headphone-sourcing` (`serpapi_replay`)
- `cli/google-trends/counterfactual-rebalance`, `data-quality-audit`,
  `html-report-audit` (`serpapi_trends_replay`)

The snapshots contain SerpApi's response schema and the underlying search,
product, hotel, and trends data it returned. Those rights belong to SerpApi and
to the sources it aggregates. Redistribution of API response data may also be
governed by SerpApi's terms of service independently of copyright.

## Task workspace attachments

Task workspaces under `datasets_domain_v1/**/workspace/` include documents,
screenshots, product images, and business-style fixtures. Most are generated
benchmark fixtures; some are based on public supplier or marketplace material.
Where such a fixture depicts a real logo, certificate, supplier document, or
product photograph, the depicted material remains its owner's.

## Documentation screenshots

The three images under `docs/assets/screenshots/` are captures of **this
repository's own mock services** during a run, not of the live products they
replicate. Whatever third-party interface structure and styling the mocks carry
is therefore visible in them, and the sections above apply.

## Accio brand materials

The repository ships one Accio brand asset, `docs/assets/accio-logo.svg`, used
in the README header and footer. The public landing page at
<https://realreplicabench.site.accio.ai/> is hosted separately and is no longer
part of this repository; its brand artwork and the model-vendor marks it
displays are covered by that site, not by this inventory.

Accio and the depicted product names and marks remain the property of their
respective owners. The repository's license grants ([`LICENSE`](LICENSE) and
[`LICENSE-DATA`](LICENSE-DATA)) do not extend to them.

## Python dependencies

The package declares `openpyxl` and `PyYAML` as host-side dependencies. Their
licenses are governed by their upstream distributions.
