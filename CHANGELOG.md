# Changelog

All notable changes to Yoda will be documented in this file.

This project resets to **0.1.0** with the rebrand from `emdash` to `yoda`. Older
release history (`v0.4.x`, `v1.1.x`) belongs to the upstream `emdash` codebase
and is preserved in git tags only.

## 0.1.1 — 2026-05-11

### Fixed

- Make Apple/Azure code signing and R2 upload conditional in
  `release-prod.yml` so the workflow can produce unsigned artifacts when
  optional secrets are absent. Adds GitHub Release upload as a fallback
  artifact destination.
- Switch macOS signing secrets to the `APPLE_CERTIFICATE` /
  `APPLE_CERTIFICATE_PASSWORD` / `APPLE_PASSWORD` naming used elsewhere
  in the lovstudio org.
- `notarize-mac.ts` now accepts either an App Store Connect API key
  (`APPLE_API_KEY*`) or an Apple ID + app-specific password
  (`APPLE_ID` + `APPLE_PASSWORD` + `APPLE_TEAM_ID`).
- `electron-builder.config.ts` reads `YODA_DISABLE_WIN_SIGNING` and
  `YODA_DISABLE_MAC_SIGNING` to opt out of code signing per-build.

## 0.1.0 — 2026-05-11

First release under the `yoda` name. This version represents a full rebrand and
incorporates a number of UX and infrastructure changes on top of the upstream
fork.

### Added

- Rename `emdash` → `yoda` across the app, packaging, sign-in flow, and
  branding assets.
- Sign-in via Lovstudio device flow.
- i18n: bootstrap `i18next` + `react-i18next` with English and Simplified
  Chinese locales; translate the settings, onboarding, MCP, and skills views;
  add a Language card to settings.
- Pinyin-aware task slug generation via `pinyin-pro`.
- New home view with project + agent selectors and quick actions.
- Sidebar restructure (project items, task items, project menu).
- Richer task context menu and a new "Manage run scripts" modal.
- Refreshed task titlebar and unified main tab bar.

### Changed

- Centralize task name slug logic in `src/shared/task-name.ts` (shared between
  main and renderer).
- Drop the renderer-only `utils/taskNames` helper.

### Removed

- Unused `comments-popover` and `context-bar` components from the
  conversations panel.
