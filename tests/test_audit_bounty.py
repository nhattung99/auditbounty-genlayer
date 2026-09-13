import json
import pytest

CONTRACT_PATH = "contracts/audit_bounty.py"

POC = "https://example.com/poc.md"
REF1 = "https://docs.example.com/severity-policy"
REF2 = "https://advisory.example.com/cve-2026-0001"
CRITERIA = [
    "Critical: remote code execution or direct fund loss",
    "High: privilege escalation or unauthorized state change",
    "Medium: significant information disclosure",
    "Low: low-impact misconfiguration",
]

# Fixed payouts in wei-like base units (integers only — no % math).
CRITICAL = 1000
HIGH = 500
MEDIUM = 200
LOW = 100
POOL = 5000


def _set_value(vm, amount):
    if hasattr(vm, "value"):
        try:
            vm.value = amount
        except Exception:
            pass
    if hasattr(vm, "_value"):
        vm._value = amount
    if hasattr(vm, "_refresh_gl_message"):
        vm._refresh_gl_message()


def _clear_value(vm):
    _set_value(vm, 0)


def _active_vm(direct_vm):
    try:
        from gltest.direct.loader import _get_active_vm
        return _get_active_vm() or direct_vm
    except Exception:
        return direct_vm


def sim_installMocks(vm, web=None, llm=None):
    """Install nondet mocks before every AI tx. Prefer sim_installMocks if present."""
    web = web or {}
    llm_payload = llm if isinstance(llm, str) or llm is None else json.dumps(llm)

    if hasattr(vm, "sim_installMocks"):
        vm.sim_installMocks({"web": web, "llm": llm_payload})
        return
    if hasattr(vm, "sim_install_mocks"):
        vm.sim_install_mocks({"web": web, "llm": llm_payload})
        return

    if hasattr(vm, "clear_mocks"):
        try:
            vm.clear_mocks()
        except Exception:
            pass
    for url, body in web.items():
        # gltest's VMContext.mock_web expects a dict-like MockedWebResponseData
        # ({"status": ..., "body": ...}), not a bare string. Wrap plain text
        # bodies so this helper stays compatible across gltest releases.
        payload = body if isinstance(body, dict) else {"status": 200, "body": body}
        vm.mock_web(url, payload)
    if llm_payload is not None:
        vm.mock_llm(".*", llm_payload)


def _create_program(
    contract,
    vm,
    operator,
    project_name="VaultX",
    scope="Smart contracts in github.com/example/vaultx",
    criteria=None,
    critical=CRITICAL,
    high=HIGH,
    medium=MEDIUM,
    low=LOW,
    fund=POOL,
):
    vm.sender = operator
    _set_value(vm, fund)
    program_id = contract.create_bounty_program(
        project_name,
        scope,
        criteria or CRITERIA,
        critical,
        high,
        medium,
        low,
    )
    _clear_value(vm)
    return program_id


def _submit(contract, vm, hunter, program_id, title="Reentrancy in withdraw", poc=None, refs=None):
    vm.sender = hunter
    return contract.submit_report(
        program_id,
        title,
        poc or [POC],
        refs or [REF1, REF2],
    )


def _parse(raw):
    if isinstance(raw, str):
        return json.loads(raw or "{}")
    return raw or {}


def _parse_list(raw):
    if isinstance(raw, str):
        return json.loads(raw or "[]")
    return raw or []


def _program(contract, program_id):
    return _parse(contract.get_program(program_id))


def _report(contract, report_id):
    return _parse(contract.get_report(report_id))


def _default_web():
    return {
        POC: "Proof of concept: attacker drains vault via reentrancy on withdraw()",
        REF1: "Project severity policy: Critical = direct fund loss / remote code execution",
        REF2: "Independent advisory confirms unauthorized withdrawal of all funds",
    }


def _resolve(contract, vm, report_id, verdict, confidence=90, reason="Matches published criteria", web=None):
    sim_installMocks(
        vm,
        web=web or _default_web(),
        llm={"verdict": verdict, "confidence": confidence, "reason": reason},
    )
    contract.resolve_report(report_id)


