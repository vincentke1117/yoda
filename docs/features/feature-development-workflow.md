# Feature development

Feature development turns one problem into a governed delivery record and a coordinated Team Room.
The Feature workspace owns the durable stage, approvals, linked Tasks, artifacts, and history; the
Room runs the specialist agents that prepare each piece of evidence.

## Start

From Home, choose **Workflow → Feature** after selecting a project. From **Create task**, choose
**Feature workflow** for a branch or Issue Task. Yoda provisions the Task, creates or reuses its
active Feature, links the source Issue and Task, and then starts one Feature Room. Retrying the same
action reuses that record instead of forking delivery state.

Concurrent starts share one in-flight seed and one durable Task → Feature owner. The database also
permits only one active Feature Room for a project Task. While that Room is active, the Feature
workspace locks its owner Task against accidental unlinking.

Pull-request Tasks retain their review-focused Standard flow.

## Canonical gates

| Feature stage | Agent owner | Evidence required before advance |
| --- | --- | --- |
| Problem | Feature Lead | A concrete problem definition |
| Product & UX design | Product Design | Approved product spec, UX design, and acceptance criteria |
| Technical plan | Engineering | Approved technical plan |
| Implementation | Engineering | Every linked Task is in Review or Done |
| Verification | Quality | Approved validation report / test evidence |
| Feature docs | Feature Docs | Approved user-facing feature documentation |
| Release | PR & SEO | Approved delivery summary, PR packet, release note, and SEO artifact |
| Done | — | The complete audited delivery record |

The Room groups this into six visible steps by combining Technical plan + Implementation and
Release + Done. Its status still comes from the table above.

## Review an agent hand-off

An agent's **ready** hand-off is a proposal, not a passed gate. Yoda validates it against the current
owner and stage, adds its artifacts to Feature delivery as drafts, and records the source Task,
Room, message, and member. Open **Feature delivery** from the Room header to inspect the real file,
mark each required artifact Approved, and advance the gate.

After advancing or retreating, return to the Room and choose **Continue current stage**. The Feature
Lead receives the current database stage and may delegate only its owner. A future-stage mention or
`@all` is kept waiting.

If a newer hand-off proposes the same artifact type, Yoda marks the older evidence stale. This
prevents an old approval from making a revised design or test report appear green.

## Failure and rework

- A blocked hand-off records the blocker and requested action without silently pausing the whole
  Feature. Set aggregate status to Blocked only when that is the intended product state.
- If verification finds an implementation defect, retreat the Feature to Implementation, continue
  the Room, fix it, move the Task back to Review, and verify again.
- Runtime completion never passes a gate. Missing/malformed evidence remains visible in chat but is
  not ingested.
- Blocked, cancelled, completed, or stale-stage Agent replies cannot add artifacts/events or move a
  Task to Review. Resume the Feature and ask the current owner to submit fresh evidence.
- Artifact paths are opened in the Task worktree that produced them, including SSH-backed Tasks.

The workflow prepares PR and SEO material but does not push, merge, publish, or create external
resources unless the original request and repository policy authorize those actions.
