status: done (pending review)
size: medium

# UI dark mode

## Executive summary

**Status: implemented.** Dark mode is live in `packages/ui`. New CSS variable layer in `styles.css`
exposes a warm-dark palette keyed off `:root[data-theme='dark']`, with a `prefers-color-scheme`
fallback for users who haven't chosen explicitly. A toggle button in the sidebar cycles
`system → dark → light`. Preference is persisted via `use-local-storage-state` under the key
`sqlfu-ui/theme`. CodeMirror, react-hot-toast, Radix Dialog, reactgrid, and rjsf forms all pick
up the dark palette automatically because they were already routed through the shared CSS vars
(or, for CodeMirror, now consume `useResolvedTheme()`).

Staring at the in-browser sqlfu UI at night hurts the user's eyes. Today `packages/ui/src/styles.css`
defines a single warm beige/orange light palette via `:root` CSS variables (`--bg`, `--panel`,
`--text`, `--accent`, etc.), and the only thing currently "dark" is the embedded CodeMirror editor
(which hardcodes `theme="dark"` from `@uiw/react-codemirror` — a pre-existing light/dark mismatch).

This task adds a real dark mode: a warm-dark variant of the existing aesthetic, user-toggleable via
a small control in the sidebar, preference persisted with `use-local-storage-state`, respecting
`prefers-color-scheme` on first load, and propagated into CodeMirror via `theme` prop and into
react-hot-toast via the `Toaster` theme.

Scope: palette variables + dark-aware overrides in `styles.css`; theme toggle component; plumb
theme into `SqlCodeMirror` / `TextCodeMirror` / `TextDiffCodeMirror`; reactgrid + rjsf form inputs
audited so nothing is white-on-white or black-on-black; toasts themed.

Out of scope: website/landing-page dark mode (separate surface), redesign of the light palette.

## Design decisions

### Palette

Light palette unchanged (same values currently in `:root`).

Dark palette — warm dark, not VS Code dark:
- `--bg`: `#1a1410` (deep warm near-black, 6% lightness, warm brown hue)
- `--bg-strong`: `#211912` (slightly stronger surface)
- `--panel`: `rgba(42, 31, 22, 0.92)` (warm translucent panel)
- `--panel-strong`: `#2a1f16`
- `--line`: `rgba(240, 224, 196, 0.12)` (faint warm-beige lines)
- `--text`: `#f0e6d6` (warm off-white — contrast ratio > 11:1 vs `--bg`)
- `--muted`: `#b8a484` (muted warm tan — still ~5.5:1 on `--bg`)
- `--accent`: `#e89b66` (lighter orange so it glows on dark)
- `--accent-strong`: `#f4b382` (hover / emphasis)
- `--shadow`: `0 18px 40px rgba(0, 0, 0, 0.45)` (deeper shadows for dark surface)

Background gradient in dark mode swaps to a warm-dark gradient using the above values.

Other hard-coded colors found in `styles.css` that need dark variants:
- `.code-block.error` (currently light-pink background, dark-red text) — dark equivalent: dark-red
  bg with warm-pink text.
- `.schema-card.ok` (light green) — dark equivalent: dark green-tinted surface, warm-green border.
- `.schema-card.info` (light blue) — dark equivalent: dark blue-tinted surface.
- `.schema-card.recommendations` (light yellow) — dark equivalent: dark amber surface.
- `.reactgrid` header/cell tints — need dark surface + border recolors.

### Toggle UX

Small `button.icon-button` in the sidebar header area (sidebar is where `sqlfu/ui` title lives).
A sun/moon glyph (`☼` / `☾`) with `aria-label="Toggle theme"`. Clicking cycles light ↔ dark.

Persistence: `use-local-storage-state` with key `sqlfu-ui/theme`, value `'light' | 'dark' | 'system'`.

First load behavior:
- Default value is `'system'`.
- If `'system'`, read `window.matchMedia('(prefers-color-scheme: dark)').matches` and apply.
- If the user toggles explicitly, we set `'light'` or `'dark'` and ignore system.

Applied by setting `data-theme="dark"` (or `"light"`) on the `<html>` root. CSS keys off
`:root[data-theme='dark']` and falls back to a `@media (prefers-color-scheme: dark)` block for the
`'system'` case.

Because the user said *no useState/useEffect*, the theme hook reads from localStorage; the CSS
handles the system case via a media query (no JS subscription to `matchMedia` needed). We only
toggle `data-theme` on `<html>` in direct response to button clicks — no effect/subscription
needed. When the stored value is `'system'`, we remove the attribute and let the media query win.

### CodeMirror

The three CodeMirror wrappers in `sql-codemirror.tsx` all hardcode `theme="dark"`. Switch to read
current theme from the shared helper and pass `'light'` or `'dark'` accordingly. Built-in light /
dark themes from `@uiw/react-codemirror` are fine; they're not custom-painted for the sqlfu palette
but they're readable and consistent with what we have in dark mode. (A custom warm-dark CodeMirror
theme is a nice-to-have; not in scope for this task.)