def test_happy_path_critical(direct_vm, direct_deploy, direct_accounts):
    operator = direct_accounts[1]
    hunter = direct_accounts[2]
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)

    program_id = _create_program(contract, vm, operator)
    assert program_id == "0"
    assert _program(contract, program_id)["pool_balance"] == str(POOL)

    report_id = _submit(contract, vm, hunter, program_id)
    assert _report(contract, report_id)["status"] == "SUBMITTED"

    vm.sender = operator
    _resolve(contract, vm, report_id, "CRITICAL", 95, "Direct fund loss via reentrancy")

    row = _report(contract, report_id)
    assert row["status"] == "RESOLVED"
    assert row["verdict"] == "CRITICAL"
    assert row["payout_amount"] == str(CRITICAL)
    assert row["settled"] is True
    assert _program(contract, program_id)["pool_balance"] == str(POOL - CRITICAL)


def test_happy_path_high(direct_vm, direct_deploy, direct_accounts):
    operator = direct_accounts[1]
    hunter = direct_accounts[2]
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)

    program_id = _create_program(contract, vm, operator)
    report_id = _submit(contract, vm, hunter, program_id, title="Admin role takeover")
    vm.sender = operator
    _resolve(contract, vm, report_id, "HIGH", 88, "Privilege escalation confirmed")

    row = _report(contract, report_id)
    assert row["status"] == "RESOLVED"
    assert row["verdict"] == "HIGH"
    assert row["payout_amount"] == str(HIGH)
    assert row["settled"] is True
    assert _program(contract, program_id)["pool_balance"] == str(POOL - HIGH)


def test_happy_path_medium(direct_vm, direct_deploy, direct_accounts):
    operator = direct_accounts[1]
    hunter = direct_accounts[2]
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)

    program_id = _create_program(contract, vm, operator)
    report_id = _submit(contract, vm, hunter, program_id, title="Event log leaks private notes")
    vm.sender = operator
    _resolve(contract, vm, report_id, "MEDIUM", 80, "Significant information disclosure")

    row = _report(contract, report_id)
    assert row["verdict"] == "MEDIUM"
    assert row["payout_amount"] == str(MEDIUM)
    assert row["settled"] is True
    assert _program(contract, program_id)["pool_balance"] == str(POOL - MEDIUM)


def test_happy_path_low(direct_vm, direct_deploy, direct_accounts):
    operator = direct_accounts[1]
    hunter = direct_accounts[2]
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)

    program_id = _create_program(contract, vm, operator)
    report_id = _submit(contract, vm, hunter, program_id, title="Missing event on admin update")
    vm.sender = operator
    _resolve(contract, vm, report_id, "LOW", 72, "Low-impact misconfiguration")

    row = _report(contract, report_id)
    assert row["verdict"] == "LOW"
    assert row["payout_amount"] == str(LOW)
    assert row["settled"] is True
    assert _program(contract, program_id)["pool_balance"] == str(POOL - LOW)


def test_happy_path_invalid_no_payout(direct_vm, direct_deploy, direct_accounts):
    operator = direct_accounts[1]
    hunter = direct_accounts[2]
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)

    program_id = _create_program(contract, vm, operator)
    report_id = _submit(contract, vm, hunter, program_id, title="Typo in comment")
    vm.sender = operator
    _resolve(
        contract,
        vm,
        report_id,
        "INVALID",
        93,
        "Not a genuine vulnerability",
        web={
            POC: "Comment typo only",
            REF1: "Severity policy does not cover comments",
            REF2: "No CVE or advisory exists",
        },
    )

    row = _report(contract, report_id)
    assert row["status"] == "RESOLVED"
    assert row["verdict"] == "INVALID"
    assert row["payout_amount"] == "0"
    assert row["settled"] is True
    assert _program(contract, program_id)["pool_balance"] == str(POOL)


