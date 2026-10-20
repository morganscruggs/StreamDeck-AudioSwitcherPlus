configure_file(
  manifest.json.cmake
  manifest.json
  NEWLINE_STYLE UNIX
)
file(GLOB STATIC_FILES *.png)
install(
  FILES
  ${STATIC_FILES}
  ${CMAKE_CURRENT_BINARY_DIR}/manifest.json
  .sdignore
  DESTINATION
  ${CMAKE_INSTALL_PREFIX}
)
# Shared with the Node plugin, whose build copies the same folders in.
install(
  DIRECTORY
  ../../shared/propertyinspector
  ../../shared/AudioDevicesIcons
  DESTINATION
  ${CMAKE_INSTALL_PREFIX}
)
