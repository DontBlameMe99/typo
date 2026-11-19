---
name: mobile-testing
description: Use when wanting to test the app.
---

## Goal

Get the current worktree running on a phone through Expo Go and Tailscale, or
through a native APK when the change needs it.

## Rules

- Run `bun test` before starting.
- Use a disposable demo vault. Never use private notes in screenshots or
  recordings.
- Do not use Expo Go to verify native changes. Use a native build.
- After rebuilding web bundles, fully reload the app.

## Expo Go

Start the dev server:

```sh
./scripts/dev-mobile.sh start
```

Send the user the printed `exp://` link. The script rebuilds `dist/` when
needed.

Other commands: `status`, `rebuild`. Logs are in `~/.cache/typo-dev/logs/`.

Deleting the worktree stops its server on its own, within a minute. `start`
also prunes dead reservations and restarts a wedged server on its port, so
there is no stop or restart step.

## Evidence

There is no PIL. Use the binaries on `PATH`:

```sh
magick in.png -crop 740x70+60+580 +repage out.png
magick in.png -format %c histogram:info:- | sort -rn | head
```

Use the T3 device tools (`device_list`, `device_open`, `device_screenshot`)
directly. Never `adb -s emulator-5554`. After two failed opens, stop and report
blocked.

`html_preview` cannot show a device screen. Send the png as an attachment.

## Native changes

Splash, icons, permissions, and `modules/typo-vault` cannot be tested through
Expo Go. Expo Go uses the async filesystem fallback, not the native vault I/O.

For these changes:

- Install an APK from CI, or build one with `bun run android` on an attached
  device or emulator.
- Rebuild the APK after changing the native module.
