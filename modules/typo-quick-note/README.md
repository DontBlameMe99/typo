# TypoQuickNote

Android-only local Expo module for the "New note" and "Append note" Quick Settings tiles. Expo autolinking finds it in `modules` without a package dependency or config plugin.

`QuickTileService` opens a translucent activity over the keyguard. API 34 and newer use `startActivityAndCollapse(PendingIntent)`, older versions the deprecated `Intent` overload. Both tiles read `typo-vault.json` from the app's files directory, the same selection `src/vault.ts` owns, and report `STATE_UNAVAILABLE` until a vault is selected. The append tile also requires `typo-quick-append.json`, the target written by `src/quick-append-config.ts`. Taps do nothing until those files exist.

`QuickNoteActivity` and `QuickAppendActivity` are translucent `ReactActivity` classes that render the `quickNote` and `quickAppend` components registered in `index.ts`, so they share the app's React host and JS runtime. Back and `finish()` close them once the note is written.

Rebuild the Android app after changing this module. Expo Go does not include it.
