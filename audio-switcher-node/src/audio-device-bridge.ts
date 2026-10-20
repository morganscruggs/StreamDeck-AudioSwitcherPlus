import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { AudioDeviceRole, AudioSnapshot } from "./types";

// Only eConsole (0) and eCommunications (2) are ever used - confirmed from the original plugin's
// AudioDevicesWindows.cpp: AudioDeviceRoleToERole() never maps to eMultimedia (1), and its
// IMMNotificationClient callback explicitly ignores eMultimedia changes.
const ROLE: Record<AudioDeviceRole, number> = { default: 0, communication: 2 };

/**
 * Raw COM interop for the Windows Core Audio APIs, compiled on the fly by PowerShell via Add-Type.
 * `IMMDeviceEnumerator`/`IMMDevice`/`IPropertyStore` are standard, documented interfaces (mmdeviceapi.h).
 * `IPolicyConfigVista` is undocumented; its IID, CLSID and vtable order (method order matters - COM
 * interop resolves methods by slot position, not name) are taken verbatim from the CMake-vendored
 * `audiodevicelib` dependency's `PolicyConfig.h`/`AudioDevicesWindows.cpp`, which this exact plugin
 * already uses successfully today via `IPolicyConfigVista`/`CPolicyConfigVistaClient` (Windows 7+).
 */
