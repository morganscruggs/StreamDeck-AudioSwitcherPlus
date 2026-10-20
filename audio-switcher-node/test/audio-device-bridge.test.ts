import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { AudioBridge } from "../src/audio-device-bridge.ts";

// These talk to the real PowerShell bridge (read-only, apart from a deliberately invalid device ID), so
// they only run on Windows - CI's Linux runner skips them.
const skip = process.platform !== "win32" && "the audio bridge is Windows-only";

const bridge = new AudioBridge();
after(() => bridge.stop());

test("snapshot returns both directions' devices and defaults", { skip }, async () => {
	const snapshot = await bridge.getSnapshot();
	for (const direction of ["output", "input"] as const) {
		assert.equal(typeof snapshot[direction].devices, "object");
		assert.equal(typeof snapshot[direction].defaultDeviceId, "string");
		assert.equal(typeof snapshot[direction].communicationsDeviceId, "string");
		for (const device of Object.values(snapshot[direction].devices)) {
			assert.equal(device.direction, direction);
		}
	}
});

test("change notifications are registered", { skip }, async () => {
	await bridge.getSnapshot();
	assert.equal(bridge.notificationsActive, true);
});

test("a device ID is only ever data, never evaluated as PowerShell", { skip }, async () => {
	const marker = path.join(os.tmpdir(), `audio-bridge-injection-${process.pid}`);
	fs.rmSync(marker, { force: true });
	for (const deviceId of [
		`$(New-Item -ItemType File -Path '${marker}')`,
		`"; New-Item -ItemType File -Path '${marker}'; "`,
		`'; New-Item -ItemType File -Path '${marker}'; '`
	]) {
		assert.equal(await bridge.setDefaultDevice("default", deviceId), false);
	}
	assert.equal(fs.existsSync(marker), false);
});

test("the process restarts on the next request after stopping", { skip }, async () => {
	bridge.stop();
	const snapshot = await bridge.getSnapshot();
	assert.equal(typeof snapshot.output.devices, "object");
});
