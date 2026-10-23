{
  "Actions": [
    {
      "States": [
        {
          "Image": "AudioDevicesIcons/headphones"
        },
        {
          "Image": "AudioDevicesIcons/speaker"
        }
      ],
      "SupportedInMultiActions": false,
      "Icon": "AudioDevicesIcons/headphones",
      "Name": "Toggle Audio Device",
      "Tooltip": "Switch between two audio devices.",
      "UUID": "com.morganscruggs.audioswitcherplus.toggle"
    },
    {
      "SupportedInMultiActions": true,
      "Icon": "AudioDevicesIcons/headphones",
      "Name": "Set Audio Device",
      "Tooltip": "Set a specific audio device",
      "UUID": "com.morganscruggs.audioswitcherplus.set",
      "States": [
        {
          "Image": "AudioDevicesIcons/headphones"
        },
        {
          "Image": "AudioDevicesIcons/headphones"
        }
      ]
    }
  ],
  "Author": "Morgan Scruggs",
  "CodePath": "sdaudioswitchplus.exe",
  "Description": "Toggle or set the active audio devices (native exe build). Fork of Fred Emmott's Audio Switcher (github.com/fredemmott).",
  "Name": "Audio Switcher Plus (exe)",
  "PropertyInspectorPath": "propertyinspector/index.html",
  "Icon": "AudioDevicesIcons/headphones",
  "Category": "Audio Switcher Plus (exe)",
  "CategoryIcon": "AudioDevicesIcons/speaker",
  "Version": "${CMAKE_PROJECT_VERSION}",
  "OS": [
    {
      "Platform": "windows",
      "MinimumVersion": "10"
    }
  ],
  "SDKVersion": 2,
  "Software": {
    "MinimumVersion": "6.4"
  },
  "UUID": "com.morganscruggs.audioswitcherplus"
}
