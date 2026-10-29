# Font presets

Status: implemented in #888 (PR #894); picker cleanup and app-wide audit in #895
Updated: 2026-10-29

## Scope

Settings › 表示とデザイン › フォント offers four typefaces in the same collapsed picker as 配色. Each option shows only its name and a real Japanese sample, both rendered in that face (no secondary description or dot-theme note).

| Preset (`study-planner-font-preset`) | Family | License | Requested weights |
|---|---|---|---|
| `system` (default) | existing `"Hiragino Sans", "Yu Gothic UI", "Meiryo", …` stacks | — | none |
| `noto-sans-jp` | Noto Sans JP (Digital Agency design system typeface) | OFL 1.1 | variable `400..900` |
| `biz-udpgothic` | BIZ UDPGothic (universal-design, readability) | OFL 1.1 | `400;700` (all shipped) |
| `m-plus-rounded-1c` | M PLUS Rounded 1c (rounded, friendly) | OFL 1.1 | `400;700;800` |

Licenses and shipped weights were checked against `google/fonts` `METADATA.pb`. `font-synthesis: none` stays; other app weights resolve to the nearest shipped weight instead of synthetic bold.

## Ownership

- `src/lib/fontPreset.ts`: preset recognition, labels and the on-demand Google Fonts CSS2 stylesheet loader.
- `src/hooks/useThemePreference.ts`: the typed preference next to mode and palette. Written only after an explicit choice; corrupt or unknown saved values display `system` and are not overwritten. `system` leaves `html[data-font-preset]` absent.
- `src/styles/font-presets.css`: every family stack. Its `:root` rule (loaded after `base.css`), `home.css` and `bookshelf.css` read `var(--app-font-family, <previous stack>)`, so the standard preset is byte-for-byte the previous behavior. A chosen preset also makes form controls inherit.
- The dot appearance keeps DotGothic16 with priority; only `.font-preset-sample` is excluded so comparison still works (option names stay in DotGothic16 there).

## Delivery, failure and security

- Stylesheets are appended only while a web preset is selected, or while the font picker is open (comparison). Standard users make no Google request. CSS2 returns ~120 `unicode-range` slices per family, so only slices for rendered characters download (measured gzip CSS: ~30 KB Noto, ~61 KB BIZ, ~90 KB M PLUS).
- `display=swap`, no preload and no startup font gate. A failed stylesheet is removed (a later selection retries) and the settings page shows a load error; every stack ends with the previous system fallback, so offline use keeps the standard typeface.
- No font files are redistributed. There is currently no CSP; adding one requires `style-src https://fonts.googleapis.com` and `font-src https://fonts.gstatic.com`.
- Privacy: Google Fonts receives IP/User-Agent only after the user opens the picker or selects a web preset.

## Verification

Unit: `src/lib/fontPreset.test.ts`, `src/styles/font-presets.test.ts`, `src/hooks/useThemePreference.test.tsx`, `src/components/AppSettingsGeneral.font.test.tsx`. Browser: `tests/e2e/font-preset.spec.mjs` (Google Fonts routed to a local face), including a standard-appearance audit of every visible text node, control and placeholder across login, home, schedule month/week/day, quick add, entry modal, bookshelf, AI chat and every settings tab at 320/390/1280px in light and dark. Exact results are recorded on Issue #888 and the PR.
