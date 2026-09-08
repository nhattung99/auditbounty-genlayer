# AuditBounty — Neutral Escrow Bug Bounty on GenLayer

Web3 teams publish bug-bounty tables, then grade their own reports. Hunters have no way to force payment at the advertised severity. AuditBounty holds **real GEN** in **one Intelligent Contract**, lets a hunter submit a report plus **≥2 independent references**, and asks GenLayer AI consensus to return **exactly one of five discrete verdicts**:

`CRITICAL` · `HIGH` · `MEDIUM` · `LOW` · `INVALID`

Payout is a **lookup of the fixed amount published when the program was created**. There is no percentage, no multiplication, and no rounding on money.

> AuditBounty dies without GenLayer: no EVM contract can read an unstructured security report and classify it against published criteria, and no third party is cheap or fast enough to referee every small report. Only GenLayer's decentralized AI consensus can do this at near-zero cost.

## Live App

_(fill after Vercel production deploy)_

## Deployed Contract

- **Network:** studionet (GenLayer Studio hosted)
- **Address:** `0x1F4E41A975E8E6Fd216223993dCa469C02Bd2850`
- **Explorer:** https://genlayer-explorer.vercel.app/address/0x1F4E41A975E8E6Fd216223993dCa469C02Bd2850

---

## Why discrete verdicts + fixed payouts

A previous project (JobVerdict) was rejected because %-tolerance consensus let two validators “agree” while settling **two different amounts**. ClaimVerdict then burned many fix rounds on percentage math and rounding.

| Design | Validator check | Settlement |
|---|---|---|
| Continuous % ± tolerance | scores can pass while amounts differ | two different GEN numbers |
| **AuditBounty** | `verdict == verdict` on 5 values | `payout = tier_amounts[verdict]` |

`INVALID` pays `0`. Validators also must agree on the **confidence branch** (`>= 60` settle vs `DISPUTED`). Still no numeric interpolation of money.

---

## Why one contract

Multi-contract layouts previously trapped GEN when a cross-contract call did not forward `value`. AuditBounty keeps funds here only:

1. Operator sends GEN with `create_bounty_program` (`gl.message.value`).
2. Optional top-up via `fund_program`.
3. On resolve the contract pays the hunter with `gl.get_contract_at(hunter).emit_transfer(value=u256(payout))`.

No treasury hop. No value-forward bug.

---

## Resolution flow

1. **Create program** — operator sets scope, severity criteria, four fixed tier amounts, and locks GEN into `pool_balance`.
2. **Submit report** — hunter sends title, ≥1 PoC URL, ≥2 independent reference URLs.
3. **Resolve** — `resolve_report` runs `gl.vm.run_nondet`:
   - Leader fetches every URL with `gl.nondet.web.render`, prompts the model, parses `{verdict, confidence, reason}`.
   - Validator: absolute `verdict ==` and the same `confidence >= 60` branch.
4. `confidence < 60` → `DISPUTED`. Hunter may `add_evidence` and call `resolve_report` again.
5. Valid verdict → lookup fixed payout. If the pool is short → `REJECTED_NO_FUNDS` (verdict kept, no second AI run).
6. Transfer fail → reserve is rolled back, status `PAYOUT_FAILED`. `retry_resolution` reuses `payout_amount`.
7. `INVALID` → `RESOLVED`, `settled = true`, payout `0`, pool untouched.

---

## Verified APIs

| Need | API used | Do not use |
|---|---|---|
| Caller | `gl.message.sender_address` | `gl.message.sender` |
| Pay GEN | `gl.get_contract_at(addr).emit_transfer(value=u256(amount))` | `gl.transfer(...)` |
| Receive GEN | `@gl.public.write.payable` + `gl.message.value` on `create_bounty_program` / `fund_program` | `@gl.public.write` with non-zero value (current Studio raises `called non-payable method`) |
| Timestamp (if needed later) | `gl.message.datetime` → `datetime.fromisoformat` | `gl.block.timestamp` |
| TreeMap default | `map.get(key, default)` | — |

Header at time of writing (update if Studio ships a newer hash):

```python
# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
```

An older note that `.payable` “does not exist” is **wrong for the current Studio runner**. Functions that accept GEN must be `.payable`.

### Write methods

