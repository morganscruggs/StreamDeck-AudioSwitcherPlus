/* Copyright (c) 2018-present, Fred Emmott
 *
 * This source code is licensed under the MIT-style license found in the
 * LICENSE file.
 */

#include "ButtonSettings.h"

#include <StreamDeckSDK/ESDLogger.h>

#include "audio_json.h"

#include <regex>
#include <vector>

NLOHMANN_JSON_SERIALIZE_ENUM(
  DeviceMatchStrategy,
  {
    {DeviceMatchStrategy::ID, "ID"},
    {DeviceMatchStrategy::Fuzzy, "Fuzzy"},
  });

void from_json(const nlohmann::json& j, ButtonRole& role) {
  if (j == "communication") {
    role = ButtonRole::COMMUNICATION;
    return;
  }
  if (j == "all") {
    role = ButtonRole::ALL;
    return;
  }
  role = ButtonRole::DEFAULT;
}

void to_json(nlohmann::json& j, const ButtonRole& role) {
  switch (role) {
    case ButtonRole::COMMUNICATION:
      j = "communication";
      return;
    case ButtonRole::ALL:
      j = "all";
      return;
    case ButtonRole::DEFAULT:
    default:
      j = "default";
      return;
  }
}

void from_json(const nlohmann::json& j, ButtonSettings& bs) {
  if (!j.contains("direction")) {
    return;
  }

  bs.direction = j.at("direction");

  if (j.contains("role")) {
    bs.role = j.at("role");
  }

  if (j.contains("primary")) {
    const auto& primary = j.at("primary");
    if (primary.is_string()) {
      bs.primaryDevice.id = primary;
    } else {
      bs.primaryDevice = primary;
    }
  }

  if (j.contains("secondary")) {
    const auto& secondary = j.at("secondary");
    if (secondary.is_string()) {
      bs.secondaryDevice.id = secondary;
    } else {
      bs.secondaryDevice = secondary;
    }
  }

  if (j.contains("matchStrategy")) {
    bs.matchStrategy = j.at("matchStrategy");
  }

  if (j.contains("icon")) {
    bs.icon = j.at("icon");
  }

  if (j.contains("primaryIcon")) {
    bs.primaryIcon = j.at("primaryIcon");
  }

  if (j.contains("secondaryIcon")) {
    bs.secondaryIcon = j.at("secondaryIcon");
  }

  if (j.contains("iconBrightColor")) {
    bs.iconBrightColor = j.at("iconBrightColor");
  }

  if (j.contains("iconDarkColor")) {
    bs.iconDarkColor = j.at("iconDarkColor");
  }

  if (j.contains("primaryIconColor")) {
    bs.primaryIconColor = j.at("primaryIconColor");
  }

  if (j.contains("secondaryIconColor")) {
    bs.secondaryIconColor = j.at("secondaryIconColor");
  }
}

void to_json(nlohmann::json& j, const ButtonSettings& bs) {
  j = {
    {"direction", bs.direction},
    {"role", bs.role},
    {"primary", bs.primaryDevice},
    {"secondary", bs.secondaryDevice},
    {"matchStrategy", bs.matchStrategy},
    {"icon", bs.icon},
    {"primaryIcon", bs.primaryIcon},
    {"secondaryIcon", bs.secondaryIcon},
    {"iconBrightColor", bs.iconBrightColor},
    {"iconDarkColor", bs.iconDarkColor},
    {"primaryIconColor", bs.primaryIconColor},
    {"secondaryIconColor", bs.secondaryIconColor},
  };
}

namespace {

std::string FuzzifyInterface(const std::string& name) {
  // Windows likes to replace "Foo" with "2- Foo", either as the whole interface name or embedded
  // as "Endpoint (2- Foo)" - strip that numeric prefix wherever it appears so renumbered devices
  // still fuzzy-match. Mirrors stripNumberPrefix() in the property inspector's index.html, which
  // already handled both forms, but only for display.
  static const std::regex pattern {"(^|\\()[0-9]+- "};
  return std::regex_replace(name, pattern, "$1", std::regex_constants::format_first_only);
}

std::string GetVolatileID(
  const AudioDeviceInfo& device,
  DeviceMatchStrategy strategy) {
  if (device.id.empty()) {
    return {};
  }

  if (strategy == DeviceMatchStrategy::ID) {
    return device.id;
  }

  if (GetAudioDeviceState(device.id) == AudioDeviceState::CONNECTED) {
    return device.id;
  }

  const auto fuzzyInterface = FuzzifyInterface(device.interfaceName);
  ESDDebug("Looking for a fuzzy match: {} -> {}", device.interfaceName, fuzzyInterface);

  std::vector<std::string> connectedOnSameInterface;
  for (const auto& [otherID, other] : GetAudioDeviceList(device.direction)) {
    if (other.state != AudioDeviceState::CONNECTED) {
      continue;
    }
    const auto otherFuzzyInterface = FuzzifyInterface(other.interfaceName);
    ESDDebug("Trying {} -> {}", other.interfaceName, otherFuzzyInterface);
    if (fuzzyInterface != otherFuzzyInterface) {
      continue;
    }
    if (device.endpointName == other.endpointName) {
      ESDDebug(
        "Fuzzy device match for {}/{}",
        device.interfaceName,
        device.endpointName);
      return otherID;
    }
    connectedOnSameInterface.push_back(otherID);
  }
  // A renumbered endpoint comes back with its factory name, so a user-renamed endpoint would never
  // match again - if exactly one connected device shares the interface, that's the one. Mirrors
  // getVolatileDeviceId() in the Node plugin's device-match.ts.
  if (connectedOnSameInterface.size() == 1) {
    ESDDebug(
      "Fuzzy interface-only match for {}/{}",
      device.interfaceName,
      device.endpointName);
    return connectedOnSameInterface.front();
  }
  ESDDebug(
    "Failed fuzzy match for {}/{}", device.interfaceName, device.endpointName);
  return device.id;
}
}// namespace

std::string ButtonSettings::VolatilePrimaryID() const {
  return GetVolatileID(primaryDevice, matchStrategy);
}

std::string ButtonSettings::VolatileSecondaryID() const {
  return GetVolatileID(secondaryDevice, matchStrategy);
}
