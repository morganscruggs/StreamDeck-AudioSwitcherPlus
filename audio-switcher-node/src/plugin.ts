import streamDeck from "@elgato/streamdeck";

import { SetDeviceAction } from "./actions/set-device";
import { ToggleDeviceAction } from "./actions/toggle-device";

streamDeck.actions.registerAction(new SetDeviceAction());
streamDeck.actions.registerAction(new ToggleDeviceAction());

streamDeck.connect();