const CSHARP_SOURCE = `
using System;
using System.Collections;
using System.Runtime.InteropServices;

public enum EDataFlow { eRender = 0, eCapture = 1, eAll = 2 }
public enum ERole { eConsole = 0, eMultimedia = 1, eCommunications = 2 }

[StructLayout(LayoutKind.Sequential)]
public struct PROPERTYKEY
{
    public Guid fmtid;
    public int pid;
    public PROPERTYKEY(string guid, int pid) { fmtid = new Guid(guid); this.pid = pid; }
}

[StructLayout(LayoutKind.Explicit)]
public struct PROPVARIANT
{
    [FieldOffset(0)] public ushort vt;
    [FieldOffset(8)] public IntPtr pointerValue;
}

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator
{
    [PreserveSig] int EnumAudioEndpoints(EDataFlow dataFlow, int dwStateMask, out IMMDeviceCollection ppDevices);
    [PreserveSig] int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice ppEndpoint);
    [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string pwstrId, out IMMDevice ppDevice);
    [PreserveSig] int RegisterEndpointNotificationCallback(IMMNotificationClient pClient);
    [PreserveSig] int UnregisterEndpointNotificationCallback(IMMNotificationClient pClient);
}

// Implemented below (not imported), so Windows can call back into this process when devices or defaults
// change. Method order is the vtable order from mmdeviceapi.h.
[Guid("7991EEC9-7E89-4D85-8390-6C703CEC60C0"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMNotificationClient
{
    [PreserveSig] int OnDeviceStateChanged([MarshalAs(UnmanagedType.LPWStr)] string pwstrDeviceId, int dwNewState);
    [PreserveSig] int OnDeviceAdded([MarshalAs(UnmanagedType.LPWStr)] string pwstrDeviceId);
    [PreserveSig] int OnDeviceRemoved([MarshalAs(UnmanagedType.LPWStr)] string pwstrDeviceId);
    [PreserveSig] int OnDefaultDeviceChanged(EDataFlow flow, ERole role, [MarshalAs(UnmanagedType.LPWStr)] string pwstrDefaultDeviceId);
    [PreserveSig] int OnPropertyValueChanged([MarshalAs(UnmanagedType.LPWStr)] string pwstrDeviceId, PROPERTYKEY key);
}

// Each callback just tells the plugin "something changed" - it re-reads the whole snapshot (debounced),
// which keeps all the state logic on the Node side. Property changes are ignored (they're frequent and
// rarely matter; the plugin's safety-net poll picks up renames), as are eMultimedia default changes,
// matching the C++ plugin.
public class NotificationClient : IMMNotificationClient
{
    public int OnDeviceStateChanged(string pwstrDeviceId, int dwNewState) { AudioBridge.EmitChanged(); return 0; }
    public int OnDeviceAdded(string pwstrDeviceId) { AudioBridge.EmitChanged(); return 0; }
    public int OnDeviceRemoved(string pwstrDeviceId) { AudioBridge.EmitChanged(); return 0; }
    public int OnDefaultDeviceChanged(EDataFlow flow, ERole role, string pwstrDefaultDeviceId)
    {
        if (role != ERole.eMultimedia) AudioBridge.EmitChanged();
        return 0;
    }
    public int OnPropertyValueChanged(string pwstrDeviceId, PROPERTYKEY key) { return 0; }
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
public class MMDeviceEnumeratorComObj { }

[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceCollection
{
    [PreserveSig] int GetCount(out int pcDevices);
    [PreserveSig] int Item(int nDevice, out IMMDevice ppDevice);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice
{
    [PreserveSig] int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
    [PreserveSig] int OpenPropertyStore(int stgmAccess, out IPropertyStore ppProperties);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
    [PreserveSig] int GetState(out int pdwState);
}

[ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPropertyStore
{
    [PreserveSig] int GetCount(out int cProps);
    [PreserveSig] int GetAt(int iProp, out PROPERTYKEY pkey);
    [PreserveSig] int GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
    [PreserveSig] int SetValue(ref PROPERTYKEY key, ref PROPVARIANT propvar);
    [PreserveSig] int Commit();
}

// Undocumented - see this file's header comment for provenance of the IID/CLSID/vtable order.
[ComImport, Guid("568b9108-44bf-40b4-9006-86afe5b5a620"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPolicyConfigVista
{
    [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, out IntPtr ppFormat);
    [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int bDefault, out IntPtr ppFormat);
    [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr pEndpointFormat, IntPtr pMixFormat);
    [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int bDefault, out long pmftDefaultPeriod, out long pmftMinimumPeriod);
    [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, ref long pmftPeriod);
    [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, out IntPtr pMode);
    [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr mode);
    [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, ref PROPERTYKEY key, out PROPVARIANT value);
    [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, ref PROPERTYKEY key, ref PROPVARIANT value);
    [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, ERole role);
    [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int bVisible);
}

[ComImport, Guid("294935CE-F637-4E7C-A41B-AB255460B862")]
public class CPolicyConfigVistaClient { }

public static class AudioBridge
{
    [DllImport("ole32.dll")]
    static extern int PropVariantClear(ref PROPVARIANT pvar);

    const int VT_LPWSTR = 31;
    const int DEVICE_STATEMASK_ALL = 0xF;
    const int DEVICE_STATE_ACTIVE = 0x1;
    const int DEVICE_STATE_DISABLED = 0x2;
    const int DEVICE_STATE_NOTPRESENT = 0x4;
    const int DEVICE_STATE_UNPLUGGED = 0x8;

    static readonly PROPERTYKEY PKEY_Device_FriendlyName = new PROPERTYKEY("a45c254e-df1c-4efd-8020-67d146a850e0", 14);
    static readonly PROPERTYKEY PKEY_Device_DeviceDesc = new PROPERTYKEY("a45c254e-df1c-4efd-8020-67d146a850e0", 2);
    static readonly PROPERTYKEY PKEY_DeviceInterface_FriendlyName = new PROPERTYKEY("026e516e-b814-414b-83cd-856d6fef4822", 2);

    static IMMDeviceEnumerator CreateEnumerator()
    {
        return (IMMDeviceEnumerator)new MMDeviceEnumeratorComObj();
    }

    // Replies (from the PowerShell loop's thread) and change events (from COM's notification threads)
    // share stdout, so every line goes through here to keep them from interleaving.
    static readonly object OutputLock = new object();

    public static void Emit(string line)
    {
        lock (OutputLock)
        {
            Console.Out.WriteLine(line);
            Console.Out.Flush();
        }
    }

    public static void EmitChanged()
    {
        // Must not throw back into COM - if stdout is gone, the plugin is too, and the read loop's EOF
        // will end this process.
        try { Emit("{\\"event\\":\\"changed\\"}"); } catch { }
    }

    // Kept in static fields so the registration (and the callback object) live as long as the process.
    static IMMDeviceEnumerator notificationEnumerator;
    static NotificationClient notificationClient;

    public static bool StartNotifications()
    {
        try
        {
            notificationEnumerator = CreateEnumerator();
            notificationClient = new NotificationClient();
            return notificationEnumerator.RegisterEndpointNotificationCallback(notificationClient) == 0;
        }
        catch
        {
            return false;
        }
    }

    static string GetStringProperty(IPropertyStore store, PROPERTYKEY key)
    {
        PROPVARIANT value;
        int hr = store.GetValue(ref key, out value);
        if (hr != 0) return "";
        try
        {
            if (value.vt != VT_LPWSTR || value.pointerValue == IntPtr.Zero) return "";
            return Marshal.PtrToStringUni(value.pointerValue) ?? "";
        }
        finally
        {
            PropVariantClear(ref value);
        }
    }

    static string StateToString(int nativeState)
    {
        switch (nativeState)
        {
            case DEVICE_STATE_ACTIVE: return "connected";
            case DEVICE_STATE_DISABLED: return "device_disabled";
            case DEVICE_STATE_NOTPRESENT: return "device_not_present";
            case DEVICE_STATE_UNPLUGGED: return "device_present_no_connection";
            default: return "device_not_present";
        }
    }

    public static Hashtable ListDevices(int dataFlow, string directionLabel)
    {
        var result = new Hashtable();
        var enumerator = CreateEnumerator();
        IMMDeviceCollection collection;
        enumerator.EnumAudioEndpoints((EDataFlow)dataFlow, DEVICE_STATEMASK_ALL, out collection);
        int count;
        collection.GetCount(out count);

        for (int i = 0; i < count; i++)
        {
            IMMDevice device;
            collection.Item(i, out device);

            string id;
            device.GetId(out id);

            IPropertyStore props;
            int hr = device.OpenPropertyStore(0, out props);
            if (hr != 0 || props == null) continue;

            string displayName = GetStringProperty(props, PKEY_Device_FriendlyName);
            if (string.IsNullOrEmpty(displayName)) continue;
            string interfaceName = GetStringProperty(props, PKEY_DeviceInterface_FriendlyName);
            string endpointName = GetStringProperty(props, PKEY_Device_DeviceDesc);

            int nativeState;
            device.GetState(out nativeState);

            var entry = new Hashtable();
            entry["id"] = id;
            entry["interfaceName"] = interfaceName;
            entry["endpointName"] = endpointName;
            entry["displayName"] = displayName;
            entry["direction"] = directionLabel;
            entry["state"] = StateToString(nativeState);
            result[id] = entry;
        }

        return result;
    }

    public static string GetDefaultId(int dataFlow, int role)
    {
        try
        {
            var enumerator = CreateEnumerator();
            IMMDevice device;
            int hr = enumerator.GetDefaultAudioEndpoint((EDataFlow)dataFlow, (ERole)role, out device);
            if (hr != 0 || device == null) return "";
            string id;
            device.GetId(out id);
            return id ?? "";
        }
        catch
        {
            return "";
        }
    }

    public static bool SetDefault(string deviceId, int role)
    {
        try
        {
            var policyConfig = (IPolicyConfigVista)new CPolicyConfigVistaClient();
            int hr = policyConfig.SetDefaultEndpoint(deviceId, (ERole)role);
            return hr == 0;
        }
        catch
        {
            return false;
        }
    }
}
`;

