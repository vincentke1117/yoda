# Governed Feature development workflow

## Problem

Feature delivery used to be split between independent prompts, Task sessions, review loops, and
documentation work. A Team Room could look complete while the project had no durable delivery
record, and a database Feature could remain at Problem while room messages claimed every step had
passed. The product needs one traceable contract from the original problem through product/UX
design, technical planning, implementation, verification, user documentation, and PR/SEO material.

## Product decision

The project-scoped `Feature` aggregate is the only source of truth for stage, status, linked Tasks,
artifact approval, and the immutable delivery trail. A Feature Team Room is its execution surface:
it owns agent sessions and hand-off evidence, but it cannot approve artifacts or advance a gate.

The canonical lifecycle has eight durable stages:

```text
Problem → Product/UX design → Technical plan → Implementation → Verification
        → Feature docs → Release/communication → Done
```

The Room presents the user's six-step mental model by grouping Technical plan + Implementation as
Engineering and Release + Done as PR/SEO. Both rails are projections of the same database Feature;
room messages never form a second state machine.

## Start and identity

- Feature remains a built-in sequential Agent Team under Home's Workflow choices and the branch /
  Issue Task creation flow.
- Starting the Team idempotently creates or reuses one active Feature, imports the Task's linked
  Issues, links the Task, and stores the Feature id on the Team Room.
- If more than one active Feature matches a Task or Issue, creation fails explicitly instead of
  choosing one by query order.
- A retry reuses a complete active Room. A partial Room is archived before rebuilding its roster.
- Pull-request review Tasks keep the Standard path because they start after feature discovery.

## Evidence and gates

Agents send typed `[FEATURE:<step>:ready]` or `[FEATURE:<step>:blocked]` JSON envelopes. Ready means
"reviewable", not "approved". The main process validates the current Feature stage, author,
recipient, artifact types, duplicate types, and repository-relative paths before ingestion.

- Product Design proposes `product_spec`, `ux_design`, and `acceptance_criteria`.
- Engineering first proposes `technical_plan`; after that gate is approved and advanced, the same
  owner implements code. An implementation-ready hand-off moves its linked Task to Review.
- Quality proposes `test_evidence` from a durable validation report.
- Feature Docs proposes `feature_docs`.
- PR & SEO proposes `delivery_summary`, `pull_request`, `release_note`, and `seo`. A non-applicable
  SEO result is still a real artifact explaining why.

Agent proposals are stored as `draft`, include Task/Room/message/member provenance, and stale older
non-stale evidence of the same type. A human reviews and approves the draft in Feature delivery,
then uses the existing main-process gate action to advance. A blocked hand-off is recorded without
silently changing the aggregate status. Failed verification requires an explicit retreat to
Implementation before Engineering can be routed again.

## Interaction

The Room header links back to the authoritative Feature. Its responsive 01–06 rail reads Feature
state and shows the latest hand-off only as supporting detail. **Continue current stage** sends the
Feature Lead the freshly translated canonical stage after a human advances or retreats a gate.
Routing allows only Human → Lead, Lead → current owner/Human, and current owner → Lead; broadcasts,
future owners, and malformed evidence are rejected.

Artifacts produced inside a Task worktree retain `sourceTaskId`, so file actions open the real Task
workspace instead of pretending the file already exists in the project root.

## Persistence

- Migration `0038` introduces Features, relationships, artifacts, and the event ledger.
- Migration `0039` adds Room → Feature identity and artifact Task/Room/message/member provenance.
- Migration `0040` adds atomic Task → Feature workflow ownership and prevents duplicate active
  Feature Rooms for one Task.
- `FeatureService` remains the sole transition boundary and emits `featureUpdatedChannel` after
  mutations so the workbench, Task backlink, and Room projection converge.
- Every accepted agent hand-off is auditable with `actorType = agent`; approvals and stage actions
  retain their real actor.

## Acceptance criteria

- Starting Feature from Home, branch, or Issue produces one linked Feature and one complete Room.
- Repeating the start operation does not duplicate the Feature, Task link event, or Room.
- Concurrent starts coalesce on the same durable owner; an active workflow Room prevents its Task
  from being detached.
- The Room cannot route a future owner or derive completion from marker order/runtime idleness.
- Blocked, cancelled, completed, or stale-stage Agent replies cannot write evidence or move a Task.
- Agent evidence enters as draft with provenance; it cannot bypass approval or `evaluateFeatureGate`.
- A new proposal stales prior approval of the same artifact type.
- The six-step Room rail and eight-stage Feature workbench always project the same aggregate stage.
- Team Room Tasks retain a visible link to Feature delivery.
- Product/UX, technical plan, verification, functional docs, PR, release note, and SEO artifacts are
  all required by their canonical gates.
- Existing Standard, Spec, Review, Startup, custom-team, and PR Task behavior remains unchanged.
