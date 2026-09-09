import type { AudioDeviceInfo, DeviceMatchStrategy, DirectionSnapshot } from "./types";

/**
 * Windows likes to replace "Foo" with "2- Foo", either as the whole interface name or embedded as
 * "Endpoint (2- Foo)" - strips that numeric prefix (wherever it appears) so renumbered devices
 * still fuzzy-match. Mirrors stripNumberPrefix() in the property inspector's index.html (which
 * handles both forms for display) and ButtonSettings.cpp's FuzzifyInterface().
 */
function fuzzifyInterface(name: string): string {
	return name.replace(/(^|\()[0-9]+- /, "$1");
}

/**
 * Resolves a configured device reference to whichever device ID should actually be used right now -
 * ported from ButtonSettings.cpp's GetVolatileID(). With "ID" matching this is just the stored ID.
 * With "Fuzzy" matching, if the stored ID is no longer connected, this looks for a currently-connected
 * device with the same (number-prefix-stripped) interface name and endpoint name, so a device that got
 * renumbered (Windows swapping "Foo" for "2- Foo") is still recognized as the same physical device.
 * If no endpoint name matches but exactly one connected device shares the interface name, that one is
 * used: a renumbered endpoint comes back with its factory name, so a user-renamed endpoint would
 * otherwise never match again.
 */
export function getVolatileDeviceId(
	device: AudioDeviceInfo | undefined,
	strategy: DeviceMatchStrategy,
	snapshot: DirectionSnapshot | undefined
): string {
	if (!device || !device.id) return "";

	if (strategy === "ID") return device.id;

	const currentState = snapshot?.devices[device.id]?.state;
	if (currentState === "connected") return device.id;

	if (!snapshot) return device.id;

	const fuzzyInterface = fuzzifyInterface(device.interfaceName);
	const connectedOnSameInterface = Object.values(snapshot.devices).filter(
		(other) => other.state === "connected" && fuzzifyInterface(other.interfaceName) === fuzzyInterface
	);
	const sameEndpoint = connectedOnSameInterface.find((other) => other.endpointName === device.endpointName);
	if (sameEndpoint) return sameEndpoint.id;
	if (connectedOnSameInterface.length === 1) return connectedOnSameInterface[0].id;

	return device.id;
}
