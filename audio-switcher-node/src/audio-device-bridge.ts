import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AudioDeviceDirection, AudioDeviceRole, AudioSnapshot } from "./types";

const execFileAsync = promisify(execFile);

const DATA_FLOW: Record<AudioDeviceDirection, number> = { output: 0, input: 1 };

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
    [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr pClient);
    [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr pClient);
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

function buildScript(body: string): string {
	// -MTA matches the original C++ plugin's own CoInitializeEx(NULL, COINIT_MULTITHREADED) apartment
	// choice for these exact same COM calls.
	return `
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
Add-Type -TypeDefinition @'
${CSHARP_SOURCE}
'@
try {
${body}
} catch {
	Write-Output (@{ error = $_.Exception.Message } | ConvertTo-Json -Compress)
}
`;
}

async function runPowerShell(script: string): Promise<string> {
	const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-MTA", "-Command", script], {
		timeout: 10000,
		maxBuffer: 20 * 1024 * 1024
	});
	return stdout.trim();
}

const SNAPSHOT_SCRIPT = buildScript(`
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
	Write-Output ($result | ConvertTo-Json -Depth 6 -Compress)
`);

/** Fetches the full device list plus current default/communications device IDs for both directions. */
export async function getSnapshot(): Promise<AudioSnapshot> {
	const stdout = await runPowerShell(SNAPSHOT_SCRIPT);
	const parsed = JSON.parse(stdout);
	if (parsed.error) throw new Error(`Audio bridge error: ${parsed.error}`);

	// ConvertTo-Json renders an empty Hashtable as {} (fine) but a *single-key* Hashtable's "devices"
	// value round-trips correctly since Hashtable (unlike a PS array) always serializes as a JSON
	// object regardless of entry count - so no extra normalization is needed here.
	return parsed as AudioSnapshot;
}

/**
 * Sets the default endpoint for one role. The device ID itself already implies a direction (a render
 * vs. capture endpoint), so no separate direction argument is needed here. For ButtonRole "all", call
 * this twice (once with role "default", once with "communication").
 */
export async function setDefaultDevice(role: AudioDeviceRole, deviceId: string): Promise<boolean> {
	const script = buildScript(`
		$ok = [AudioBridge]::SetDefault("${deviceId.replace(/`/g, "``").replace(/"/g, '`"')}", ${ROLE[role]})
		Write-Output (@{ ok = $ok } | ConvertTo-Json -Compress)
	`);
	const stdout = await runPowerShell(script);
	const parsed = JSON.parse(stdout);
	if (parsed.error) throw new Error(`Audio bridge error: ${parsed.error}`);
	return !!parsed.ok;
}

export { DATA_FLOW, ROLE };
