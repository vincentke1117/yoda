# Feature delivery spine

## Goal

Make a Feature the durable unit that connects a product problem to design, implementation Tasks,
verification evidence, user documentation, and release communication. Tasks remain the execution
unit; a Feature owns the cross-task intent and delivery record that must survive individual agent
sessions and worktrees.

The default workflow is:

```text
Problem → Product/UX design → Technical plan → Implementation → Verification
        → Feature docs → Release/communication → Done
```

## Product model

The project-level **Features** page is a delivery workbench rather than another task list. Its left
queue switches between Features, the stage rail keeps the whole SOP visible, the central workbench
holds the brief, linked Tasks, artifacts, and event history, and the right rail explains the current
gate. Selecting another Feature changes the in-page selection without creating duplicate app tabs.

An Issue can become a Feature directly from both project Issue surfaces. The source Issue is kept as
a durable relation and remains visible from the Feature. Existing direct Issue-to-Task actions stay
available as a quick path. A Task can be linked to a Feature from the workbench and shows a backlink
to its owning Feature on its overview.

Artifact URIs accept project-relative files and external URLs. Project files reuse Yoda's shared
file actions and project editor tab, including SSH-aware targets. Artifact approval is explicit so a
link alone is not mistaken for reviewed evidence.

## Fixed P0 gates

Stage transitions are evaluated in the main process and cannot be bypassed by renderer state.

| Current stage | Required before advancing |
| --- | --- |
| Problem | Non-empty problem definition |
| Design | Approved product spec and acceptance criteria |
| Planning | Approved technical plan |
| Implementation | At least one linked Task; every linked Task is in review or done |
| Verification | Approved test evidence |
| Documentation | Approved Feature documentation |
| Release | Approved delivery summary |

Blocked, cancelled, and completed Features cannot advance. A user may retreat to an earlier stage;
the transition is recorded and completion is reopened. Every create, edit, status change, stage
transition, Task link, and artifact mutation writes an event to the delivery ledger.

## Architecture

- `src/shared/features.ts` is the contract for stages, statuses, artifacts, gates, and RPC inputs.
- `src/main/core/features/feature-service.ts` owns aggregate hydration, relationship validation,
  gate enforcement, and the event ledger.
- `features`, `feature_tasks`, `feature_issues`, `feature_artifacts`, and `feature_events` persist the
  current projection and its history.
- `src/renderer/features/features/use-features.ts` is the renderer query/mutation boundary. Feature
  queries also invalidate when linked Task status, name, or archive state changes.
- The project Feature workbench lives under
  `src/renderer/features/projects/components/features-view/`.

## Next layers

P1 should derive artifact freshness from content hashes and automatically ingest test runs, changed
files, pull requests, and release state instead of asking users to enter every URI. P2 should add
template/version governance, policy profiles per repository, agent-readable gate APIs, historical
cycle-time analytics, and reusable generation flows for functional docs, PR descriptions, release
notes, and SEO assets. Those layers extend this aggregate; they should not create parallel workflow
state.

## Verification

- Shared gate tests cover every transition rule and stale evidence.
- Service tests exercise Issue creation, audit events, artifact approval, Task status, and
  cross-project isolation against SQLite.
- Navigation tests prove Feature selection stays inside one project page tab.
- Migration tests apply the generated Drizzle migration to a clean and upgraded database.
- The repository's format, lint, typecheck, and full test gates must pass before merge.
