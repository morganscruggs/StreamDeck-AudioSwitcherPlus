# Agent notes

## Two versions, developed in parallel

This repo holds two independent implementations of the same plugin, kept at feature parity (see [`README.md`](README.md), "Two implementations, one plugin"):

- **Native/exe (C++):** [`audio-switcher-exe/`](audio-switcher-exe/) - sources in `Sources/`, manifest template in `sdPlugin/`.
- **Node (TypeScript):** [`audio-switcher-node/`](audio-switcher-node/) - sources in `src/`; its manifest lives in [`com.morgan-scruggs.audioswitcherplus-node.sdPlugin/`](com.morgan-scruggs.audioswitcherplus-node.sdPlugin/).

Shared between both are in [`shared/`](shared/): the button icons, the property inspector (one copy - each build copies it in, and it tells the plugins/actions apart at runtime, so a PI change is automatically a change to both), and the `VERSION` file both builds read their version from (bump it there, not in either manifest). The untracked `com.morganscruggs.audioswitcherplus.sdPlugin/` at the repo root is exe build output - don't edit it; likewise the node plugin folder's `bin/`, `AudioDevicesIcons/` and `propertyinspector/`.

**Unless the user says otherwise, apply every change to both versions** - features, bug fixes, and UI/property-inspector changes alike - adapting to each one's language and structure rather than copying code verbatim. If a change genuinely only applies to one (e.g. a PowerShell-bridge issue in the node version, or a CMake/build issue in the exe version), say so rather than silently skipping the other. When reporting back, state which version(s) were changed.

## Building

Before building, rebuilding, or installing either plugin in this repo, read the build steps in the README rather than guessing:

- Native/exe plugin: [`audio-switcher-exe/README.md`](audio-switcher-exe/README.md) ("Building From Source")
- Node plugin: [`audio-switcher-node/README.md`](audio-switcher-node/README.md) ("Building")
- Overview of both, and the shared gotcha below: [`README.md`](README.md) ("Building")

The one thing both share and easy to miss: **fully quit Stream Deck before building/installing.** Its main process (`StreamDeck.exe`), not just the plugin's own process, holds file handles inside `%APPDATA%\Elgato\StreamDeck\Plugins\`, and the install step's auto-sync to that folder fails with a permission error if Stream Deck is running - the compile itself will still report success, so this is easy to misdiagnose as "installed but not picked up." Relaunch Stream Deck after the build completes.
