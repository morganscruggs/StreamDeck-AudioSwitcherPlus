import assert from "node:assert/strict";
import { test } from "node:test";
import { getVolatileDeviceId } from "../src/device-match.ts";
import type { AudioDeviceInfo, DirectionSnapshot } from "../src/types.ts";

function device(id: string, interfaceName: string, endpointName: string, state: AudioDeviceInfo["state"]): AudioDeviceInfo {
	return { id, interfaceName, endpointName, displayName: `${endpointName} (${interfaceName})`, direction: "output", state };
}

function snapshot(...devices: AudioDeviceInfo[]): DirectionSnapshot {
	return { devices: Object.fromEntries(devices.map((entry) => [entry.id, entry])), defaultDeviceId: "", communicationsDeviceId: "" };
}

const renamedDac = device("old", "2- SMSL USB DAC", "EDIFIER S1000MK2", "device_not_present");

test("ID strategy returns the stored id untouched", () => {
	assert.equal(getVolatileDeviceId(renamedDac, "ID", snapshot(device("new", "5- SMSL USB DAC", "Alto-falantes", "connected"))), "old");
});

test("fuzzy prefers the connected device with the same endpoint name", () => {
	const snap = snapshot(
		device("mg900", "AMD High Definition Audio Device", "1 - MG900", "connected"),
		device("digital", "AMD High Definition Audio Device", "Saída Digital", "connected")
	);
	const stored = device("old-digital", "2- AMD High Definition Audio Device", "Saída Digital", "device_not_present");
	assert.equal(getVolatileDeviceId(stored, "Fuzzy", snap), "digital");
});

test("fuzzy falls back to the only connected device on the same interface when the endpoint was renamed", () => {
	const snap = snapshot(
		device("new", "5- SMSL USB DAC", "Alto-falantes", "connected"),
		device("headset", "CORSAIR HS80 RGB Wireless Gaming Headset", "Corsair HS80", "connected")
	);
	assert.equal(getVolatileDeviceId(renamedDac, "Fuzzy", snap), "new");
});

test("fuzzy keeps the stored id when several connected devices share the interface and none match the endpoint", () => {
	const snap = snapshot(
		device("mg900", "AMD High Definition Audio Device", "1 - MG900", "connected"),
		device("digital", "AMD High Definition Audio Device", "Saída Digital", "connected")
	);
	const stored = device("old-arzopa", "AMD High Definition Audio Device", "3 - ARZOPA", "device_not_present");
	assert.equal(getVolatileDeviceId(stored, "Fuzzy", snap), "old-arzopa");
});
