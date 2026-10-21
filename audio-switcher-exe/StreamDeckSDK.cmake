include(FetchContent)

FetchContent_Declare(
  StreamDeckSDK
  GIT_REPOSITORY https://github.com/fredemmott/StreamDeck-CPPSDK
  GIT_TAG 2652cbddee10bea56f19484ddd074c26e9f179de
  DOWNLOAD_EXTRACT_TIMESTAMP ON
  # Keeps its targets out of the default build and its own install() rules out of this plugin's
  # install - notably its example plugin's, which would install a manifest.json over this one's.
  EXCLUDE_FROM_ALL
)

FetchContent_MakeAvailable(StreamDeckSDK)

string(
  REPLACE
  "\\"
  "/"
  STREAMDECK_PLUGIN_DIR
  "$ENV{appdata}/Elgato/StreamDeck/Plugins"
)

set(
  STREAMDECK_PLUGIN_DIR
  ${STREAMDECK_PLUGIN_DIR}
  CACHE PATH "Path to this system's streamdeck plugin directory"
)

option(
  SYNC_TO_STREAMDECK
  "Mirror the installed plugin into STREAMDECK_PLUGIN_DIR (turn off for CI/packaging builds)"
  ON
)

# Installs into the repo's top-level directory (alongside audio-switcher-exe/, audio-switcher-node/,
# shared/) rather than Stream Deck's own Plugins folder - mirrors where the Node project's build output
# lands relative to the repo. Pair with sync_install_to_streamdeck_plugin_dir() to still have Stream
# Deck pick up the build automatically, the same way the Node project's rollup config does.
function(set_default_install_dir_to_repo_root)
  if(CMAKE_INSTALL_PREFIX_INITIALIZED_TO_DEFAULT)
    set(
      CMAKE_INSTALL_PREFIX
      "${CMAKE_SOURCE_DIR}/../${CMAKE_PROJECT_NAME}"
      CACHE PATH "See cmake documentation"
      FORCE
    )
  endif()
endfunction()

# Registers a final install step that mirrors CMAKE_INSTALL_PREFIX's assembled plugin folder into
# Stream Deck's real Plugins directory. Must be called after every other install() rule in the project
# (install() rules run in declaration order), so Stream Deck always sees a complete, consistent copy.
# Skipped when SYNC_TO_STREAMDECK is off, or when Stream Deck isn't installed (no Plugins folder) -
# matching the Node project's rollup config.
function(sync_install_to_streamdeck_plugin_dir)
  if(NOT SYNC_TO_STREAMDECK)
    return()
  endif()
  install(CODE "
    if(EXISTS \"${STREAMDECK_PLUGIN_DIR}\")
      file(REMOVE_RECURSE \"${STREAMDECK_PLUGIN_DIR}/${CMAKE_PROJECT_NAME}\")
      file(COPY \"${CMAKE_INSTALL_PREFIX}/\" DESTINATION \"${STREAMDECK_PLUGIN_DIR}/${CMAKE_PROJECT_NAME}\")
      message(STATUS \"Synced plugin to ${STREAMDECK_PLUGIN_DIR}/${CMAKE_PROJECT_NAME}\")
    else()
      message(STATUS \"Stream Deck Plugins folder not found - skipping sync\")
    endif()
  ")
endfunction()
