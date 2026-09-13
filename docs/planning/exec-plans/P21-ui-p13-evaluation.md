# P21 — Account-backed P13 evaluation UI

## Outcome

Let an authenticated operator select one of their sites, the robot at that site, and an eligible
build from the normal Rovaulta workspace, then request the existing account-scoped confidential
evaluation without copying identifiers or entering credentials in a terminal.

The browser remains a projection and uses the existing authenticated `/evaluations` route. The API
session supplies account identity; the UI never receives or submits the account password and does
not invoke the P13 shell runner.

## Non-goals

- No new evaluation authority, CRE workflow, secret provisioning, gateway behavior, or P13 protocol
  change.
- No browser access to private policy, envelope, blind, credentials, or CRE payloads.
- No automatic Sepolia clearance issuance, Graph query, Ledger signing, or release authorization.
- No replacement for the operator-only `p13:account-evaluation` evidence command.
- No fixture data in normal authenticated workspace routes.

## Invariants

- `/auth/me` and authenticated API cookies remain the only account identity source.
- Site, robot, and build options are loaded through account-scoped API routes and submitted exactly
  as selected; server-side ownership and build readiness checks remain authoritative.
- The configured `ROVAULTA_CRE_EXECUTION_MODE` stays server-side. Simulation provenance and gateway
  failures remain truthful in the existing public evaluation projection.
- `CLEAR` remains an evaluation result only; release preparation still requires the exact public P4
  clearance and human Ledger boundary.
- Loading, empty, invalid, pending, and unavailable states remain explicit and accessible.

## Change surfaces

- `apps/web/src/app/real-workspace.tsx`: load all account-owned site resources, add cascading site /
  robot / build selectors and authenticated P13 evaluation action, preserve the existing result
  projection and query-string deep links.
- `apps/web/src/app/globals.css`: add only the selector/status layout styles required by the
  account evaluation panel, preserving the existing visual system.
- `tests/e2e/p8-product-flow.spec.ts` or a focused web test: cover selector presence and the
  authenticated evaluation request path without adding a broad UI suite.
- `docs/planning/exec-plans/P21-ui-p13-evaluation.md`: record decisions and verification.

## Acceptance checks

- An authenticated operator sees their account email and available sites without DevTools.
- Selecting a site filters robots; selecting a robot filters builds; no raw IDs need to be typed.
- Selecting a build and pressing the evaluation action calls the existing `/evaluations` endpoint
  with the selected identifiers and sends no email/password field.
- The UI preserves `PENDING`, `CLEAR`, `HOLD`, `ESCALATE`, and `CRE_UNAVAILABLE` behavior from the
  current endpoint; it never invents a verdict.
- Anonymous users are redirected to account entry by the existing workspace guard.
- No confidential fields are rendered or serialized in the browser.
- Targeted web typecheck/test and repository verification pass, with pre-existing dirty files
  preserved.

## Steps

- [x] Explore current authenticated API, runner, workspace, and test boundaries
- [ ] Implement account-scoped resource loading and cascading selectors
- [ ] Add focused regression coverage
- [ ] Run targeted and full verification
- [ ] Update this plan with evidence

## Decisions / deviations

- The UI deliberately calls `POST /evaluations` rather than trying to automate the CLI runner. The
  runner is an operator/evidence wrapper; the HTTP route is the product path and already performs
  the same account ownership, exact binding, confidential evaluation, and persistence checks.
- Multi-site support is implemented by composing the existing authenticated per-site list routes;
  no broader API endpoint is introduced unless verification reveals a concrete need.

## Verification evidence

Pending implementation.
