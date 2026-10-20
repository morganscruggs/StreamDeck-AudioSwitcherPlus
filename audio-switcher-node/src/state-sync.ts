import type { KeyAction } from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import { getVolatileDeviceId } from "./device-match";
import { audioDeviceService } from "./audio-device-service";
import type { AudioSnapshot, ButtonSettings, DirectionSnapshot } from "./types";

export type ActionKind = "set" | "toggle";

function directionSnapshot(snapshot: AudioSnapshot | undefined, direction: ButtonSettings["direction"]): DirectionSnapshot | undefined {
	return snapshot?.[direction];
}

function resolvePrimaryId(settings: ButtonSettings, snapshot: AudioSnapshot | undefined): string {
	return getVolatileDeviceId(settings.primary, settings.matchStrategy, directionSnapshot(snapshot, settings.direction));
}

function resolveSecondaryId(settings: ButtonSettings, snapshot: AudioSnapshot | undefined): string {
	return getVolatileDeviceId(settings.secondary, settings.matchStrategy, directionSnapshot(snapshot, settings.direction));
}

function defaultIdForRole(dirSnap: DirectionSnapshot | undefined, role: ButtonSettings["role"]): string {
	return (role === "communication" ? dirSnap?.communicationsDeviceId : dirSnap?.defaultDeviceId) ?? "";
}

/**
 * If a configured device is missing its display metadata (e.g. it was only ever saved as a bare ID),
 * backfill it from the live snapshot and persist - ported from FillButtonDeviceInfo/FillAudioDeviceInfo
 * in AudioSwitcherStreamDeckPlugin.cpp. Needed for fuzzy matching, which compares interfaceName/
 * endpointName, not just id.
 */
export async function backfillDeviceInfo(action: KeyAction<ButtonSettings>, settings: ButtonSettings, snapshot: AudioSnapshot | undefined): Promise<void> {
	const dirSnap = directionSnapshot(snapshot, settings.direction);
	if (!dirSnap) return;

	let changed = false;
	for (const key of ["primary", "secondary"] as const) {
		const device = settings[key];
		if (device?.id && !device.displayName) {
			const found = dirSnap.devices[device.id];
			if (found) {
				settings[key] = found;
				changed = true;
			}
		}
	}

	if (changed) {
		await action.setSettings(settings).catch((error) => streamDeck.logger.error("Failed to backfill device info", error));
	}
}

// Last resolved active/primary/secondary IDs per action, so polling (which re-runs updateState every
// tick, unlike the C++ plugin's change-driven callback) doesn't re-flash the alert every few seconds.
const lastResolved = new Map<string, string>();

/** Drops the per-action state kept by {@link updateState}; call when the action disappears. */
export function forgetState(actionId: string): void {
	lastResolved.delete(actionId);
}

/**
 * Mirrors UpdateState() in AudioSwitcherStreamDeckPlugin.cpp. With `fromPoll`, the "neither device is
 * active" alert is only shown when something actually changed since the last update.
 */
export function updateState(
	action: KeyAction<ButtonSettings>,
	kind: ActionKind,
	settings: ButtonSettings,
	snapshot: AudioSnapshot | undefined,
	fromPoll = false
): void {
	const dirSnap = directionSnapshot(snapshot, settings.direction);
	const primaryId = resolvePrimaryId(settings, snapshot);
	const secondaryId = resolveSecondaryId(settings, snapshot);

	let activeDevice: string;
	if (settings.role === "all") {
		activeDevice = dirSnap?.defaultDeviceId ?? "";
		// This looks backwards (falling through to the communications device when the console default
		// already matches primary/secondary) but mirrors UpdateState()'s exact condition verbatim.
		if (!activeDevice || activeDevice === secondaryId || activeDevice === primaryId) {
			activeDevice = dirSnap?.communicationsDeviceId ?? "";
		}
	} else {
		activeDevice = defaultIdForRole(dirSnap, settings.role);
	}

	const resolved = `${activeDevice}|${primaryId}|${secondaryId}`;
	const unchanged = lastResolved.get(action.id) === resolved;
	lastResolved.set(action.id, resolved);

	if (kind === "set") {
		action.setState(activeDevice === primaryId ? 0 : 1).catch((error) => streamDeck.logger.error("Failed to set state", error));
		return;
	}

	if (activeDevice === primaryId) {
		action.setState(0).catch((error) => streamDeck.logger.error("Failed to set state", error));
		return;
	}
	if (activeDevice === secondaryId) {
		action.setState(1).catch((error) => streamDeck.logger.error("Failed to set state", error));
		return;
	}
	if (fromPoll && unchanged) return;
	action.showAlert().catch((error) => streamDeck.logger.error("Failed to show alert", error));
}

/**
 * Handles a key press for either action - ported from the shared tail of KeyUpForAction() in
 * AudioSwitcherStreamDeckPlugin.cpp. `state` is the action's state *before* this press (as reported by
 * Stream Deck) - for Toggle, state 0 means "currently showing primary, so target the secondary device"
 * and vice versa; this looks inverted but matches the original comment/behavior exactly. For Set,
 * always targets the primary (its "secondary" concept doesn't apply).
 */
export async function performKeyPress(action: KeyAction<ButtonSettings>, kind: ActionKind, settings: ButtonSettings, state: number | undefined): Promise<void> {
	const snapshot = audioDeviceService.getSnapshot();
	const dirSnap = directionSnapshot(snapshot, settings.direction);

	const deviceId = state !== 0 || kind === "set" ? resolvePrimaryId(settings, snapshot) : resolveSecondaryId(settings, snapshot);
	if (!deviceId) {
		await action.showAlert().catch(() => undefined);
		return;
	}

	const deviceState = dirSnap?.devices[deviceId]?.state;
	if (deviceState !== "connected") {
		if (kind === "set") await action.setState(1).catch(() => undefined);
		await action.showAlert().catch(() => undefined);
		return;
	}

	if (kind === "set") {
		const alreadySet =
			settings.role === "all"
				? deviceId === (dirSnap?.defaultDeviceId ?? "") && deviceId === (dirSnap?.communicationsDeviceId ?? "")
				: deviceId === defaultIdForRole(dirSnap, settings.role);
		if (alreadySet) {
			if (state !== undefined) await action.setState(state).catch(() => undefined);
			return;
		}
	}

	if (settings.role === "all") {
		await audioDeviceService.setDefaultDevice("default", deviceId);
		await audioDeviceService.setDefaultDevice("communication", deviceId);
		return;
	}
	await audioDeviceService.setDefaultDevice(settings.role, deviceId);
}
