# Audio Switcher Plus (Node)

A Node/TypeScript rebuild of [the native C++ plugin](../audio-switcher-exe/) - see [the repo root README](../README.md) for how the two compare, and for the notes/thanks/license shared by both.

## Why this exists

The native build ships its own compiled executable (`sdaudioswitchplus.exe`). On Windows 11 with **Smart App Control** enabled, that unsigned, freshly-compiled, no-reputation exe can be blocked outright - the button shows up in Stream Deck, but the plugin process never actually starts. This build sidesteps that by never launching its own executable at all: it runs inside Stream Deck's own bundled, signed `node.exe`, the same way [the sibling Multi Volume Controller plugin](https://github.com/morgan-scruggs/Stream-Deck-Dial-Multi-Volume-Control) does.

## How device switching works

There's no public Node API for enumerating audio devices or changing the default one, so this shells out to Microsoft-signed `powershell.exe` and runs inline C# (via `Add-Type`) doing raw COM interop - see [`src/audio-device-bridge.ts`](src/audio-device-bridge.ts). The COM interfaces used (`IMMDeviceEnumerator` and the undocumented `IPolicyConfigVista`) are the exact same ones the native build uses via its vendored `audiodevicelib` dependency - same GUIDs, same vtable order, just called from a different host process.

That PowerShell process is started once and kept running while any button is on screen (it exits a minute after the last one goes away): it compiles the C# once, then takes JSON requests on stdin and answers on stdout. It also registers the same `IMMNotificationClient` callback the native build uses, and relays each device or default-device change to `src/audio-device-service.ts`, which refreshes button state straight away. A 30-second poll stays on as a safety net (every 5 seconds if notifications can't be registered).

**Trade-off:** the first request after the process starts waits for PowerShell to start and compile the C# (well under a second on a typical machine); after that, switches and updates are close to the native build's speed. If even that matters more to you than the Smart App Control issue, use [the exe build](../audio-switcher-exe/) instead.

## Feature parity

Same settings/behavior as the native build: input/output direction, default/communication/"all" role, fuzzy device matching for devices that get renumbered by Windows, and per-button custom icons/colors. Icons are pulled from [`../shared/AudioDevicesIcons/`](../shared/AudioDevicesIcons/) at build time (see `copy-shared-icons` in `rollup.config.mjs`) rather than kept as a separate copy.

## Building

```
npm install
npm run build
```

This compiles `src/plugin.ts` into `com.morgan-scruggs.audioswitcherplus-node.sdPlugin/bin/plugin.js` and, if `%APPDATA%\Elgato\StreamDeck\Plugins\` exists and isn't a symlink back to this folder, copies the whole built plugin folder there. Set `SYNC_TO_STREAMDECK=0` to skip that copy (CI does).

The build also stamps the manifest's `Version` from [`shared/VERSION`](../shared/VERSION), shared with the exe build, so bump the version there rather than in `manifest.json`.

`npm run typecheck` type-checks the sources and tests; `npm test` runs the tests.

**After any code change, restart Stream Deck fully** rather than relying on `npx streamdeck restart <uuid>` - that command has been observed to silently report success without actually restarting the plugin process (e.g. after a Windows reboot), leaving you testing a stale build:

```powershell
Stop-Process -Name "StreamDeck" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Start-Process "C:\Program Files\Elgato\StreamDeck\StreamDeck.exe"
```

## Packaging

CI packages both this and the native build into `.streamDeckPlugin` files with `streamdeck pack` from `@elgato/cli` (a dev dependency here), and pushing a tag drafts a GitHub release with them - see the root README. To pack locally, run `npx streamdeck pack ../com.morgan-scruggs.audioswitcherplus-node.sdPlugin --output <dir>` after building. Note that `pack` rewrites `manifest.json` in place (dropping its final newline), so discard that change afterward.
