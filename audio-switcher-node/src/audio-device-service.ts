import streamDeck from "@elgato/streamdeck";
import { AudioBridge } from "./audio-device-bridge";
import type { AudioDeviceRole, AudioSnapshot } from "./types";

/**
 * Refreshes are driven by Windows' own device-change notifications, relayed by the bridge process, so
 * the poll is only a safety net (e.g. for device renames, which aren't relayed). If notifications
 * couldn't be registered, it polls as often as the old per-poll-process design did.
 */
const SAFETY_POLL_MS = 30000;
const FALLBACK_POLL_MS = 5000;
// Windows raises a burst of notifications for a single change (one per role, per device), so coalesce.
const CHANGE_DEBOUNCE_MS = 150;
// Switching pages or profiles briefly takes every button off screen, so don't stop the bridge process
// the moment none are visible.
const IDLE_SHUTDOWN_MS = 60000;

type Listener = (snapshot: AudioSnapshot) => void;

/** One shared bridge process and snapshot for every visible button, rather than one per button. */
class AudioDeviceService {
	private readonly bridge = new AudioBridge({
		onChanged: () => this.scheduleRefresh(),
		onReady: (notifications) => {
			if (!notifications) {
				streamDeck.logger.warn(`Audio device notifications unavailable - polling every ${FALLBACK_POLL_MS / 1000}s instead`);
			}
		},
		onLog: (message) => streamDeck.logger.warn(message)
	});
	private snapshot: AudioSnapshot | undefined;
	private visibleCount = 0;
	private pollTimer: ReturnType<typeof setTimeout> | undefined;
	private debounceTimer: ReturnType<typeof setTimeout> | undefined;
	private idleTimer: ReturnType<typeof setTimeout> | undefined;
	private listeners = new Set<Listener>();
	private refreshInFlight: Promise<AudioSnapshot> | undefined;
	private refreshAgain = false;

	getSnapshot(): AudioSnapshot | undefined {
		return this.snapshot;
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Call when a button becomes visible; pairs with {@link release}. Starts updates on the 0->1 edge. */
	acquire(): void {
		this.visibleCount++;
		if (this.visibleCount !== 1) return;

		clearTimeout(this.idleTimer);
		this.idleTimer = undefined;
		this.refresh()
			.catch((error) => streamDeck.logger.error("Initial audio device refresh failed", error))
			.finally(() => this.schedulePoll());
	}

	/** Call when a button stops being visible; pairs with {@link acquire}. Winds down on the 1->0 edge. */
	release(): void {
		this.visibleCount = Math.max(0, this.visibleCount - 1);
		if (this.visibleCount !== 0) return;

		clearTimeout(this.pollTimer);
		this.pollTimer = undefined;
		clearTimeout(this.idleTimer);
		this.idleTimer = setTimeout(() => {
			this.idleTimer = undefined;
			this.bridge.stop();
		}, IDLE_SHUTDOWN_MS);
	}

	/**
	 * Fetches a fresh snapshot and hands it to every listener. Concurrent calls share the one in flight,
	 * but since that may have read the state from before whatever prompted this call, one more refresh
	 * follows it.
	 */
	async refresh(): Promise<AudioSnapshot> {
		if (this.refreshInFlight) {
			this.refreshAgain = true;
			return this.refreshInFlight;
		}

		this.refreshInFlight = (async () => {
			const next = await this.bridge.getSnapshot();
			this.snapshot = next;
			for (const listener of this.listeners) listener(next);
			return next;
		})();

		try {
			return await this.refreshInFlight;
		} finally {
			this.refreshInFlight = undefined;
			if (this.refreshAgain) {
				this.refreshAgain = false;
				this.refresh().catch((error) => streamDeck.logger.error("Follow-up audio device refresh failed", error));
			}
		}
	}

	/**
	 * Sets the default device for each role, then refreshes once so buttons reflect it right away. Refreshing
	 * only after the last role means no button sees a half-switched snapshot (e.g. the new default device but
	 * the old communications one), which would flip "All" buttons back and forth mid-switch.
	 */
	async setDefaultDevice(roles: AudioDeviceRole[], deviceId: string): Promise<boolean> {
		let ok = true;
		for (const role of roles) ok = (await this.bridge.setDefaultDevice(role, deviceId)) && ok;
		// A refresh already in flight may have read the state from before the switch, so wait it out and
		// read again rather than sharing its result.
		while (this.refreshInFlight) await this.refreshInFlight.catch(() => undefined);
		await this.refresh().catch((error) => streamDeck.logger.error("Post-set audio device refresh failed", error));
		return ok;
	}

	private scheduleRefresh(): void {
		clearTimeout(this.debounceTimer);
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = undefined;
			this.refresh().catch((error) => streamDeck.logger.error("Audio device refresh after a change failed", error));
		}, CHANGE_DEBOUNCE_MS);
	}

	private schedulePoll(): void {
		clearTimeout(this.pollTimer);
		if (this.visibleCount === 0) return;

		// Unknown means the bridge process isn't running (it died, or failed to start) - the next poll
		// restarts it, so don't wait the full safety interval for that.
		const interval = this.bridge.notificationsActive === true ? SAFETY_POLL_MS : FALLBACK_POLL_MS;
		this.pollTimer = setTimeout(() => {
			this.refresh()
				.catch((error) => streamDeck.logger.error("Audio device poll failed", error))
				.finally(() => this.schedulePoll());
		}, interval);
	}
}

export const audioDeviceService = new AudioDeviceService();
