# Hero Points

Hero Points is a small [Foundry Virtual Tabletop](https://foundryvtt.com/) module for DnD5e. It replaces the character sheet's inspiration control with a configurable hero-point counter and gives GMs a dialog for adjusting points across player-owned characters.

## Features

- Configurable maximum hero points per character.
- Separate session (ephemeral) and persistent hero-point pools under one shared maximum.
- Click the character-sheet counter to spend session points before persistent points.
- Chat messages respect the current roll mode.
- Persistent awards replace session points when necessary instead of being lost at the maximum.
- Persistent per-character In use status with selection shortcuts for in-use, inactive, or all characters.
- Start Session action that resets in-use characters to one session point when capacity permits.
- GM tool for adding or setting either point type on selected player characters.
- Hero points persist as actor flags.

## Using the GM controls

The Actor directory footer has two Hero Points controls:

- **Start Session** resets every in-use player character's session points to 1. Persistent points remain unchanged. A character whose persistent points already equal the maximum receives no session point.
- **Hero Points** opens the management dialog. Roster status changes save immediately, and the selection shortcuts target in-use characters, inactive characters, everyone, or no one.

When spending a point from a character sheet, session points are always consumed before persistent points. Existing point totals from module versions before 0.2.0 are migrated to persistent points.

## Compatibility

- Foundry VTT: minimum 10, verified 13.
- DnD5e system: minimum 2.0.0, verified 5.2.0.

## Install in Foundry VTT

In Foundry's **Add-on Modules** setup screen, choose **Install Module** and paste this manifest URL:

```text
https://github.com/AT0M1X/hero-points/releases/latest/download/module.json
```

After installation, enable **Hero Points (Inspiration Replacement)** in the world's module settings.

## Development testing

For immediate local iteration, clone this repository into Foundry's user-data module directory so that the checkout path ends in `Data/modules/hero-points`. On Windows, a directory junction also works:

```powershell
New-Item -ItemType Junction `
  -Path '<Foundry user data>\Data\modules\hero-points' `
  -Target '<path to this repository>'
```

Restart Foundry after changing `module.json`. JavaScript and CSS changes generally require reloading the Foundry client.

Run the package checks locally with Node.js:

```powershell
node --test tests/hero-points-state.test.mjs
node tools/validate-package.mjs
```

## Publishing a release

Prepare the manifest with a new semantic version:

```powershell
node tools/prepare-release.mjs 0.2.0
node tools/validate-package.mjs v0.2.0
```

Commit the prepared manifest, then create and push the matching tag:

```powershell
git tag v0.2.0
git push origin main
git push origin v0.2.0
```

The GitHub Actions workflow validates the tag and manifest, creates `hero-points.zip`, and attaches both the ZIP and `module.json` to the GitHub release. Foundry installations using the stable manifest URL can then detect and install the update.