/**
 * The bridge process's whole program: compile the C# once, register for device-change notifications,
 * then serve one JSON request per stdin line with one JSON reply per stdout line, until stdin closes.
 * Request arguments (notably device IDs, which come from button settings and so can arrive via an
 * imported profile) only ever travel as JSON data - never spliced into script text, where something
 * like "$(...)" would execute.
 *
 * -MTA (below) matches the C++ plugin's CoInitializeEx(NULL, COINIT_MULTITHREADED) for these same COM
 * calls, and lets the notification callbacks arrive on COM's own threads while this loop blocks on stdin.
 *
 * ConvertTo-Json always renders a Hashtable as a JSON object regardless of entry count (unlike a PS
 * array), so the "devices" maps need no normalization on the Node side.
 */
const BRIDGE_SCRIPT = `
$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
${CSHARP_SOURCE}
'@
$notifications = [AudioBridge]::StartNotifications()
[AudioBridge]::Emit((@{ event = "ready"; notifications = $notifications } | ConvertTo-Json -Compress))
while ($null -ne ($line = [Console]::In.ReadLine())) {
	if ($line.Trim() -eq "") { continue }
	$id = $null
	try {
		$request = $line | ConvertFrom-Json
		$id = $request.id
		if ($request.op -eq "snapshot") {
			$result = @{
				output = @{
					devices = [AudioBridge]::ListDevices(0, "output")
					defaultDeviceId = [AudioBridge]::GetDefaultId(0, 0)
					communicationsDeviceId = [AudioBridge]::GetDefaultId(0, 2)
				}
				input = @{
					devices = [AudioBridge]::ListDevices(1, "input")
					defaultDeviceId = [AudioBridge]::GetDefaultId(1, 0)
					communicationsDeviceId = [AudioBridge]::GetDefaultId(1, 2)
				}
			}
		} elseif ($request.op -eq "setDefault") {
			$result = @{ ok = [AudioBridge]::SetDefault([string]$request.deviceId, [int]$request.role) }
		} else {
			throw "Unknown request: $($request.op)"
		}
		[AudioBridge]::Emit((@{ id = $id; result = $result } | ConvertTo-Json -Depth 8 -Compress))
	} catch {
		[AudioBridge]::Emit((@{ id = $id; error = $_.Exception.Message } | ConvertTo-Json -Compress))
	}
}
`;

// Generous because the first request after a (re)start also waits out the one-off Add-Type compile.
const REQUEST_TIMEOUT_MS = 15000;

type PendingRequest = {
	resolve: (result: unknown) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
};

type BridgeProcess = {
	child: ChildProcessWithoutNullStreams;
	pending: Map<number, PendingRequest>;
};

