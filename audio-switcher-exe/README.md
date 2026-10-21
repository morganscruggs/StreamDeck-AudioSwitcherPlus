# Audio Switcher Plus (native/exe)

The original, native C++ build of this plugin - see [the repo root README](../README.md) for how this compares to the [Node-based build](../audio-switcher-node/), and for the notes/thanks/license shared by both.

It supports:

original
- setting input or output device
- setting default device or communication device
- either one-button-per-device, or one button to toggle between two devices

new
- ability to set both default device **and** communication device
- choosing a custom icon per button(headphones, earbuds, speaker, mic)
- choosing custom colors for icons in both On and Off modes
- simplified device selecton 
  - ability to remove unplugged devices
  - ability to remove device type (which windows gets wrong often) from selection box


For example, this can be useful to switch between headphones and speakers if they are on different sound cards (e.g. USB speakers or USB headphones).

By default, new buttons use fuzzy device matching and the "All" role (affecting both the default and communication device) - both can be changed per-button in the property inspector.

## Custom Icons & Colors

Both "Set Audio Device" and "Toggle Audio Device" buttons let you pick an icon (Earbuds, Headphones, Mic, or Speaker) instead of the plugin's default images, plus a color for each of the button's states:

- **Set Audio Device** has one icon with two colors - "On" (shown when the configured device is the active one) and "Off" (shown otherwise, defaulting to a dimmed grey).
- **Toggle Audio Device** has two icons - one per device it switches between - each with its own color, defaulting to white.

Icon choices are picked up automatically from [`../shared/AudioDevicesIcons/`](../shared/AudioDevicesIcons/) (copied into the plugin at build time); each file must be a white silhouette on a transparent background (the colors above are applied by recoloring the shape at runtime, not by swapping images), and its filename becomes the option's name in the picker. Drop in a new `<name>.png` file there to add another choice without any code changes.

# Release 0.1.0

This is the first release of Audio Switcher Plus as its own product, forked and rebranded from Fred Emmott's original Audio Switcher. The core device-switching logic is unchanged from the upstream project and has years of real-world use behind it; everything listed above under "(new)" - custom icons/colors, hiding disabled devices, hiding device type, and the "All" role - is new in this release and hasn't had the same amount of testing yet. If something regresses, [check the troubleshooting guide](TROUBLESHOOTING.md) or open an issue.

**A note on Windows App Control:** this build is not yet code-signed. On Windows 11 systems with **Smart App Control** enabled (Settings > Privacy & security > Windows Security > App & browser control), an unsigned, newly-built executable like this one can be blocked from running entirely - Stream Deck will show the button, but the plugin itself never actually starts, so device lists stay empty and buttons never update. This isn't a bug in the plugin so much as a Windows security feature reacting to the lack of a signature; see [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for how to confirm it and your options, or use [the Node-based build](../audio-switcher-node/) instead, which was built specifically to avoid this. Proper code signing is planned for a future release.

# Video Demo

[![YouTube Demo Video](https://img.youtube.com/vi/Y5avo5WrwwM/0.jpg)](https://www.youtube.com/watch?v=Y5avo5WrwwM)

# Installation

Download the `com.morganscruggs.audioswitcherplus.streamDeckPlugin` file from [the releases page](https://github.com/morganscruggs/StreamDeck-AudioSwitcher/releases), and double-click it.

# Building From Source

Requires Visual Studio 2022 (with the "Desktop development with C++" workload) and CMake 3.28+ (the one bundled with current Visual Studio 2022 is fine). Windows only - see [the repo root README](../README.md).

```powershell
cd audio-switcher-exe
cmake -E make_directory build
cd build
cmake ..
cmake --build . --config RelWithDebInfo --target install --parallel
```

This compiles `sdaudioswitchplus.exe` and installs it, along with the property inspector, icons, and manifest, into `../com.morganscruggs.audioswitcherplus.sdPlugin` at the repo root (the default `CMAKE_INSTALL_PREFIX`, set by `set_default_install_dir_to_repo_root()` in `StreamDeckSDK.cmake`). The install step then automatically mirrors that folder into `%APPDATA%\Elgato\StreamDeck\Plugins\com.morganscruggs.audioswitcherplus.sdPlugin` (`sync_install_to_streamdeck_plugin_dir()`, same file) - the same way [the Node build](../audio-switcher-node/)'s rollup config syncs its own output. Configure with `-DSYNC_TO_STREAMDECK=OFF` to skip that sync (CI does, and it's also handy for building while Stream Deck is running). The `build/` directory can be reused for later builds; swap `RelWithDebInfo` for `Debug` to build that configuration instead.

The version number comes from [`shared/VERSION`](../shared/VERSION), shared with the Node build, with the CI run number (or `0` locally) appended as the fourth component.

**Before rebuilding, fully quit Stream Deck** - its main process holds file handles inside the Plugins folder, and the install step's sync silently fails with a permission error otherwise (the build itself still succeeds). Relaunch it afterward to pick up the new build:

```powershell
Stop-Process -Name "StreamDeck" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
cmake --build . --config RelWithDebInfo --target install --parallel
Start-Process "C:\Program Files\Elgato\StreamDeck\StreamDeck.exe"
```