def test_rejected_no_funds_then_fund_and_retry(direct_vm, direct_deploy, direct_accounts):
    operator = direct_accounts[1]
    hunter = direct_accounts[2]
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)

    program_id = _create_program(contract, vm, operator, fund=50)
    report_id = _submit(contract, vm, hunter, program_id)
    vm.sender = operator
    _resolve(contract, vm, report_id, "CRITICAL", 91, "Direct fund loss")

    row = _report(contract, report_id)
    assert row["status"] == "REJECTED_NO_FUNDS"
    assert row["settled"] is False
    assert row["payout_amount"] == str(CRITICAL)
    assert row["verdict"] == "CRITICAL"
    assert _program(contract, program_id)["pool_balance"] == "50"

    vm.sender = operator
    _set_value(vm, CRITICAL)
    contract.fund_program(program_id)
    _clear_value(vm)
    assert _program(contract, program_id)["pool_balance"] == str(50 + CRITICAL)

    vm.sender = hunter
    contract.retry_resolution(report_id)

    row = _report(contract, report_id)
    assert row["status"] == "RESOLVED"
    assert row["settled"] is True
    assert row["payout_amount"] == str(CRITICAL)
    assert _program(contract, program_id)["pool_balance"] == "50"


def test_low_confidence_disputed_then_add_evidence(direct_vm, direct_deploy, direct_accounts):
    operator = direct_accounts[1]
    hunter = direct_accounts[2]
    other = direct_accounts[3]
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)

    program_id = _create_program(contract, vm, operator)
    report_id = _submit(contract, vm, hunter, program_id)
    vm.sender = operator
    _resolve(contract, vm, report_id, "HIGH", 41, "Evidence is insufficient")

    row = _report(contract, report_id)
    assert row["status"] == "DISPUTED"
    assert row["settled"] is False
    assert row["confidence"] == 41
    assert _program(contract, program_id)["pool_balance"] == str(POOL)

    extra_poc = "https://example.com/clear-poc.md"
    extra_r1 = "https://docs.example.com/severity-policy#high"
    extra_r2 = "https://researcher.example.com/confirm"
    vm.sender = other
    with pytest.raises(Exception):
        contract.add_evidence(report_id, [extra_poc], [extra_r1, extra_r2])

    vm.sender = hunter
    contract.add_evidence(report_id, [extra_poc], [extra_r1, extra_r2])
    assert _report(contract, report_id)["status"] == "DISPUTED"

    vm.sender = operator
    sim_installMocks(
        vm,
        web={
            extra_poc: "Clear exploit demonstrating privilege escalation",
            extra_r1: "Policy: High = privilege escalation",
            extra_r2: "Independent researcher confirms the issue",
        },
        llm={"verdict": "HIGH", "confidence": 91, "reason": "Updated independent sources confirm High"},
    )
    contract.resolve_report(report_id)

    row = _report(contract, report_id)
    assert row["status"] == "RESOLVED"
    assert row["verdict"] == "HIGH"
    assert row["payout_amount"] == str(HIGH)
    assert row["settled"] is True


def test_web_fail_and_invalid_json(direct_vm, direct_deploy, direct_accounts):
    operator = direct_accounts[1]
    hunter = direct_accounts[2]
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)

    program_id = _create_program(contract, vm, operator)
    report_id = _submit(contract, vm, hunter, program_id)

    sim_installMocks(
        vm,
        web={
            POC: "some poc page",
            REF1: "ref one",
            REF2: "ref two",
        },
        llm="this is not json at all",
    )
    vm.sender = operator
    contract.resolve_report(report_id)
    row = _report(contract, report_id)
    assert row["status"] == "DISPUTED"
    assert row["settled"] is False
    assert row["confidence"] == 0

    report_id_2 = _submit(contract, vm, hunter, program_id, title="Second report")
    sim_installMocks(vm, web={}, llm={"verdict": "HIGH", "confidence": 90, "reason": "unreachable"})
    vm.sender = operator
    with pytest.raises(Exception):
        contract.resolve_report(report_id_2)
    assert _report(contract, report_id_2)["status"] == "SUBMITTED"