export type AudioBridgeOptions = {
	/** Called (undebounced - Windows raises bursts) when devices or default devices change. */
	onChanged?: () => void;
	/** Called once per process start, saying whether change notifications could be registered. */
	onReady?: (notifications: boolean) => void;
	/** Unexpected output from the bridge process (stderr, or stdout that isn't a protocol line). */
	onLog?: (message: string) => void;
};

/**
 * A long-lived `powershell.exe` running {@link BRIDGE_SCRIPT}, so each request costs an in-process COM
 * call rather than a fresh PowerShell start plus C# compile. Started on the first request, and restarted
 * on the next request if it dies (pending requests are rejected) or hangs (requests time out, and the
 * process is killed).
 */
export class AudioBridge {
	private readonly options: AudioBridgeOptions;
	private process: BridgeProcess | undefined;
	private nextId = 1;
	private notifications: boolean | undefined;

	constructor(options: AudioBridgeOptions = {}) {
		this.options = options;
	}

	/** Whether the running process has change notifications registered; undefined until it reports in. */
	get notificationsActive(): boolean | undefined {
		return this.notifications;
	}

	/** Fetches the full device list plus current default/communications device IDs for both directions. */
	async getSnapshot(): Promise<AudioSnapshot> {
		return (await this.request("snapshot")) as AudioSnapshot;
	}

	/**
	 * Sets the default endpoint for one role. The device ID itself already implies a direction (a render
	 * vs. capture endpoint), so no separate direction argument is needed here. For ButtonRole "all", call
	 * this twice (once with role "default", once with "communication").
	 */
	async setDefaultDevice(role: AudioDeviceRole, deviceId: string): Promise<boolean> {
		const result = (await this.request("setDefault", { role: ROLE[role], deviceId })) as { ok?: boolean };
		return !!result.ok;
	}

	/** Ends the process (closing its stdin ends the read loop); the next request starts a new one. */
	stop(): void {
		const proc = this.process;
		if (!proc) return;
		this.process = undefined;
		this.notifications = undefined;
		proc.child.stdin.end();
		setTimeout(() => proc.child.kill(), 2000).unref();
	}

	private request(op: string, args: Record<string, unknown> = {}): Promise<unknown> {
		const proc = this.ensureStarted();
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				proc.pending.delete(id);
				reject(new Error(`Audio bridge timed out on "${op}"`));
				// Something's wedged - start fresh on the next request.
				if (this.process === proc) this.process = undefined;
				proc.child.kill();
			}, REQUEST_TIMEOUT_MS);
			proc.pending.set(id, { resolve, reject, timer });
			proc.child.stdin.write(`${JSON.stringify({ id, op, ...args })}\n`);
		});
	}

	private ensureStarted(): BridgeProcess {
		if (this.process) return this.process;

		const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-MTA", "-Command", BRIDGE_SCRIPT], {
			stdio: "pipe",
			windowsHide: true
		});
		const proc: BridgeProcess = { child, pending: new Map() };
		this.process = proc;
		this.notifications = undefined;

		createInterface({ input: child.stdout }).on("line", (line) => this.onLine(proc, line));
		createInterface({ input: child.stderr }).on("line", (line) => {
			if (line.trim()) this.options.onLog?.(`Audio bridge stderr: ${line}`);
		});
		// Writes after the process has died fail with EPIPE; the "exit" handler does the cleanup.
		child.stdin.on("error", () => undefined);
		child.on("error", (error) => this.onExit(proc, error));
		child.on("exit", (code, signal) => this.onExit(proc, new Error(`Audio bridge exited (${signal ?? `code ${code}`})`)));
		return proc;
	}

	private onLine(proc: BridgeProcess, line: string): void {
		if (!line.trim()) return;

		let message: { id?: number; event?: string; notifications?: boolean; result?: unknown; error?: string };
		try {
			message = JSON.parse(line);
		} catch {
			this.options.onLog?.(`Audio bridge output: ${line}`);
			return;
		}

		if (message.event === "changed") {
			this.options.onChanged?.();
			return;
		}
		if (message.event === "ready") {
			if (this.process === proc) this.notifications = !!message.notifications;
			this.options.onReady?.(!!message.notifications);
			return;
		}

		const pending = message.id === undefined ? undefined : proc.pending.get(message.id);
		if (!pending) return;
		proc.pending.delete(message.id!);
		clearTimeout(pending.timer);
		if (message.error) pending.reject(new Error(`Audio bridge error: ${message.error}`));
		else pending.resolve(message.result);
	}

	private onExit(proc: BridgeProcess, error: Error): void {
		if (this.process === proc) {
			this.process = undefined;
			this.notifications = undefined;
		}
		for (const pending of proc.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		proc.pending.clear();
	}
}
