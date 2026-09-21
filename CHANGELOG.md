# Changelog

All notable changes to AuditBounty are documented here. Format is chronological, newest first.

## [Unreleased] — Evidence Integrity v2 (2026-09-21)

**Type:** Security / UX integrity — GenLayer Portal Milestone submission.

### Added
- **Distinct reference hosts.** `submit_report` and `add_evidence` parse each
  URL host (strip scheme / path / port / leading `www.`) and reject when:
  - the two reference hosts are the same site, or
  - any reference host matches a PoC host.
  Hunters can no longer paste three URLs on one domain and call them
  "independent". No money math changes — only `UserError` guards.
- **Honest GenVM errors in the UI.** After `waitForTx`, the frontend checks
  the receipt / list growth. A FINALIZED tx with GenVM ERROR no longer shows
  a green "Transaction submitted" banner while Reports stays empty
  (the false-success path from operator self-report / same-host refs).
- Client-side `assertIndependentHosts` before signing, matching the on-chain
  rule so MetaMask is not prompted for an obviously invalid submit.
- `gltest` cases: `test_reference_hosts_must_be_distinct`,
  `test_add_evidence_enforces_distinct_hosts`.

### Verified
- `gltest tests/test_audit_bounty.py`: expect **20/20** (18 from v1 + 2 host cases).
- `npm test` / `npm run build`: frontend money + poll/host helpers + float guard.

### Deployment
- Redeployed Evidence Integrity v2 `audit_bounty.py` on studionet:
  `0x7FfaD478600C98F9B2DD79aBa61F2eB3c5398032`
  ([explorer](https://explorer-studio.genlayer.com/address/0x7FfaD478600C98F9B2DD79aBa61F2eB3c5398032)).
  Previous (Security Hardening v1): `0x53C29f3686DC323BBb1Ed00aC80e1a752F8c0043`.

---

## [1.1.0] — Security Hardening v1 (2026-09-11)

**Type:** Security / architecture improvement — GenLayer Portal Milestone submission.

### Added
- **Settlement reentrancy guard.** `resolve_report` and `retry_resolution` now
  write an interim `report.status = "SETTLING"` to storage *before* the
  external `gl.get_contract_at(hunter).emit_transfer(...)` call, instead of
  only updating status *after* the transfer returns. Both methods' entry
  guards (`SUBMITTED`/`DISPUTED` for resolve, `PAYOUT_FAILED`/`REJECTED_NO_FUNDS`
  for retry) already reject any other status, so `SETTLING` closes the
  window where a reentrant call on the same `report_id` — while the transfer
  is outstanding — could have re-run AI resolution and drained `pool_balance`
  a second time for one report.
- **Operator self-report block.** `submit_report` now rejects a caller whose
  address matches `program.operator`. Previously an operator could submit a
  report against their own bounty program and pair it with fabricated
  PoC/"independent" reference content they also controlled, since the AI
  reads whatever content lives at the submitted URLs.
- `SETTLING` badge styling in the frontend (`badge-settling`) so the new
  transient status never renders unstyled if a client happens to poll a
  report mid-transaction.
- Two new `gltest` cases: `test_operator_cannot_self_report` and
  `test_settling_lock_blocks_reentrant_resolve` (the latter drives a real
  reentrant `resolve_report` call through a `_gl_call_hook` during the
  outstanding `PostMessage` transfer and asserts it is rejected and the pool
  is debited exactly once).

### Fixed
- `tests/test_audit_bounty.py`'s `sim_installMocks` helper now wraps plain
  string web-mock bodies into the `{"status": 200, "body": ...}` shape the
  currently pinned `gltest` release expects (`vm.mock_web` requires a
  dict-like response); previously any AI-resolution test failed against
  `genlayer-test>=0.29.2` with `'str' object has no attribute 'get'`.
- Transfer-failure and reentrancy `gltest` cases pin to
  `gltest.direct.loader._EOAProxy.emit_transfer` on `genlayer-test==0.29.2`.
  That release still pays hunter EOAs through `_EOAProxy` and does not
  route `emit_transfer` through `vm._gl_call_hook` / `PostMessage`.

### Verified
- `gltest tests/test_audit_bounty.py`: **18/18 passed** (was 6/16 passing
  out-of-the-box against the currently pinned `gltest` release before this
  round; 15/16 after only the mock-format fix; 18/18 after the two harness
  fixes plus the two new security-fix tests above).
- `npm test` (frontend money/list unit tests + float guard): all passing.
- `npm run build`: clean production build.

### Deployment
- Redeployed hardened `audit_bounty.py` on studionet:
  `0x53C29f3686DC323BBb1Ed00aC80e1a752F8c0043`
  ([explorer](https://explorer-studio.genlayer.com/address/0x53C29f3686DC323BBb1Ed00aC80e1a752F8c0043)).
  Previous address (pre-hardening): `0x1F4E41A975E8E6Fd216223993dCa469C02Bd2850`.

---

## [1.0.0] — Initial build (pre-2026-09-11)

- `create_bounty_program` / `fund_program` / `submit_report` / `add_evidence`
  / `resolve_report` / `retry_resolution` with fixed four-tier payouts
  (`CRITICAL`/`HIGH`/`MEDIUM`/`LOW`/`INVALID`), discrete-verdict `gl.vm.run_nondet`
  consensus (absolute verdict equality + matching confidence branch, no
  percentage tolerance).
- Deployed to GenLayer studionet: `0x1F4E41A975E8E6Fd216223993dCa469C02Bd2850`.
- React + `genlayer-js` frontend, `money.js` wei/GEN helpers, float guard,
  preview mode, category-based scope/criteria chips.
- `gltest` happy-path/edge-case suite; frontend money + poll unit tests.