- `create_bounty_program(project_name, scope_description, severity_criteria, critical, high, medium, low) -> program_id` — attach GEN > 0; tiers must be `critical >= high >= medium >= low > 0`
- `fund_program(program_id)` — attach GEN > 0
- `submit_report(program_id, title, poc_urls, reference_urls) -> report_id`
- `add_evidence(report_id, poc_urls, reference_urls)` — hunter only, `DISPUTED` only
- `resolve_report(report_id)` — AI classification + settle
- `retry_resolution(report_id)` — replay stored payout after `PAYOUT_FAILED` / `REJECTED_NO_FUNDS` (no second AI run)

### View methods

- `get_program` / `list_programs` / `get_program_count`
- `get_report` / `list_reports` / `get_report_count`
- `get_owner`

All money fields leave the contract as **decimal strings of wei**.

---

## Money handling itemize

Every money field is **wei / base units**, `bigint` on-chain and `BigInt` off-chain. No `float` / `parseFloat` / `Math.round` / `Math.floor` / `Math.ceil` near money variables.

| Field | WRITE | READ | Converter |
|---|---|---|---|
| `critical_payout` | `create_bounty_program` arg (`bigint` wei from `parseGenToWei`) | `get_program` / `list_programs` → `str(int(...))` | on-chain `bigint` only |
| `high_payout` | same | same | lookup, never multiplied |
| `medium_payout` | same | same | lookup, never multiplied |
| `low_payout` | same | same | lookup, never multiplied |
| `pool_balance` | `bigint(gl.message.value)` on create/fund; subtract/add only the looked-up payout | views return `str(int(pool_balance))`; UI `formatWeiToGen` | `+` / `-` of stored wei |
| `payout_amount` | `_tier_payout(program, verdict)` — one of the four stored amounts or `0` | views return `str(int(payout_amount))` | no `%`, no rounding |
| Hunter payout | `emit_transfer(value=u256(payout))` after reserving `pool_balance` | UI shows `formatWeiToGen(payout_amount)` | exact stored wei |
| Retry | reuse stored `payout_amount` | same | does not re-run AI |
| GEN input on UI | chips / `sanitizeGenInput` → `parseGenToWei` → `writeContract({ value })` and four tier args | wei preview under each field | string-parse + `BigInt` |
| GEN display | — | `formatWeiToGen(...)` for all four tiers, pool, and payout | `BigInt` divide `10^18n` |

`parseGenToWei` / `formatWeiToGen` live in [`frontend/src/money.js`](frontend/src/money.js). Float guard: [`scripts/check-no-float-money.js`](scripts/check-no-float-money.js) on `prebuild`.

---

## Frontend

- Preview mode if `VITE_CONTRACT_ADDRESS` is missing (banner, no white crash).
- Category chips (Smart Contract / Web App / Mobile App / Infra) prefills scope + severity criteria.
- Four GEN inputs for the four tiers, validated **Critical ≥ High ≥ Medium ≥ Low** before submit.
- Report form: program dropdown, PoC + reference URLs with clipboard paste.
- **Request AI classification** loading state; severity badges (red / orange / yellow / green / gray).
- `DISPUTED` → add evidence. `REJECTED_NO_FUNDS` / `PAYOUT_FAILED` → **Retry**.
- Sticky banner: *Free to use — you only pay GenLayer network gas when you sign a transaction. There is no other platform fee.*
- Wallet stays on **studionet**.

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

---

## Tests

```bash
# contract (gltest fixtures: direct_vm / direct_deploy / direct_accounts)
gltest tests/test_audit_bounty.py

# frontend money + list helpers + float guard
cd frontend
npm test
```

Covered: happy path for each of CRITICAL / HIGH / MEDIUM / LOW (exact fixed payout), INVALID (no payout), pool short → `REJECTED_NO_FUNDS` → fund → `retry_resolution`, low confidence → `DISPUTED` → `add_evidence`, broken JSON, missing web mocks, missing PoC/refs, inverted/zero tiers, double-resolve, **forced `emit_transfer` exception → `PAYOUT_FAILED` + pool rollback → retry succeeds**.

---

## Deploy on studionet

The operator deploys by hand in Studio Run & Debug. See [`scripts/deploy/studionet.md`](scripts/deploy/studionet.md). After `Result: SUCCESS`, set `VITE_CONTRACT_ADDRESS`, rebuild, then (handoff) push GitHub + Vercel.

Do not change the network to testnet or any other chain.