def test_missing_poc_and_reference_urls(direct_vm, direct_deploy, direct_accounts):
    operator = direct_accounts[1]
    hunter = direct_accounts[2]
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)

    program_id = _create_program(contract, vm, operator)
    vm.sender = hunter
    with pytest.raises(Exception):
        contract.submit_report(program_id, "Missing refs", [POC], [REF1])
    with pytest.raises(Exception):
        contract.submit_report(program_id, "Missing poc", [], [REF1, REF2])
    with pytest.raises(Exception):
        contract.submit_report(program_id, "Bad url", ["ftp://not-http"], [REF1, REF2])
    assert contract.get_report_count() == 0


def test_payout_tiers_must_be_descending(direct_vm, direct_deploy, direct_accounts):
    operator = direct_accounts[1]
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)

    vm.sender = operator
    _set_value(vm, POOL)
    with pytest.raises(Exception):
        contract.create_bounty_program("BadTiers", "scope", CRITERIA, 100, 200, 50, 10)
    _clear_value(vm)

    vm.sender = operator
    _set_value(vm, POOL)
    with pytest.raises(Exception):
        contract.create_bounty_program("ZeroTier", "scope", CRITERIA, 100, 50, 20, 0)
    _clear_value(vm)

    vm.sender = operator
    _set_value(vm, 0)
    with pytest.raises(Exception):
        contract.create_bounty_program("NoFund", "scope", CRITERIA, CRITICAL, HIGH, MEDIUM, LOW)
    _clear_value(vm)

    assert contract.get_program_count() == 0


def test_empty_name_and_empty_criteria_blocked(direct_vm, direct_deploy, direct_accounts):
    operator = direct_accounts[1]
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)

    vm.sender = operator
    _set_value(vm, POOL)
    with pytest.raises(Exception):
        contract.create_bounty_program("   ", "scope", CRITERIA, CRITICAL, HIGH, MEDIUM, LOW)
    _clear_value(vm)

    vm.sender = operator
    _set_value(vm, POOL)
    with pytest.raises(Exception):
        contract.create_bounty_program("Named", "scope", [], CRITICAL, HIGH, MEDIUM, LOW)
    _clear_value(vm)


def test_double_resolve_blocked(direct_vm, direct_deploy, direct_accounts):
    operator = direct_accounts[1]
    hunter = direct_accounts[2]
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)

    program_id = _create_program(contract, vm, operator)
    report_id = _submit(contract, vm, hunter, program_id)
    vm.sender = operator
    _resolve(contract, vm, report_id, "LOW", 80, "Low impact")
    assert _report(contract, report_id)["settled"] is True

    with pytest.raises(Exception):
        contract.resolve_report(report_id)


def test_transfer_failure_rolls_back_then_retry(direct_vm, direct_deploy, direct_accounts, monkeypatch):
    operator = direct_accounts[1]
    hunter = direct_accounts[2]
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)

    program_id = _create_program(contract, vm, operator)
    report_id = _submit(contract, vm, hunter, program_id)

    # genlayer-test 0.29.2 still routes hunter EOA payouts through
    # gltest.direct.loader._EOAProxy.emit_transfer. That path updates
    # balances in-process and never hits vm._gl_call_hook / PostMessage.
    import gltest.direct.loader

    def failing_emit_transfer(self, value=None, **kwargs):
        raise Exception("Simulated native transfer execution failure")

    monkeypatch.setattr(gltest.direct.loader._EOAProxy, "emit_transfer", failing_emit_transfer)

    vm.sender = operator
    _resolve(contract, vm, report_id, "MEDIUM", 97, "Confirmed medium")

    row = _report(contract, report_id)
    assert row["status"] == "PAYOUT_FAILED"
    assert row["settled"] is False
    assert row["verdict"] == "MEDIUM"
    assert row["payout_amount"] == str(MEDIUM)
    assert "Transfer failed" in row["verdict_reason"]
    assert _program(contract, program_id)["pool_balance"] == str(POOL)

    monkeypatch.undo()
    vm.sender = hunter
    contract.retry_resolution(report_id)

    row = _report(contract, report_id)
    assert row["status"] == "RESOLVED"
    assert row["settled"] is True
    assert row["verdict"] == "MEDIUM"
    assert row["payout_amount"] == str(MEDIUM)
    assert _program(contract, program_id)["pool_balance"] == str(POOL - MEDIUM)


