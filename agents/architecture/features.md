# Feature Delivery

## Boundary

A Feature is the project-scoped delivery aggregate above Tasks. It owns the problem, expected
outcome, SOP stage, source Issues, linked implementation Tasks, evidence artifacts, and immutable
event history. A Task still owns its worktree, conversations, branch, and lifecycle status.

Do not duplicate Feature state in renderer stores or Task rows. Read and mutate it through the
`features` RPC controller.

## Source of truth

- Contract and gate evaluator: `src/shared/features.ts`
- RPC controller: `src/main/core/features/controller.ts`
- Aggregate and transition rules: `src/main/core/features/feature-service.ts`
- Persistence: Feature tables in `src/main/db/schema.ts`
- Renderer data boundary: `src/renderer/features/features/use-features.ts`
- Project UI: `src/renderer/features/projects/components/features-view/`
- Feature Team coordinator: `src/main/core/features/feature-loop-service.ts`
- Room evidence protocol/projection: `src/shared/feature-workflow.ts`

## Invariants

- Only `FeatureService.advance()` and `FeatureService.retreat()` change a stage.
- Evaluate gates from freshly hydrated Task and artifact state in the main process.
- A linked Task must belong to the same project as the Feature.
- `feature_workflow_owners` is the atomic Task → Feature claim for Feature Team starts. Do not replace
  it with check-then-create logic.
- Only one active `feature-workflow` Room may own a project Task. Room creation and Task unlink must
  re-check the relationship inside a database transaction.
- Artifact approval and staleness are explicit states; a URI is not proof of review.
- A Feature Team Room stores `featureId`; never infer ownership from a Task link, room name, or
  transcript line.
- Team Room status and routing project freshly hydrated Feature state. Room messages may propose
  draft evidence but must never approve artifacts or advance stages.
- Agent-proposed artifacts retain Task/Room/message/member provenance. A replacement proposal must
  stale older non-stale evidence of the same type before it can be reviewed.
- Agent ingestion must re-read both Feature status and stage inside the write transaction. A blocked,
  cancelled, completed, or stale-stage reply has no aggregate or Task side effects.
- Write a `feature_events` entry for every user-visible aggregate mutation.
- Emit `featureUpdatedChannel` after mutations so all renderer surfaces converge.
- Reuse Issue records and shared file/path actions; do not add Feature-specific copies.
- Adding a new stage, artifact type, or gate requires shared tests and both locale files.

## Database changes

Feature tables are ordinary Drizzle schema. Edit `src/main/db/schema.ts`, run
`pnpm exec drizzle-kit generate`, and test migrations. Never hand-edit numbered migrations or
`drizzle/meta/`.
