# Assumption Test: automatic updates

**Scope:** Existing local app at codex/study-hub-implementation; follow-on automatic source sync/private cloud release. Read-only local audit and official documentation lookup on 2026-10-25. No build, test, dependency installation, fetch, cloud mutation, login or deployment was performed.

**Gate:** BLOCKED for unattended upload under the existing release contract. This returns the authentication/evidence contract to design; it does not block explaining options or writing a design proposal.

## Evidence ledger

| # | Assumption | Why plan-shaping | Test performed and evidence | Status | Plan impact |
| --- | --- | --- | --- | --- | --- |
| 1 | Build reads current remote main | Source selection | tools/content/source.ts:60-73,161-163 and .local/sources.json:3-7 read local roots/current filesystem | REFUTED | CI must fetch all five private sources and explicitly select real-data settings |
| 2 | Existing build requires clean commit bytes | Reproducibility | source.ts:73,162 records dirty, reads worktree; stored report has life-science dirty | REFUTED | Clean pinned remote commits are a new CI policy; remote output can differ from locally unpushed data |
| 3 | Existing proofs can move across machines/jobs | Verification boundary | tools/source-binding.ts:12-40 binds settings bytes/canonical roots; tools/deploy/release.ts:30-33 fixes report/dist | REFUTED | Fresh evidence on one consistent checkout/settings identity, no Windows proof import |
| 4 | API token alone supports unattended Access verification | Feasibility | tools/deploy/access.ts:100-102,141-145 requires real owner/other browser identities and rejects service token identity | REFUTED | Resolve a separate unattended protection contract before implementation planning |
| 5 | One initial protection proof lasts indefinitely | Renewal | tools/deploy/guard.ts:7-10 expires after 86,400,000ms; release.ts:46,59,71 rechecks | REFUTED | A workflow pasted around current commands cannot provide continuing unattended deploy |
| 6 | Linux execution is already proven | Environment | Node 24 and relative roots supported by config; no Linux run performed; source child aliases forbidden | UNRESOLVED | Bounded Linux validation before claims of CI compatibility |
| 7 | Sync/workflows already exist | Scope | No .github directory or tracked .github paths; README and PRD manual-only | REFUTED | New scope/design and implementation plan required |
| 8 | Cloud prerequisites exist | Deployment activation | No .local/deployment.json or .reports/access-evidence.json; operations docs mark cloud acceptance pending | REFUTED | No live activation without account/provisioning/initial acceptance |
| 9 | GitHub Pages fits owner-only and current size | Hosting choice | Official Pages visibility and limits pages linked in design: Enterprise Cloud org access control; max1GB; stored current output1,106,504,248bytes | REFUTED | Keep proposed Cloudflare hosting instead of ordinary personal Pages |
| 10 | Private source checkout is authorized by app GITHUB_TOKEN | Cross-repo permissions | actions/checkout official README private multi-repo section says current-repo scope | REFUTED | Separate narrowly scoped source access and event-delivery credentials |
| 11 | Free services imply unconditional zero bill | Cost controls | Official Actions billing: included minutes/storage, billable excess; CF static requests/storage free with platform limits | REFUTED | Verify actual account tiers, billing limits and runner usage; no unconditional guarantee |
| 12 | Add source notification workflows or poll hourly | Product/source-write choice | User asked for automation but has not selected trigger or changed previous original-write constraints | USER_DECISION | A modifies five workflow files; B changes only app with delayed scheduled checks |

## Verified premises for implementation planning

- Five fixed repositories are mapped by config/courses.ts:47-51. Current builds deliberately preserve local worktree bytes rather than modifying originals.
- .local, .generated, .reports, dist and .wrangler are ignored. Default build/dev uses fixtures unless --sources is supplied (tools/cli.ts:27-31).
- Stored app report:4,796 inputs;4,803 outputs;1,106,504,248bytes; maximum file12,182,784bytes. Stored runtime proof has220documents/42scenarios and387,793ms duration. This audit did not rerun it.
- Release copies the full bundle into isolated staging, requiring another approximately1.11GB beyond dist plus source checkouts/dependencies.
- Official service facts and direct URLs are recorded in the paired design proposal. Actual GitHub plan, remaining minutes, Cloudflare Free/API compatibility and upload success remain unknown.

## Conditions and prohibited assumptions

- Do not copy personal OTP/cookies into CI or mint false fresh human evidence.
- Do not weaken the current guard to fit a workflow without explicit design and security review.
- Do not claim current dirty local data equals pushed remote data.
- Do not assume Linux execution, cross-job path portability or free live account compatibility.
- Current local implementation and completed acceptance evidence remain intact; this is a new design task.

## Required next actions

- Select event notifications versus scheduled checking, with explicit source-workflow scope.
- Return unattended Access evidence/authentication to design, validate the chosen contract before dependent implementation planning.
- Validate chosen Linux runtime and source shape at a bounded implementation preflight after the design gate is resolved.
- Obtain real account setup/activation approval separately from code/design preparation. No secrets through chat.
