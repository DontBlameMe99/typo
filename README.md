# Typo

Typo is an Android app for [Typst](https://typst.app) notes in a plain folder.
You choose that folder in Typo and work with the `.typ` notes inside it. Typo
does not register as an Android handler for `.typ` files opened from other apps.
Your `.typ` files are the source of truth. There is no account, server, or
app-specific sync layer.

<p align="center">
  <img src="docs/images/library.png" width="240" alt="Library with folders, notes, and search">
  <img src="docs/images/editor.png" width="240" alt="Source editor with Typst syntax highlighting">
  <img src="docs/images/preview.png" width="240" alt="PDF preview of a compiled note">
</p>

## Install

Typo ships as an APK on
[GitHub releases](https://github.com/DontBlameMeDev/typo/releases). It needs
Android 7.0 or newer and a 64-bit ARM phone.

### Obtainium (recommended)

[Obtainium](https://github.com/ImranR98/Obtainium) installs the APK and updates
it from the release page.

1. Install Obtainium from
   [F-Droid](https://f-droid.org/packages/dev.imranr.obtainium.fdroid/) or its
   [releases page](https://github.com/ImranR98/Obtainium/releases).
2. Tap **Add App** and paste `https://github.com/DontBlameMeDev/typo`.
3. Tap **Add**. Obtainium picks the APK from each release and offers new
   versions when they are published.

### Manual

Download `typo-<version>.apk` from the
[latest release](https://github.com/DontBlameMeDev/typo/releases/latest) and
open it. Android may ask you to allow installs from your browser or file
manager.

## Set up a vault

1. Keep the notes in one folder on the phone. To use them on more than one
   device, sync that folder with [Syncthing](https://syncthing.net) or another
   file sync tool.
2. Open Typo and pick the folder in Android's folder picker.
3. Typo remembers the folder and opens it on later launches.

If you sync the folder, pick the copy Syncthing writes, not an imported copy.
Typo opens internal storage and SD-card folders through Android's picker. Cloud
and third-party document providers are not supported.

## Use it

<p align="center">
  <img src="docs/images/demo.gif" width="300" alt="Searching for a note, opening it, and switching to the PDF preview">
</p>

Search every note's name and text as you type. Tap a folder to browse, swipe a
note right to pin it or left to move it to `.trash`, and long-press to
move it. Only the last move to trash can be undone in the app. Tap the logo to
open Settings, where the theme, accent color, and appearance live on the
Interface tab.

Source and PDF share one screen. Tap **Source** or **PDF** and the views slide
across. Type `#` to complete Typst commands, names defined with `#let`, and
imported names. Tap the ghost text or press Tab to accept. PDF text can be
selected, and web links open in the browser.

Typo compiles with bundled fonts and fetches missing `@preview` packages from
`packages.typst.org`. Add the Quick Settings tiles to start a note from
anywhere or append to a chosen note section. Set the append target in Settings
on the Library tab under Quick append.

## Template

<p align="center">
  <img src="docs/images/new-note.png" width="240" alt="New note screen with the vault folder, template, and confirm actions">
  <img src="docs/images/template.png" width="240" alt="Template editor with title and body placeholders">
</p>

New notes start from `template.typ` in the vault root. If the file does not
exist, Typo uses a default template and saving the template creates it. Open
the Template note, or tap **Template** on the New note screen, to change it. Use
`{{title}}` and `{{body}}` where the note title and text belong.

## Privacy

Notes stay on the device. Typo sends no telemetry. Typo only connects to
`packages.typst.org` to fetch missing public packages. **Report an issue** opens
your browser on GitHub and never attaches note content. If you sync the folder,
Syncthing or the file sync tool you choose handles it.

## License

GPL-3.0. See [LICENSE](LICENSE).