### Third-party components

- `@silevis/reactgrid`: we already vendor the minimal rules in `styles.css` (the `.rg-*` selectors).
  Dark-mode variants added alongside.
- `@rjsf/core`: renders semantic form controls, which we already style via `form input`, `form select`,
  `form textarea`. Those selectors pick up `--line` / `--panel-strong` / `--text` so they work
  automatically once the vars are dark-aware.
- `react-hot-toast`: pass a `toastOptions.style` / `toastOptions.iconTheme` built from CSS vars so
  toasts live in the dark palette. Simplest: toasts already use `.app-toast` class + `--panel-strong` /
  `--text`, so this comes along for free.
- Radix Dialog (`.shad-dialog-*`): same — uses CSS vars, comes along automatically.

## Checklist

- [x] Palette: add dark palette variables in `styles.css`, keyed off `:root[data-theme='dark']` and
      `@media (prefers-color-scheme: dark) :root:not([data-theme='light'])`.
      _refactored light `styles.css` to route every hard-coded `rgba(...)` value through a named
      CSS var, so the dark block is a single palette swap._
- [x] Dark-mode overrides for error/ok/info/recommendations semantic cards.
      _added `--semantic-{ok,info,recommendations,error}-{bg,border,text}` vars._
- [x] Dark-mode overrides for `.reactgrid` header + cell tints + dirty cell highlight.
      _`--rg-header-bg`, `--rg-append-*`, `--rg-shadow`, `--rg-cell-editor-shadow`._
- [x] Dark-mode override for `.code-block.error`. _routed through semantic-error vars._
- [x] Dark-mode override for background `linear-gradient` on body.
      _`--bg-gradient` lives in the palette; `body { background: var(--bg-gradient) }`._
- [x] Theme toggle button in sidebar (`☼`/`☾` + aria-label).
      _`ThemeToggle` component in `client.tsx`, uses the existing `.icon-button` style with a
      `.theme-toggle` modifier; glyphs are `☼` (light), `☾` (dark), `◐` (system)._
- [x] Theme state: `use-local-storage-state` with key `sqlfu-ui/theme`, cycles `system → dark → light → system`.
      _lives in `packages/ui/src/theme.ts`. Applied to DOM via `applyPreferenceToDom()` from
      both the click handler and `initThemeOnLoad()` (called at module scope so the page loads
      in the right mode — no first-paint flash)._
- [x] `sql-codemirror.tsx`: pipe theme into all three CodeMirror wrappers.
      _new `useResolvedTheme()` in `theme.ts` uses `useSyncExternalStore` to subscribe to
      `matchMedia('(prefers-color-scheme: dark)')` when preference is 'system'._
- [x] `toaster.tsx`: verify dark toasts look right (should come for free via CSS vars).
      _`.app-toast` already routes through `--panel-strong` / `--text` / `--shadow` — no
      component-level change needed._
- [x] `pnpm --filter sqlfu-ui typecheck` passes.
- [x] `pnpm --filter sqlfu-ui test:node` passes (6 tests green).
- [x] `pnpm --filter sqlfu-ui build` passes.
- [ ] Open PR, verify CI green.

## Implementation log

- CSS refactor: the original `styles.css` had a lot of palette values inlined as `rgba(255, 255, 255, X)`,
  `rgba(178, 76, 43, X)`, and similar. Pulling each into a named var (e.g. `--panel-tint-soft`,
  `--accent-bg-mid`) was a precondition for a clean dark swap — otherwise the dark block would've
  needed to redeclare dozens of individual rules.
- Pre-existing mismatch noted: the CodeMirror editor hardcoded `theme="dark"` while the site was
  a light warm palette. Now that both sides respect `useResolvedTheme()`, the editor follows the
  site theme in both modes.
- Chose to set `color-scheme: light` / `color-scheme: dark` on `:root` for each palette so that
  native form controls, scrollbars, and the browser's default overlays adapt too. This matters
  for rjsf forms (which render native inputs).
- Toggle UX: cycling `system → dark → light → system` feels the most useful — the user lands on
  dark on first click (which is what they wanted here), and system is a valid equal-footing
  stop rather than a hidden default.
- Dark-mode accent (`#e89b66`) is a lighter orange than light-mode's `#b24c2b`, because on a
  dark surface the darker orange read muddy; the lighter orange glows. This required a new
  `--button-primary-text` var (white-on-light-orange fails contrast) set to a deep warm brown
  in dark mode.
- Left out of scope: a bespoke warm-dark CodeMirror theme. The built-in `theme="dark"` from
  `@uiw/react-codemirror` is consistent with what was already shipping (it's what was hardcoded
  before this change), and bikeshedding exact token colors would blow up the scope. A follow-up
  task can upgrade to a custom CodeMirror theme matching the palette exactly.

