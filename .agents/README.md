# Hero Points project context

Hero Points is a small Foundry Virtual Tabletop module for the DnD5e system. It replaces the character sheet's inspiration control with a configurable hero-point counter and gives GMs a directory tool for awarding or setting points on player-owned characters.

## Project layout

- `module.json` is the Foundry package manifest and the source of truth for the released version.
- `scripts/hero-points.js` contains settings registration, sheet injection, point spending, chat output, and the GM mass-award dialog.
- `styles/hero-points.css` styles the injected counter and GM dialog and hides the original inspiration control.
- `tools/validate-package.mjs` validates the manifest, release URLs, referenced assets, and optional release tag.
- `tools/prepare-release.mjs` updates the manifest version and version-specific download URL.
- `.github/workflows/release.yml` packages and publishes GitHub releases when a `v*` tag is pushed.

## Development notes

- The module id and installed folder name must remain `hero-points`.
- The code runs inside Foundry and intentionally uses Foundry globals such as `Hooks`, `game`, `ui`, `ChatMessage`, `Dialog`, and `Actor`, plus the jQuery global `$`.
- Hero-point values are stored on actors in the `hero-points.points` flag. The maximum is a world-scoped setting named `hero-points.maxPoints`.
- Preserve the DnD5e-only guard and character-only guard when changing sheet injection behavior.
- Do not claim compatibility with a Foundry or DnD5e version until it has been exercised in that version.
- Run `node tools/validate-package.mjs` before committing manifest or release changes.

## Release process

1. Run `node tools/prepare-release.mjs <version>` using a plain semantic version such as `0.2.0`.
2. Review and test the changes, then commit them to `main`.
3. Create and push the matching tag, such as `v0.2.0`.
4. The release workflow validates the package and publishes `module.json` and `hero-points.zip` as release assets.

Keep the stable manifest URL as `https://github.com/AT0M1X/hero-points/releases/latest/download/module.json`; Foundry uses it to discover updates.
