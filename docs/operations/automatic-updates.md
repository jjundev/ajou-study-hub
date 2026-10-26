# Automatic update preparation

The initial `study-hub-update.yml` workflow verifies only. It has no publishing stage, Cloudflare credential, or ledger credential. Automatic publication remains disabled until later readiness and activation tasks complete. The existing manual release still requires fresh human proof within 24 hours.

## Trust and execution order

Only `jjundev/ajou-study-hub`, `refs/heads/main`, and the workflow from that same trusted app SHA may run. Pushes and manual dispatches are accepted; PRs, forks, and `pull_request_target` are not accepted. The optional `source_repository` input is checked against the five configured course repositories before token creation. The only mode is `verify`.

The job uses Ubuntu 24.04, Node 24.15.0, a 60-minute timeout, and the `study-hub-production` concurrency group without cancellation. App permissions are Contents:read and Actions:read. All external actions use full commit SHAs; their official `action.yml` contracts were checked through the GitHub API during implementation on 2026-10-26.

The app is checked out to `app/`; sources are sibling checkouts in `sources/<course-id>/`. The trusted tracked files, Git index and HEAD, effective and local Git configuration, hooks, and selected credential/runtime files are fingerprinted immediately after app checkout. This layout preserves source ownership and reserved output checks, and the verification project continues to be resolved from the installed module location.

An explicitly approved bootstrap runs `npm ci --ignore-scripts` **before** Reader token creation solely to load the pinned TypeScript resolver. The Reader App has Contents:read on the five source repositories only. Its private key is passed only to the token action; its token is passed only to revision resolution, fixed-SHA checkouts, and revocation. No credential is a job-wide environment variable, and checkouts use `persist-credentials: false`.

All five `main` SHAs are resolved once with the existing resolver. Checkouts use those SHAs throughout the run. The token is explicitly revoked before normal `npm ci`, browser installation, synthetic tests, or material execution. The token action retains its post-job revocation fallback. Failed revocation blocks subsequent validation. Cancellation or runner loss can prevent explicit cleanup; installation tokens remain subject to GitHub's expiration and the action's cleanup behavior, so live lifecycle behavior must be checked in preparation.

Only the trusted app's commands run. Source repository scripts are never invoked. The preflight rejects symlinks and special files, limits source files to 100,000, each file to 256 MiB, all source bytes to 2 GiB, and requires 4 GiB free before reading material. Existing source path validation and final bundle limits still apply. These checks occur after clone; clone/download disk exhaustion can still fail the job safely. Typecheck, unit tests, and Chromium/Firefox/WebKit E2E run before the material build. Both build and content verification explicitly use `.local/ci-sources.json` in the same checkout.

## Boundary guarantee and mandatory remaining work

**The process boundary is detection only. Passing this workflow does not establish enforceable isolation against malicious code running with the runner user's permissions. Task 6 must keep `readiness.isolation` false until a concrete separate trust boundary is implemented and tested on actual Linux.** A process scan or a synthetic test must never be recorded as that proof. Future deployment credentials must not be added on the assumption that this check alone makes them safe.

`assertCleanBoundary(project, trustedFiles)` rejects a changed tracked checkout, index, HEAD, effective configuration, hooks, credential/runtime fingerprint, surviving Reader environment, or relevant live process. The workflow also checks each sibling source checkout's effective Git configuration for credential helpers, authentication headers, and command/URL overrides. Linux reads only process ID, parent ID, user ID, executable path, and working directory. It excludes its own ancestor chain, detects workspace services and known browser/Node/build runtimes even after reparenting, and never dumps arguments/environments or kills processes. An unsupported platform or unreadable metadata fails closed. Same-UID tampering with the checker, baseline, dependencies, or an unrecognized reparented process remains outside this detection guarantee; there is also a scan-to-next-step race.

Task 6 must perform the first actual Linux run, check Korean paths and all three browsers, validate clean and intentionally surviving harmless owned processes, verify Reader revocation and credential absence, and establish actual isolation separately. Windows unit tests and synthetic process rows do not satisfy these requirements. No private material/API/session/DPAPI access, remote change, deployment, or secret setup was performed to implement this workflow.

## Diagnostics and recovery

Application, test, browser, and material command output is suppressed; failures expose fixed safe error codes. No raw exception, credential, process argument, environment, HTML/PDF material, proof/session file, `dist/`, `.local/`, or `.reports/` is uploaded. A successful run uploads only `app/ci-summary.json`: validated app SHA, source count, and a verification-only detection code, with a hard 1 MiB bound and seven-day retention. Dependency and action service logs remain governed by GitHub Actions; do not enable debug tracing around credentials or private material.

A failure requires investigation with the matching safe code and pinned revision identity. A verification run does not mutate the publication ledger or retry a publication. Local-only changes, untracked files, and unpushed commits are absent from remote source checkouts. The published site is not replaced or changed by this workflow.
