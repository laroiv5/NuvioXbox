# NuvioXbox Domain Context

This project adapts `NuvioMedia/NuvioTVSmart` (a 10-foot Smart TV web application licensed under GPLv3) into a native **Xbox Series X|S** UWP (`x64`) application for Xbox Developer Mode.

## Domain Vocabulary

- **WebCore**: The `NuvioTVSmart` 10-foot TV frontend (`1920x1080` viewport) bundled by `scripts/build.mjs` into `dist/` and staged into `xbox-uwp/NuvioXbox/WebCode/`.
- **EnvHydrator**: `scripts/hydrate-official-env.mjs`, which fetches the latest official `NuvioTV-Tizen-*.wgt` release archive from `NuvioMedia/NuvioTVSmart` at build time and extracts `nuvio.env.js` into `dist/nuvio.env.js` without committing or logging credentials.
- **XboxAdapter**: `js/platform/adapters/xboxAdapter.js`, the platform adapter (`name: "xbox"`) registering Xbox viewport scaling, key normalization, capabilities, and host bridges.
- **HostBridge**: `js/platform/xbox/xboxHostBridge.js`, the `window.chrome.webview` bidirectional JSON message bridge between `WebCore` and the UWP C# shell (Back requests, SMTC media remote buttons, `DisplayRequest` wake-lock, and app exit).
- **GamepadBridge**: `js/platform/xbox/xboxGamepadBridge.js`, polling `navigator.getGamepads()` and normalizing UWP `Gamepad*` keycodes (`195..214`) to standard `FocusEngine` arrow/enter/back/media events with a `140ms` deduplication guard.
- **XboxAvPlayBridge**: `js/platform/xbox/xboxAvPlayBridge.js`, an `avplay`-compatible JavaScript interface backed by C# `NativeMediaBridge.cs` (`Windows.Media.Playback.MediaPlayer` + XAML `MediaPlayerElement` underneath a transparent `WebView2`) for MKV, HEVC, AC3, EAC3, and multi-audio Debrid streams, while `hls.js`, `dash.js`, and HTML5 `<video>` handle adaptive and standard web formats.
- **UwpShell**: `xbox-uwp/NuvioXbox/`, the pure-C# UWP (`Microsoft.UI.Xaml` + `Microsoft.Web.WebView2`) project packaged as an `.msix` / `.appx` (`x64`) via GitHub Actions (`windows-latest`).
