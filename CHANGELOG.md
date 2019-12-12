# Change Log

All notable changes to the "clairvoyant" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## 5.2.0 - 2019-??-??

### Added

- Added `hits:i/n` to the token move menu.

### Changed

- `clairvoyant.textEditorRevealType` setting's default: `InCenterIfOutsideViewport` -> `InCenter`

### Fixed

- Fixed an wrong default value where `clairvoyant.excludeExtentions` setting.

## 5.1.0 - 2019-12-06

### Added

- `clairvoyant.sightDocument` command.
- `clairvoyant.sightToken` command.
- Added support for text editor context menu.
- Added support for editor title menu.

### Changed

- When commands cannot be used, it are not displayed on the command palette.

## 5.0.1 - 2019-12-05

### Added

- Described new commands in README.

### Fixed

- Fixed an issue where `clairvoyant.toggleHighlight` command was not accessible from Command Palette.

## 5.0.0 - 2019-12-04

### Added

- `clairvoyant.nextToken` command.
- `clairvoyant.previousToken` command.
- `clairvoyant.toggleHighlight` command.
- `Current files` and new commands in `clairvoyant.sight` menu.

### Changed

- When Japanese menu, add English for selectivity.

## 4.4.0 - 2019-12-03

### Added

- Highlight tokens

## 4.3.0 - 2019-11-29

### Added

- `clairvoyant.enablePreviewIntercept` setting.
- `clairvoyant.gotoHistoryMode` setting.

## 4.2.0 - 2019-11-28

### Added

- Separated `Go to` history by viewColumn.

## 4.1.0 - 2019-11-28

### Added

- When Click a text editor displaying a preview, it is confirmed.

## 4.0.1 - 2019-11-28

### Fixed

- Fixed an issue where the menu cache may not be cleared.

## 4.0.0 - 2019-11-27

### Added

- `clairvoyant.parserRegExp` setting.

### Changed

- Added support for kebab-cases.

## 3.1.0 - 2019-11-27

### Added

- Enhanced log output.
- `clairvoyant.outputChannelVolume` setting.

## 3.0.1 - 2019-11-26

### Fixed

- Fixed an issue that the cursor position may not be restored correctly.

## 3.0.0 - 2019-11-25

### Added

- Goto menu jump destination preview with text editor.

### Removed

- `clairvoyant.goWithReopenMenu` setting.
- Re-open menu when go type menu is selected.

## 2.0.1 - 2019-11-25

### Added

- The scope of the menu cache has been expanded.

### Fixed

- Fixed an issue where the description of `clairvoyant.goWithReopenMenu` was not displayed correctly.

## 2.0.0 - 2019-11-25

### Added

- added sight menu cache for performance.
- `clairvoyant.goWithReopenMenu` setting.

### Changed

- Modified Japanese message considering selectivity.
- Re-open menu when go type menu is selected.

## 1.1.0 - 2019-11-23

### Added

- show the destination file in the go type menu.
- `clairvoyant.targetProtocols` setting.
- added "back to the previous menu" menu item.

### Changed

- Modified Japanese message considering selectivity.
- Modified message: "scan" -> "scan directory"

### Fixed

- Fixed an issue that automatic scan does not run when reloading.

## 1.0.1 - 2019-11-22

### Added

- auto detach document when close untitled document and rename document.

## 1.0.0 - 2019-11-20

### Added

- 🎊 Initial release of Clairvoyant. 🎉

## [Unreleased]

## 0.0.0 - 2019-11-04

### Added

- Start this project.