def test_operator_cannot_self_report(direct_vm, direct_deploy, direct_accounts):
    operator = direct_accounts[1]
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)

    program_id = _create_program(contract, vm, operator)

    # Security fix: a program operator must not be able to submit a report
    # against their own bounty program (self-dealing / fabricated-evidence
    # payout drain vector).
    vm.sender = operator
    with pytest.raises(Exception):
        contract.submit_report(program_id, "Self dealt", [POC], [REF1, REF2])

    assert contract.get_report_count() == 0


def test_settling_lock_blocks_reentrant_resolve(direct_vm, direct_deploy, direct_accounts, monkeypatch):
    operator = direct_accounts[1]
    hunter = direct_accounts[2]
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)

    program_id = _create_program(contract, vm, operator)
    report_id = _submit(contract, vm, hunter, program_id)

    reentered = {"attempted": False, "raised": None}

    # Security fix: resolve_report writes status="SETTLING" to storage
    # BEFORE emit_transfer. Drive the reentrant call from _EOAProxy.emit_transfer
    # (the path this gltest release actually uses for hunter payouts).
    import gltest.direct.loader

    original_emit = gltest.direct.loader._EOAProxy.emit_transfer

    def reentrant_emit_transfer(self, value=None, **kwargs):
        if not reentered["attempted"]:
            reentered["attempted"] = True
            try:
                contract.resolve_report(report_id)
            except Exception as exc:
                reentered["raised"] = exc
        return original_emit(self, value, **kwargs)

    monkeypatch.setattr(gltest.direct.loader._EOAProxy, "emit_transfer", reentrant_emit_transfer)

    vm.sender = operator
    _resolve(contract, vm, report_id, "HIGH", 92, "Confirmed high")
    monkeypatch.undo()

    # The reentrant call must have been attempted and must have been
    # rejected by the SETTLING guard, not silently ignored.
    assert reentered["attempted"] is True
    assert reentered["raised"] is not None

    row = _report(contract, report_id)
    assert row["status"] == "RESOLVED"
    assert row["settled"] is True
    # Pool must be debited exactly once for this report, not twice.
    assert _program(contract, program_id)["pool_balance"] == str(POOL - HIGH)


def test_retry_blocked_when_not_failed(direct_vm, direct_deploy, direct_accounts):
    operator = direct_accounts[1]
    hunter = direct_accounts[2]
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)

    program_id = _create_program(contract, vm, operator)
    report_id = _submit(contract, vm, hunter, program_id)
    vm.sender = hunter
    with pytest.raises(Exception):
        contract.retry_resolution(report_id)


def test_inactive_program_blocks_submit(direct_vm, direct_deploy, direct_accounts):
    operator = direct_accounts[1]
    hunter = direct_accounts[2]
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)

    program_id = _create_program(contract, vm, operator)
    program = contract.programs[program_id]
    program.active = False
    contract.programs[program_id] = program

    vm.sender = hunter
    with pytest.raises(Exception):
        contract.submit_report(program_id, "Too late", [POC], [REF1, REF2])


def test_list_and_counts(direct_vm, direct_deploy, direct_accounts):
    operator = direct_accounts[1]
    hunter = direct_accounts[2]
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)

    p0 = _create_program(contract, vm, operator, project_name="One")
    p1 = _create_program(contract, vm, operator, project_name="Two")
    _submit(contract, vm, hunter, p0, title="A")
    _submit(contract, vm, hunter, p1, title="B")

    assert contract.get_program_count() == 2
    assert contract.get_report_count() == 2
    programs = _parse_list(contract.list_programs(True))
    assert len(programs) == 2
    reports = _parse_list(contract.list_reports(""))
    assert len(reports) == 2
    only_p0 = _parse_list(contract.list_reports(p0))
    assert len(only_p0) == 1
    assert only_p0[0]["title"] == "A"
