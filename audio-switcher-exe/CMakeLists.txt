# 3.28 for FetchContent_Declare(EXCLUDE_FROM_ALL); policies up to 3.31 (the CMake bundled with Visual
# Studio 2022) use their new behavior.
cmake_minimum_required(VERSION 3.28...3.31)

# The fetched dependencies declare older minimum versions of their own, so this policy (newer than
# those) would otherwise be unset for them and warn on every configure. NEW: files extracted from their
# vendored downloads get the extraction time as their timestamp.
set(CMAKE_POLICY_DEFAULT_CMP0135 NEW)

set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

# The plugin version lives once in shared/VERSION, which the Node plugin's build also reads; the build
# number is appended as the fourth component.
set(PLUGIN_VERSION_FILE "${CMAKE_CURRENT_SOURCE_DIR}/../shared/VERSION")
file(STRINGS "${PLUGIN_VERSION_FILE}" PLUGIN_VERSION LIMIT_COUNT 1)
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${PLUGIN_VERSION_FILE}")

if(DEFINED ENV{GITHUB_RUN_NUMBER})
  set(DEFAULT_VERSION_BUILD $ENV{GITHUB_RUN_NUMBER})
else()
  set(DEFAULT_VERSION_BUILD 0)
endif()

set(VERSION_BUILD "${DEFAULT_VERSION_BUILD}" CACHE STRING "patch component of version number")

project(
  com.morganscruggs.audioswitcherplus.sdPlugin
  LANGUAGES CXX
  VERSION ${PLUGIN_VERSION}.${VERSION_BUILD}
)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED true)
set(CMAKE_CXX_EXTENSIONS false)

if(WIN32)
  add_compile_definitions(
    "UNICODE=1"
    "_UNICODE=1"
    "WIN32_LEAN_AND_MEAN=1"
    "WINVER=0xa00" # Windows 10
    "_WIN32_WINNT=0xa00"
  )
endif()

if(MSVC)
  add_compile_options(
    "/diagnostics:caret" # more detailed error messages
    "/EHsc" # standard-compliant exception handling
    "/Zc:__cplusplus" # standard-compliant __cplusplus macro
    "/await:strict" # standard--compliant coroutines
  )

  # Statically link the MSVC runtime
  set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

  # ... but dynamically link the UCRT - the ABI-stable part
  add_link_options(
    "/DEFAULTLIB:ucrt$<$<CONFIG:Debug>:d>.lib"
    "/NODEFAULTLIB:libucrt$<$<CONFIG:Debug>:d>.lib"
  )
endif()

include("AudioDeviceLib.cmake")
include("StreamDeckSDK.cmake")
include("sign_target.cmake")

set_default_install_dir_to_repo_root()

add_subdirectory(Sources)
add_subdirectory(sdPlugin)

install(FILES ../LICENSE DESTINATION ${CMAKE_INSTALL_PREFIX})

# Must be last - it copies whatever CMAKE_INSTALL_PREFIX ends up containing, so every other install()
# rule above needs to have already run.
sync_install_to_streamdeck_plugin_dir()
