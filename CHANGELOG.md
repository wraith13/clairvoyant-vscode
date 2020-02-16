# Change Log

All notable changes to the "clairvoyant" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## 7.4.0 - 2020-02-16

### Fixed

- Fixed an issue where previews could show the wrong viewcolumn or break the selection.

## 7.3.0 - 2020-02-07

### Added

- `clairvoyant.enableMenuCache` setting.
- Enhanced log output.

## 7.2.1 - 2020-01-14

### Fixed

- Fixed an issue where wrong description of `Highlighted tokens` at `Clairvoyant: Sight Document ...`.

## 7.2.0 - 2020-01-13

### Added

- Described recommended settings in README.

### Changed

- `Highlighted tokens` at `Clairvoyant: Sight Document ...` is limited to those included in target document.

### Fixed

- Worked around an issue that preview in wrong ViewColumn. ( This is an experimental measure because the steps to reproduce the problem are not known. )

## 7.1.0 - 2020-01-05

### Added

- `clairvoyant.firstToken` command.

### Changed

- Changed to display a message when a token operation is performed while the token is not pointed.

### Fixed

- Fixed an issue where the regular go to file menu was sometimes displayed twice.

## 7.0.0 - 2020-01-03

### Added

- Added problems menu item to sight menu.
- Added summary as detail to problems menu.
- `clairvoyant.developFileListOnSightRootMenu` setting.

### Changed

- Changed the menu tree structure( check `clairvoyant.developFileListOnSightRootMenu` setting ).

### Fixed

- Fixed an issue where the menu cache may not be cleared.
- Fixed an issue that could be pasted in the wrong location.

### Removed

- Removed unnecessary `Go to this file` menu item.

## 6.2.0 - 2019-12-25

### Added

- Added regular `Go To File...` menu item to sight menu.
- Added `Go to this file...` menu item to file menu.

### Fixed

- Fixed an issue where an error occurred when a menu was displayed without opening a text editor.

### Changed

- Fixed so that the destination file by `Lunatic Go To File ...` does not remain in preview.

## 6.1.1 - 2019-12-24

### Fixed

- Fixed an issue that exiting the menu with the ESC key would result in a preview interrupt.

## 6.1.0 - 2019-12-23

### Added

- Added preview support for more menu items.

## 6.0.0 - 2019-12-19

### Added

- Added support for go to changes.
- Added support for go to problems.

### Fixed

- Fixed an issue where menus could remain cached.

### Changed

- Changed the menu tree structure( Display token list and file list at the same time ).

## 5.3.0 - 2019-12-14

### Added

- Added `workbench.action.quickOpen` to the `clairvoyant.lunaticGoToFile` menu.

### Fixed

- Fixed an wrong description that `Clairvoyant: Go To File With Preiview`. ( The correct command name is `Clairvoyant: Lunatic Go To File...`. )

## 5.2.0 - 2019-12-13

### Added

- Added `hits:i/n` to the token move menu.
- Lunatic preview.
- `clairvoyant.lunaticGoToFile` command.
- `clairvoyant.enableLunaticPreview` setting.

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
