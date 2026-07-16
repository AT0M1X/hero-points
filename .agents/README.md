# Hero Points project context

Hero Points is a small Foundry Virtual Tabletop module for the DnD5e system. It replaces the character sheet's inspiration control with a configurable hero-point counter and gives GMs a directory tool for awarding or setting points on player-owned characters.

## Project layout

- `module.json` is the Foundry package manifest and the source of truth for the released version.
- `scripts/hero-points.js` contains Foundry integration, legacy migration, sheet injection, roster management, chat output, and GM controls.
- `scripts/hero-points-state.js` contains pure rules for normalizing, awarding, setting, resetting, and spending hero points.
- `styles/hero-points.css` styles the injected counter and GM dialog and hides the original inspiration control.
- `tests/hero-points-state.test.mjs` verifies point-pool priority, capacity behavior, and roster defaults.
- `tests/hero-points-manager.test.mjs` verifies the manager's Award and Manage Roster separation.
- `tools/validate-package.mjs` validates the manifest, release URLs, referenced assets, and optional release tag.
- `tools/prepare-release.mjs` updates the manifest version and version-specific download URL.
- `.github/workflows/release.yml` packages and publishes GitHub releases when a `v*` tag is pushed.

## Development notes

- The module id and installed folder name must remain `hero-points`.
- The code runs inside Foundry and intentionally uses Foundry globals such as `Hooks`, `game`, `ui`, `ChatMessage`, `Dialog`, and `Actor`, plus the jQuery global `$`.
- Hero-point values are stored on actors in the `hero-points.state` flag as `{ persistent, ephemeral }`. Older `hero-points.points` totals migrate to persistent points.
- Character roster status is stored in `hero-points.inUse`.
- The manager includes Award Points and Manage Roster tabs. Award Points contains only active actors; Manage Roster contains every DnD5e character-type actor and persists moves immediately.
- When roster status has never been stored, player-owned character actors default to active and unowned character actors default to inactive.
- The maximum is a world-scoped setting named `hero-points.maxPoints` and applies to the combined point pools.
- Ephemeral points are always spent first. Positive persistent awards may replace ephemeral points at the maximum, but ephemeral awards never replace persistent points.
- The character-sheet header uses a compact star and total pill. Hovering or keyboard-focusing it shows one visual slot per point of maximum capacity (ephemeral first, persistent second, then unused capacity) with labeled pool counts beneath.
- Preserve the DnD5e-only guard and character-only guard when changing sheet injection behavior.
- Do not claim compatibility with a Foundry or DnD5e version until it has been exercised in that version.
- Run `node --test` after changing point-state rules or manager markup.
- Run `node tools/validate-package.mjs` before committing manifest or release changes.

## Release process

1. Run `node tools/prepare-release.mjs <version>` using a plain semantic version such as `0.2.0`.
2. Review and test the changes, then commit them to `main`.
3. Create and push the matching tag, such as `v0.2.0`.
4. The release workflow validates the package and publishes `module.json` and `hero-points.zip` as release assets.

Keep the stable manifest URL as `https://github.com/AT0M1X/hero-points/releases/latest/download/module.json`; Foundry uses it to discover updates.
