# Troubleshooting (Node build)

This covers the Node/TypeScript build in this folder. If you're using [the native exe build](../audio-switcher-exe/) instead, see [its own troubleshooting guide](../audio-switcher-exe/TROUBLESHOOTING.md).

## Changes don't seem to take effect after a rebuild

Don't rely on `npx streamdeck restart com.morgan-scruggs.audioswitcherplus-node` - it has been observed to report success while the actual plugin process keeps running completely unchanged (same PID, same start time), which can happen after a Windows reboot or whenever Stream Deck launched the plugin itself rather than through the CLI's dev-linked flow. You can check whether it actually restarted:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*audioswitcherplus-node*" } | Select-Object ProcessId, CreationDate
```

If `CreationDate` doesn't change after a restart attempt, fall back to a full relaunch, which is reliable:

```powershell
Stop-Process -Name "StreamDeck" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Start-Process "C:\Program Files\Elgato\StreamDeck\StreamDeck.exe"
```

## No property page, or does not work

1. macOS is not supported - this build is Windows-only.
2. `npm install` needs Node on `PATH` (e.g. `$env:PATH = "C:\Program Files\nodejs;" + $env:PATH` for this session) and needs to complete without errors before `npm run build`.
3. Confirm the plugin process is actually running and connected: check for a `node.exe` process whose command line includes `audioswitcherplus-node` (see command above), and check `%APPDATA%\Elgato\StreamDeck\logs\StreamDeck.log` for a line like `[com.morgan-scruggs.audioswitcherplus-node] Plugin connected`.
4. Try a full Stream Deck relaunch (see above) before anything else - see the note above about `streamdeck restart` being unreliable.

## Button presses or device-list updates feel slow

The first press or update after the plugin's background `powershell.exe` starts (when a button first appears, or a minute after the last one went off screen) waits for PowerShell to start and compile its C# helper - that one should be well under a second. After that, things should be near-instant. If they stay slow:

1. Check the plugin's log for `Audio device notifications unavailable` - without Windows' change notifications, button state only catches up on a 5-second poll.
2. Check for `Audio bridge timed out` or `Audio bridge exited` entries - the process is being restarted, which usually means antivirus/EDR interference (see below).

If responsiveness matters more to you than avoiding Smart App Control, use [the native exe build](../audio-switcher-exe/) instead.

## Devices are listed multiple times, or fuzzy matching picks the wrong one

Same underlying cause as [the exe build](../audio-switcher-exe/TROUBLESHOOTING.md#devices-are-listed-multiple-times-in-the-properties-page): Windows can leave stale/duplicate endpoint entries for a device across reconnects (especially Bluetooth). Fuzzy matching bridges a renumbered *interface* name (e.g. "Foo" becoming "2- Foo"), but **not** a changed *endpoint* name - some Bluetooth devices (e.g. gaming earbuds with a separate stereo/call-quality profile) can reappear with a different endpoint name on each reconnect, which fuzzy matching can't recognize as "the same device." A reboot has been observed to clear this up when it happens (it resets Windows' stale endpoint bookkeeping), but if it's a recurring problem, reconfigure the button with the currently-connected instance.

## Plugin's own log file isn't updating

The SDK's file logger appears to persist only `warn`/`error`-level entries to `<sdPlugin>/logs/com.morgan-scruggs.audioswitcherplus-node.<N>.log`, regardless of log level - even with `streamDeck.logger.setLevel("trace")` added to `src/plugin.ts`, `debug`/`trace` calls won't show up there. If you need finer-grained tracing while debugging, add a temporary raw `fs.appendFileSync` call to a separate file rather than relying on `streamDeck.logger`.

## Antivirus or EDR software flags or blocks the plugin

This build's whole reason for existing is to avoid Smart App Control blocking an unsigned exe - but running `powershell.exe` with inline C# (`Add-Type`) is itself a pattern some antivirus/EDR heuristics watch for, since it's also a technique malware uses. If you hit this, it's a different (and generally less severe) kind of security-software friction than the one this build was built to avoid, not a sign the plugin is doing anything it shouldn't - but it means switching to this build isn't a guaranteed fix on every machine/security posture.

## PowerShell errors mentioning execution policy

The plugin's background process runs a script via `powershell.exe -Command "<script text>"`, not a `.ps1` file, so most execution-policy restrictions (which primarily gate script *files*) shouldn't apply - but if you see an execution-policy error in the plugin's log, check `Get-ExecutionPolicy -List` and whether your organization's policy blocks non-interactive command evaluation entirely.
