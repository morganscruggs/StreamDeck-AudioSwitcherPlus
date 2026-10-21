include(FetchContent)

FetchContent_Declare(
  AudioDeviceLib
  GIT_REPOSITORY https://github.com/fredemmott/AudioDeviceLib
  GIT_TAG 8cef359dd7920659a24aa1aabf9539fe2dffb01b
  DOWNLOAD_EXTRACT_TIMESTAMP ON
  # Keeps its targets out of the default build and its own install() rules (library, headers, demos)
  # out of this plugin's install.
  EXCLUDE_FROM_ALL
)

FetchContent_MakeAvailable(AudioDeviceLib)
