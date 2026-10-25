# 실행 중 내린 판단

기준일: 2026-10-25. 승인된 PRD를 구현하며 결정한 내용과 잘못됐을 때의 비용을 시간순으로 보존한다. 아래는 실행 기록의 원문이다. 후속 판단으로 대체된 실험도 포함하며, 실제 클라우드 작업의 승인이나 인수 완료를 뜻하지 않는다.

## 1

```text
Ruling: Allow source.ts edits in Task 2 and tools/cli.ts edits in Task 5 — plan steps require shared path extraction and CLI source consumption despite incomplete Modify lists — if wrong, small scope rework.
```

## 2

```text
Ruling: Implement Task 9/10 local gates before stopping for live cloud setup — PRD allows local work independently and user has not authorized a specific account or publish action — if wrong, adapter rework after actual account discovery.
```

## 3

```text
Ruling: Prefer a compatible patched undici override over downgrading Wrangler if metadata permits — initial current Wrangler dependency audit found a high severity dev-server vulnerability — if wrong, the local emulator may need dependency adjustment.
```

## 4

```text
Ruling: Apply undici 7.30.1 despite Miniflare exact 7.29.1 pin, with Wrangler version/startup smoke — patched same-major dependency avoids known vulnerability — if wrong, local emulator compatibility will need adjustment; Task 8 rechecks it.
```

## 5

```text
Ruling: Extend Node-only SourceSnapshot with repoRoots — resolver needs canonical roots for realpath containment while browser Catalog must omit them — if wrong, internal interface refactor only.
```

## 6

```text
Ruling: Move bounded full-corpus collection performance refinement/completion to Task 4 — Task 2 contracts/path safety pass synthetic tests but actual asset traversal exceeded five minutes — if wrong, Task 4 may need collector/source refactor before build can pass.
```

## 7

```text
Ruling: Rebase deployment root-relative HTML/CSS references in Task 4 output transformation — Task 2 graph intentionally preserves source bytes and reviewer confirms cross-task obligation — if wrong, generated deployment URLs fail and must be corrected before release.
```

## 8

```text
Ruling: Derive UI product/context and code-led direction from approved PRD without a new design interview — user explicitly chose continuous SDD with decisions delegated and scope fixed to plan — if wrong, visual direction may need rework; no standing image-workflow preference will be stored.
```

## 9

```text
Ruling: Write a separate app-inclusive BuildReport after Vite build and bind runtime verification/release to that final dist hash — content-only Task4 hash cannot attest app assets added by Tasks5/8 — if wrong, report interfaces need adjustment before release; never accept content-only attestation for full dist.
```

## 10

```text
Ruling: Keep Vite config/publicDir/dist fixed and reject output/root/config/empty-directory overrides before content writes or launch — arbitrary passthrough can delete sources and attest stale dist — if wrong, users must add explicitly validated CLI options later; default workflow unaffected.
```

## 11

```text
Ruling: Allow Task6 build.ts bootstrap bundling and synthetic fixture/test helper edits — implemented esbuild integration lives in build.ts, so bridge cannot be shipped by transform.ts alone — if wrong, small integration scope rework; public contracts unchanged.
```

## 12

```text
Ruling: Permit additive optional preserveReader parameter on catalog setSelection and Task6 catalog-view edit — native iframe navigation must update selection/title without remounting and inserting a joint-history no-op — if wrong, selection/reader ownership may need refactor; one-argument behavior must remain compatible.
```

## 13

```text
Ruling: Allow bounded default Playwright workers3 if documented8-worker Windows resource contention is confirmed —72/72 reader/catalog/storage pass at3 while parallel build servers also caused EPERM — if wrong, the suite is slower and any real application race still must be fixed, not hidden.
```

## 14

```text
Ruling: Extend read Route and reader open/onNavigate with optional document search state, keeping old call/URL shapes valid — PRD preserves existing links and plan read-route shape omitted queries, causing query loss and native remount/history errors — if wrong, route/interface cleanup may be needed; no existing routes should break.
```

## 15

```text
Ruling: Test per-iframe single history owner (parent-owned initially; native-owned after actual native nav, bridge stays native thereafter) — concrete mixed-owner failures in all browsers require consistent lifecycle semantics — if wrong, architecture needs escalation; explicit catalog selection/return/back/forward must also be tested before claiming fixed.
```

## 16

```text
Ruling: Permit revising plan-mandated per-document iframe disposal when native browser history requires retained browsing context — proven disposal orphans child entries in all3 engines, while PRD binds back/forward and trusted-frame compatibility — if wrong, lifecycle/generation safeguards need rework; stale URL/source/intent callbacks must still be rejected.
```

## 17

```text
Ruling: Permit static named iframe in index.html and catalog mounting around existing reader panel without DOM moves, including loading/error/retry — retained dynamic context passes45/48 but top refresh destroys nested history across3 engines — if wrong, browser restoration still needs redesign; existing standalone catalog API remains backward compatible.
```

