# Feature delivery launch packet

## Pull request

### Title

Unify governed Feature delivery with the multi-agent execution workflow

### Body

Yoda now carries a product problem through product/UX design, technical planning, implementation,
verification, functional documentation, and PR/release/SEO material without creating a second
workflow truth inside Team Room.

- Add the project Feature delivery workbench, canonical eight-stage gate evaluator, linked Issues /
  Tasks, explicit artifact approval, and immutable event history.
- Add a built-in Feature Team and responsive six-step execution rail for the user's closed-loop SOP.
- Make Feature start idempotently create/reuse and link the authoritative aggregate, then persist its
  id on the Room.
- Serialize concurrent starts with a durable Task → Feature owner, a single-flight seed, and a
  database-unique active Feature Room.
- Project the Room rail and routing from freshly hydrated Feature state; messages only carry typed
  evidence and cannot unlock a future stage.
- Ingest current-owner artifacts as drafts with Task/Room/message/member provenance, stale older
  evidence of the same type, and keep approval/advance behind `FeatureService` gates.
- Open worktree-produced evidence in its source Task and provide Room ↔ Feature navigation.
- Require the complete Product/UX, technical plan, validation, feature docs, PR, release, and SEO
  package before Done.

### Verification

- Shared tests cover canonical gate requirements, six-step projection, typed envelopes, canonical
  routing, and wrong-owner/future-stage rejection.
- Main-process tests cover idempotent Feature/Task creation, provenance, stale evidence, blocker
  recording, concurrent starts, active-Room unlink protection, stale-stage rejection, and guarded
  Implementation → Task Review behavior.
- Required repository gates: format, lint, typecheck, full tests, application build, docs build, and
  generated migration verification.
- External `yoda-docs`: typecheck, production build, and public route smoke test.

### Migration and compatibility

- `0038_curvy_zuras` creates the Feature delivery aggregate tables.
- `0039_lively_rumiko_fujikawa` adds Room → Feature identity and artifact provenance columns/indexes.
- `0040_fine_zarek` adds the durable workflow owner and one-active-Feature-Room database constraint.
- Existing Standard, Spec, Review, Startup, custom-team, and pull-request flows remain unchanged.
- Existing Room and artifact rows migrate with nullable provenance and continue to load.
- External PR creation, merge, and publication remain authorization-bound.

## Changelog

Develop Features through one governed delivery spine: specialist agents prepare product/UX,
technical, test, functional-doc, PR, release, and SEO evidence; humans approve explicit gates; every
Room and worktree artifact stays linked to the authoritative Feature.

## SEO

- Title: `Yoda Feature Delivery: A Governed AI Workflow from Problem to Release`
- Description: `Coordinate product design, technical planning, coding, verification, user docs, PRs, release notes, and SEO in one auditable Yoda Feature workflow.`
- Slug: `feature-development`
- Keywords: `AI feature development workflow`, `multi-agent product development`, `AI coding governance`, `Feature delivery`, `AI PR documentation`
- Search intent: product and engineering teams seeking an AI workflow that preserves explicit
  evidence and approval from discovery through release instead of stopping at code generation.
