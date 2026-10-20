//==============================================================================
/**
@file       AudioSwitcherStreamDeckPlugin.h

@copyright  (c) 2018, Corsair Memory, Inc.
@copyright  (c) 2018-present, Fred Emmott.
@copyright  (c) 2026-present, Morgan Scruggs.
      This source code is licensed under the MIT-style license found in the
LICENSE file.

      Forked from Fred Emmott's original Audio Switcher plugin:
      https://github.com/fredemmott/StreamDeck-AudioOutputSwitcher

**/
//==============================================================================

#pragma once

#include <AudioDevices/AudioDevices.h>
#include <StreamDeckSDK/ESDBasePlugin.h>

#include <map>
#include <mutex>

#include "ButtonSettings.h"

using json = nlohmann::json;
using namespace FredEmmott::Audio;

class AudioSwitcherStreamDeckPlugin : public ESDBasePlugin {
 public:
  AudioSwitcherStreamDeckPlugin();
  virtual ~AudioSwitcherStreamDeckPlugin();

  void KeyUpForAction(
    const std::string& inAction,
    const std::string& inContext,
    const json& inPayload,
    const std::string& inDeviceID) override;

  void WillAppearForAction(
    const std::string& inAction,
    const std::string& inContext,
    const json& inPayload,
    const std::string& inDeviceID) override;
  void WillDisappearForAction(
    const std::string& inAction,
    const std::string& inContext,
    const json& inPayload,
    const std::string& inDeviceID) override;

  void SendToPlugin(
    const std::string& inAction,
    const std::string& inContext,
    const json& inPayload,
    const std::string& inDeviceID) override;

  void DeviceDidConnect(const std::string& inDeviceID, const json& inDeviceInfo)
    override;
  void DeviceDidDisconnect(const std::string& inDeviceID) override;

  void DidReceiveGlobalSettings(const json& inPayload) override;
  void DidReceiveSettings(
    const std::string& inAction,
    const std::string& inContext,
    const json& inPayload,
    const std::string& inDeviceID) override;

 private:
  struct Button {
    std::string action;
    std::string context;
    ButtonSettings settings;
    // The settings exactly as Stream Deck sent them - ButtonSettings only models the keys the plugin
    // itself uses, so writing it back alone would drop property-inspector-only keys
    // (hideUnavailable, primaryLabel, ...).
    json rawSettings;
  };

  // Recursive since OnDefaultDeviceChanged/WillAppearForAction call UpdateState while holding it.
  std::recursive_mutex mButtonsMutex;
  std::map<std::string, Button> mButtons;
  DefaultChangeCallbackHandle mCallbackHandle;
  // Cached once at startup - StreamDeckSDK's GetPluginDirectoryPath() only
  // returns a valid path on its first call.
  std::string mIconsDirectory;

  void OnDefaultDeviceChanged(
    AudioDeviceDirection direction,
    AudioDeviceRole role,
    const std::string& activeAudioDeviceID);
  void UpdateState(const std::string& context, const std::string& device = "");
  void FillButtonDeviceInfo(const std::string& context);
  void ApplyIcon(const std::string& context);
};