## 18

```text
Ruling: Use standard Navigation API cancellation for cancelable same-origin cataloged native HTML navigation, parent-owned routing plus one-shot approved location.replace — isolated probes all3 pass and MDN Baseline2026/WHATWG confirm current support; retained context alone cannot restore child history after top reload in Firefox/WebKit — if wrong, current-browser history needs redesign; API-absent older browsers keep reading/click fallback with documented reduced native-history guarantees. Do not cancel downloads/forms/external/traverse indiscriminately.
```

## 19

```text
Ruling: Add deployment-copy History API compatibility wrapper and namespaced parent-entry source-state snapshots/replay — read-only audit found153 actual slideshow pushState calls across5 courses; merely skipping them recreates child-only history — if wrong, original slideshow/state semantics need rework; keep synchronous URL/state/errors and replay popstate/hashchange, no state in URLs/reports. Generation supersedes in-flight navigation without timing waits.
```

## 20

```text
Ruling: Cap Vitest workers3 if factual rerun confirms unbounded parallel Git-fixture15s timeouts disappear — full E2E117/117 passes but bare unit runner contends on Windows realGit fixtures — if wrong, default tests are slower and any true assertion failure still requires a fix; no timeout increase.
```

## 21

```text
Ruling: Supersede no-timeout-increase runner experiment with bounded real-Git integration allowances (default60s, existing multi-fixture30s test up to120s, worker cap3), preserving every assertion — controller measured5 git --version startups672/521/415/401/466ms and worker-cap-only hypothesis failed; untouched catalog tests need I/O time — if wrong, hangs take longer to fail, but no test may be skipped or accepted without all assertions passing; product timeouts unchanged.
```

## 22

```text
Ruling: Permit one exact runtime-only source external-font exception for linked eli5_lecture11_statistical_inference_part2.html GoogleFonts Pretendard URL, after retaining actualHTTP400(Font family not found)/ChromiumORB evidence and verifying readable fallback — deterministic original request defect, not collector failure; PRD permits explained exceptions — if wrong, fallback typography may degrade; never suppress otherURLs/scripts/math/errors or claim that font loaded.
```

## 23

```text
Ruling: Use verifier-owned zero-pending+500ms quiet request/finished/failed settlement instead of PW networkidle flag — actualterminalevents provefalseidle timeout andofficialPlaywright discouragesnetworkidle readiness — if wrong, late requests outsidequietwindow couldbe missed(asold500mswindow); explicit hanging/delayedrequesttests and allHTTP/pageerror/failure checks remain, no newexceptions/timeoutexpansion.
```

## 24

```text
Ruling: Exclude generatedbootstrap-test/report trees fromVitedevwatch, preservingappsrc/index/publiccontent watches; requireuniqueproject/runartifacts and finaldefault3workerE2E — noVitefocused9pass versuswithViteEPERM identifies artifactwatchcontention — if wrong, artifact-onlyhotreload islost and defaultmuststillpass; no producttimeout/disabledtests/generalretry workaround.
```

## 25

```text
Ruling: Bootstrap provisioning may validate an account/worker/email/URL subset before an Access appId exists; private/protection settings remain strict full DeploymentSettings — emptyWorker must exist to bind immutableworkerId beforeAccessappcreation — if wrong, initialemptyprovisioning needsworkflowrework; no realcontent/eligibleAccessproof allowed withoutactualappId.
```

## 26

```text
Ruling: Canonical identity probe uses API-confirmed team.cloudflareaccess.com/get-identity, account_id+humanuser_uuid+distinctemail; otherwitness must be an independently authenticated existing same-team session, targetfinalrecognizable403 afterboundedtrustedredirects(normalcookies), notgenericloginredirect — officialOTPblockedusers getnoPIN soowner-onlytargetcannotprepareotherlogin — if wrong ornosuchsession, actualotherproof remainsblocked; no policybroadening/newresources/fakeidentity.
```

## 27

```text
Ruling: releasePrivate.reportPath means final app-build manifest; runtime/protection proof remain canonical .reports/verification.json and access-evidence.json, deploymentreceipt separate — planreportPathwasambiguous and authorizationinputs must staydistinct — ifwrong, callerpathAPI reworkneeded; no proofoutput overwrite permitted.
```

## 28

```text
Ruling: Require current source profile path/bytes, selected inputs and Git provenance/tracking to still match the verified snapshot at private upload — current-input semantics were ambiguous for sealed historical artifacts; conservative first-release workflow avoids silently publishing stale intent — ifwrong, older verifiedartifact needs source restore/reverification; no automatic rebuild and no original writes. Addsourceidentitytoruntimeproof andfreshactualrun afteralltests ifschemachanges.
```

[현재 구현 상태](implementation-status.md) · [실행 계획](../superpowers/plans/2026-10-24-ajou-study-hub.md)
