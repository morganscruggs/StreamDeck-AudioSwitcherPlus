import streamDeck, {
	action,
	DidReceiveSettingsEvent,
	KeyUpEvent,
	SendToPluginEvent,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent
} from "@elgato/streamdeck";
import { applyIcons } from "../apply-icon";
import { audioDeviceService } from "../audio-device-service";
import { handlePropertyInspectorMessage } from "../pi-bridge";
import { backfillDeviceInfo, forgetState, performKeyPress, updateState } from "../state-sync";
import type { ButtonSettings } from "../types";

/**
 * Sets one specific audio device as the active default (and/or communications) device - ported from
 * the "com.morganscruggs.audioswitcherplus.set" action in AudioSwitcherStreamDeckPlugin.cpp.
 */
@action({ UUID: "com.morgan-scruggs.audioswitcherplus-node.set" })
export class SetDeviceAction extends SingletonAction<ButtonSettings> {
	private unsubscribe = new Map<string, () => void>();
	// Latest settings per visible action - the poll listener reads from here so it picks up changes made
	// in the property inspector, rather than the settings captured when the action first appeared.
	private settings = new Map<string, ButtonSettings>();

	override async onWillAppear(ev: WillAppearEvent<ButtonSettings>): Promise<void> {
		if (!ev.action.isKey()) return;
		const action = ev.action;
		const settings = ev.payload.settings;
		this.settings.set(action.id, settings);

		audioDeviceService.acquire();
		this.unsubscribe.set(
			action.id,
			audioDeviceService.subscribe((snapshot) => updateState(action, "set", this.settings.get(action.id) ?? settings, snapshot, true))
		);

		applyIcons(action, "set", settings);
		updateState(action, "set", settings, audioDeviceService.getSnapshot());
		await backfillDeviceInfo(action, settings, audioDeviceService.getSnapshot());
	}

	override onWillDisappear(ev: WillDisappearEvent<ButtonSettings>): void {
		const unsubscribe = this.unsubscribe.get(ev.action.id);
		if (!unsubscribe) return;
		unsubscribe();
		audioDeviceService.release();
		this.unsubscribe.delete(ev.action.id);
		this.settings.delete(ev.action.id);
		forgetState(ev.action.id);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<ButtonSettings>): void {
		if (!ev.action.isKey()) return;
		this.settings.set(ev.action.id, ev.payload.settings);
		applyIcons(ev.action, "set", ev.payload.settings);
		updateState(ev.action, "set", ev.payload.settings, audioDeviceService.getSnapshot());
	}

	override async onKeyUp(ev: KeyUpEvent<ButtonSettings>): Promise<void> {
		await performKeyPress(ev.action, "set", ev.payload.settings, ev.payload.state);
	}

	override async onSendToPlugin(ev: SendToPluginEvent<any, ButtonSettings>): Promise<void> {
		const payload = ev.payload as { event?: string } | undefined;
		await handlePropertyInspectorMessage(payload?.event).catch((error) => streamDeck.logger.error("Failed to handle PI message", error));
	}
}
