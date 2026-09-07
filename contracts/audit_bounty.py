# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from dataclasses import dataclass
import json

UserError = gl.vm.UserError

VALID_VERDICTS = ("CRITICAL", "HIGH", "MEDIUM", "LOW", "INVALID")
MIN_CONFIDENCE = 60


def _addr_str(a) -> str:
    try:
        return a.as_hex.lower()
    except Exception:
        s = str(a).lower()
        if not s.startswith("0x") and len(s) == 40:
            return "0x" + s
        return s


def _to_address(val) -> Address:
    if isinstance(val, Address):
        return val
    if isinstance(val, str):
        val_str = val.strip()
        if not val_str.startswith("0x"):
            val_str = "0x" + val_str
        return Address(val_str)
    if hasattr(val, "as_hex"):
        return val
    return Address(val)


def _same_addr(a, b) -> bool:
    return _addr_str(a) == _addr_str(b)


def _urls_to_list(urls) -> list:
    out = []
    try:
        n = len(urls)
    except Exception:
        return out
    for i in range(n):
        out.append(str(urls[i]))
    return out


def _clean_http_urls(urls, kind: str, minimum: int) -> list:
    cleaned = []
    for u in urls:
        url = str(u).strip()
        if not url:
            continue
        if not (url.startswith("http://") or url.startswith("https://")):
            raise UserError("Invalid " + kind + " URL: must start with http:// or https://")
        cleaned.append(url)
    if len(cleaned) < minimum:
        raise UserError("At least " + str(minimum) + " " + kind + " URL(s) required")
    return cleaned


def _criteria_to_list(criteria) -> list:
    out = []
    try:
        n = len(criteria)
    except Exception:
        return out
    for i in range(n):
        text = str(criteria[i]).strip()
        if text:
            out.append(text)
    return out


def _leader_payload(leader_res):
    if hasattr(leader_res, "value") and isinstance(leader_res.value, dict):
        return leader_res.value
    if hasattr(leader_res, "calldata") and isinstance(leader_res.calldata, dict):
        return leader_res.calldata
    if isinstance(leader_res, dict):
        return leader_res
    return None


def _extract_result(result) -> dict:
    payload = _leader_payload(result)
    if payload is None:
        raise UserError("Invalid nondet consensus result")
    return payload


def _parse_verdict(raw) -> dict:
    if isinstance(raw, dict):
        data = raw
    else:
        cleaned = str(raw).strip()
        if cleaned.startswith("```"):
            lines = cleaned.splitlines()
            if len(lines) >= 2 and lines[0].startswith("```"):
                lines = lines[1:]
            if len(lines) >= 1 and lines[-1].startswith("```"):
                lines = lines[:-1]
            cleaned = "\n".join(lines).strip()
        try:
            data = json.loads(cleaned)
        except Exception as e:
            return {
                "verdict": "INVALID",
                "confidence": 0,
                "reason": "Failed to parse LLM response. Error: " + str(e),
            }

    if not isinstance(data, dict):
        return {
            "verdict": "INVALID",
            "confidence": 0,
            "reason": "AI verdict response must be a JSON object",
        }

    verdict = str(data.get("verdict", "")).strip().upper()
    if verdict not in VALID_VERDICTS:
        return {
            "verdict": "INVALID",
            "confidence": 0,
            "reason": "verdict must be one of CRITICAL, HIGH, MEDIUM, LOW, INVALID — got: " + verdict,
        }

    try:
        conf = int(data.get("confidence", 0))
    except Exception:
        conf = 0
    if conf < 0 or conf > 100:
        conf = 0

    return {
        "verdict": verdict,
        "confidence": conf,
        "reason": str(data.get("reason", "")),
    }


def _tier_payout(program, verdict: str) -> "bigint":
    if verdict == "CRITICAL":
        return program.critical_payout
    if verdict == "HIGH":
        return program.high_payout
    if verdict == "MEDIUM":
        return program.medium_payout
    if verdict == "LOW":
        return program.low_payout
    return bigint(0)


def _fetch_url(url: str, kind: str) -> str:
    try:
        res = gl.nondet.web.render(url, mode="text")
        body = res.body if hasattr(res, "body") else res
        return "[" + url + "]: " + str(body)
    except Exception as e:
        raise UserError("Failed to fetch " + kind + " URL: " + url + " (" + str(e) + ")")


@allow_storage
@dataclass
class BountyProgram:
    operator: Address
    project_name: str
    scope_description: str
    severity_criteria: DynArray[str]
    critical_payout: bigint
    high_payout: bigint
    medium_payout: bigint
    low_payout: bigint
    pool_balance: bigint
    active: bool


@allow_storage
@dataclass
class Report:
    program_id: str
    hunter: Address
    title: str
    poc_urls: DynArray[str]
    reference_urls: DynArray[str]
    status: str
    verdict: str
    verdict_reason: str
    confidence: u256
    payout_amount: bigint
    settled: bool


class Contract(gl.Contract):
    owner: Address
    program_counter: bigint
    report_counter: bigint
    programs: TreeMap[str, BountyProgram]
    reports: TreeMap[str, Report]

    def __init__(self):
        self.owner = _to_address(gl.message.sender_address)
        self.program_counter = bigint(0)
        self.report_counter = bigint(0)

    @gl.public.write.payable
    def create_bounty_program(
        self,
        project_name: str,
        scope_description: str,
        severity_criteria: DynArray[str],
        critical_payout: bigint,
        high_payout: bigint,
        medium_payout: bigint,
        low_payout: bigint,
    ) -> str:
        initial_fund = bigint(gl.message.value)
        if initial_fund <= bigint(0):
            raise UserError("Must send GEN to fund the bounty pool (amount must be > 0)")
        if not project_name or len(project_name.strip()) == 0:
            raise UserError("Project name cannot be empty")
        if not scope_description or len(scope_description.strip()) == 0:
            raise UserError("Scope description cannot be empty")

        cleaned_criteria = _criteria_to_list(severity_criteria)
        if len(cleaned_criteria) == 0:
            raise UserError("Must define at least one severity criterion")

        if (
            critical_payout <= bigint(0)
            or high_payout <= bigint(0)
            or medium_payout <= bigint(0)
            or low_payout <= bigint(0)
        ):
            raise UserError("All tier payouts must be greater than 0")
        if not (critical_payout >= high_payout >= medium_payout >= low_payout):
            raise UserError("Payout tiers must be in descending order: critical >= high >= medium >= low")

        program_id = str(self.program_counter)
        self.program_counter = self.program_counter + bigint(1)

        self.programs[program_id] = BountyProgram(
            operator=_to_address(gl.message.sender_address),
            project_name=project_name.strip(),
            scope_description=scope_description.strip(),
            severity_criteria=cleaned_criteria,
            critical_payout=critical_payout,
            high_payout=high_payout,
            medium_payout=medium_payout,
            low_payout=low_payout,
            pool_balance=initial_fund,
            active=True,
        )
        return program_id

    @gl.public.write.payable
    def fund_program(self, program_id: str) -> None:
        if program_id not in self.programs:
            raise UserError("Bounty program does not exist")
        amount = bigint(gl.message.value)
        if amount <= bigint(0):
            raise UserError("Must send GEN to fund the pool")
        program = self.programs[program_id]
        program.pool_balance = program.pool_balance + amount
        self.programs[program_id] = program

    @gl.public.write
    def submit_report(
        self,
        program_id: str,
        title: str,
        poc_urls: DynArray[str],
        reference_urls: DynArray[str],
    ) -> str:
        if program_id not in self.programs:
            raise UserError("Bounty program does not exist")
        program = self.programs[program_id]
        if not program.active:
            raise UserError("Bounty program is inactive")
        if not title or len(title.strip()) == 0:
            raise UserError("Title cannot be empty")

        cleaned_poc = _clean_http_urls(poc_urls, "proof-of-concept", 1)
        cleaned_refs = _clean_http_urls(reference_urls, "independent reference", 2)

        report_id = str(self.report_counter)
        self.report_counter = self.report_counter + bigint(1)

        self.reports[report_id] = Report(
            program_id=program_id,
            hunter=_to_address(gl.message.sender_address),
            title=title.strip(),
            poc_urls=cleaned_poc,
            reference_urls=cleaned_refs,
            status="SUBMITTED",
            verdict="",
            verdict_reason="",
            confidence=u256(0),
            payout_amount=bigint(0),
            settled=False,
        )
        return report_id

    @gl.public.write
    def add_evidence(
        self,
        report_id: str,
        poc_urls: DynArray[str],
        reference_urls: DynArray[str],
    ) -> None:
        if report_id not in self.reports:
            raise UserError("Report does not exist")
        report = self.reports[report_id]
        sender = _to_address(gl.message.sender_address)
        if not _same_addr(sender, report.hunter):
            raise UserError("Only the hunter can add evidence")
        if report.status != "DISPUTED":
            raise UserError("Can only add evidence to DISPUTED reports")
        if report.settled:
            raise UserError("Report already settled")

        report.poc_urls = _clean_http_urls(poc_urls, "proof-of-concept", 1)
        report.reference_urls = _clean_http_urls(reference_urls, "independent reference", 2)
        self.reports[report_id] = report

    @gl.public.write
    def resolve_report(self, report_id: str) -> None:
        if report_id not in self.reports:
            raise UserError("Report does not exist")
        report = self.reports[report_id]
        if report.status not in ["SUBMITTED", "DISPUTED"]:
            raise UserError("Report not ready for resolution (status: " + report.status + ")")

        if report.program_id not in self.programs:
            raise UserError("Bounty program does not exist")
        program = self.programs[report.program_id]

        criteria_list = _criteria_to_list(program.severity_criteria)
        poc_urls_list = _urls_to_list(report.poc_urls)
        reference_urls_list = _urls_to_list(report.reference_urls)
        title = report.title
        scope_description = program.scope_description

        def leader_fn() -> dict:
            poc_contents = []
            for url in poc_urls_list:
                poc_contents.append(_fetch_url(url, "PoC"))

            reference_contents = []
            for url in reference_urls_list:
                reference_contents.append(_fetch_url(url, "reference"))

            prompt = "You are a neutral security bug bounty triage adjudicator.\n"
            prompt += "Project scope: \"" + scope_description + "\"\n"
            prompt += "Severity classification criteria: " + str(criteria_list) + "\n"
            prompt += "Report title: \"" + title + "\"\n"
            prompt += "Proof-of-concept evidence submitted by the hunter: " + str(poc_contents) + "\n"
            prompt += "Independent verification sources (prioritize these if they contradict the PoC): " + str(reference_contents) + "\n\n"
            prompt += "Classify this report into exactly ONE of five discrete categories based on the criteria above:\n"
            prompt += "- \"CRITICAL\", \"HIGH\", \"MEDIUM\", \"LOW\": genuine vulnerability at that severity, per the criteria.\n"
            prompt += "- \"INVALID\": not a genuine vulnerability, out of scope, a duplicate, or evidence is insufficient to confirm.\n\n"
            prompt += "Return ONLY raw JSON, no markdown:\n"
            prompt += "{\"verdict\": \"CRITICAL\" | \"HIGH\" | \"MEDIUM\" | \"LOW\" | \"INVALID\", \"confidence\": <0-100>, \"reason\": \"<short justification>\"}"

            raw = gl.nondet.exec_prompt(prompt, response_format="json")
            return _parse_verdict(raw)

        def validator_fn(leader_res) -> bool:
            if not isinstance(leader_res, gl.vm.Return):
                return False

            leader_payload = _leader_payload(leader_res)
            if not isinstance(leader_payload, dict):
                return False

            leader_verdict = str(leader_payload.get("verdict", "")).strip().upper()
            if leader_verdict not in VALID_VERDICTS:
                return False

            try:
                leader_conf = int(leader_payload.get("confidence", -1))
                if not (0 <= leader_conf <= 100):
                    return False
            except Exception:
                return False

            try:
                my_res = leader_fn()
            except Exception:
                return False

            my_verdict = str(my_res.get("verdict", "")).strip().upper()
            try:
                my_conf = int(my_res.get("confidence", -1))
                if not (0 <= my_conf <= 100):
                    return False
            except Exception:
                return False

            # Absolute equality on the 5 discrete verdicts — no % tolerance.
            # Confidence branch must also match (>=60 settle vs DISPUTED).
            if my_verdict != leader_verdict:
                return False
            return (my_conf >= MIN_CONFIDENCE) == (leader_conf >= MIN_CONFIDENCE)

        result = _extract_result(gl.vm.run_nondet(leader_fn, validator_fn))
        result = _parse_verdict(result)

        report.verdict = result["verdict"]
        report.confidence = u256(int(result["confidence"]))
        report.verdict_reason = result["reason"]

        if int(result["confidence"]) < MIN_CONFIDENCE:
            report.status = "DISPUTED"
            self.reports[report_id] = report
            return

        payout = _tier_payout(program, result["verdict"])
        report.payout_amount = payout

        if payout == bigint(0):
            report.status = "RESOLVED"
            report.settled = True
            self.reports[report_id] = report
            return

        if program.pool_balance < payout:
            report.status = "REJECTED_NO_FUNDS"
            self.reports[report_id] = report
            return

        program.pool_balance = program.pool_balance - payout
        self.programs[report.program_id] = program

        try:
            gl.get_contract_at(_to_address(report.hunter)).emit_transfer(value=u256(payout))
            report.settled = True
            report.status = "RESOLVED"
        except Exception as e:
            program.pool_balance = program.pool_balance + payout
            self.programs[report.program_id] = program
            report.settled = False
            report.status = "PAYOUT_FAILED"
            report.verdict_reason = report.verdict_reason + " (Transfer failed: " + str(e) + ")"

        self.reports[report_id] = report

    @gl.public.write
    def retry_resolution(self, report_id: str) -> None:
        if report_id not in self.reports:
            raise UserError("Report does not exist")
        report = self.reports[report_id]
        if report.status not in ["PAYOUT_FAILED", "REJECTED_NO_FUNDS"]:
            raise UserError("Can only retry PAYOUT_FAILED or REJECTED_NO_FUNDS reports")
        if report.settled:
            raise UserError("Report already settled")

        program = self.programs[report.program_id]
        payout = report.payout_amount

        if payout <= bigint(0):
            report.status = "RESOLVED"
            report.settled = True
            self.reports[report_id] = report
            return

        if program.pool_balance < payout:
            report.status = "REJECTED_NO_FUNDS"
            self.reports[report_id] = report
            return

        program.pool_balance = program.pool_balance - payout
        self.programs[report.program_id] = program

        try:
            gl.get_contract_at(_to_address(report.hunter)).emit_transfer(value=u256(payout))
            report.settled = True
            report.status = "RESOLVED"
        except Exception as e:
            program.pool_balance = program.pool_balance + payout
            self.programs[report.program_id] = program
            report.verdict_reason = report.verdict_reason + " (Retry failed again: " + str(e) + ")"
            report.status = "PAYOUT_FAILED"

        self.reports[report_id] = report

    def _program_dict(self, program_id: str, program, full: bool) -> dict:
        row = {
            "program_id": program_id,
            "operator": _addr_str(program.operator),
            "project_name": program.project_name,
            "scope_description": program.scope_description,
            "critical_payout": str(int(program.critical_payout)),
            "high_payout": str(int(program.high_payout)),
            "medium_payout": str(int(program.medium_payout)),
            "low_payout": str(int(program.low_payout)),
            "pool_balance": str(int(program.pool_balance)),
            "active": bool(program.active),
        }
        if full:
            row["severity_criteria"] = _criteria_to_list(program.severity_criteria)
        return row

    def _report_dict(self, report_id: str, report, full: bool) -> dict:
        row = {
            "report_id": report_id,
            "program_id": report.program_id,
            "hunter": _addr_str(report.hunter),
            "title": report.title,
            "status": report.status,
            "verdict": report.verdict,
            "verdict_reason": report.verdict_reason,
            "confidence": int(report.confidence),
            "payout_amount": str(int(report.payout_amount)),
            "settled": bool(report.settled),
        }
        if full:
            row["poc_urls"] = _urls_to_list(report.poc_urls)
            row["reference_urls"] = _urls_to_list(report.reference_urls)
        return row

    @gl.public.view
    def get_program(self, program_id: str) -> str:
        if program_id not in self.programs:
            raise UserError("Bounty program does not exist")
        return json.dumps(self._program_dict(program_id, self.programs[program_id], True))

    @gl.public.view
    def list_programs(self, active_only: bool) -> str:
        results = []
        n = int(self.program_counter)
        for i in range(n):
            pid = str(i)
            if pid in self.programs:
                program = self.programs[pid]
                if (not active_only) or program.active:
                    results.append(self._program_dict(pid, program, False))
        return json.dumps(results)

    @gl.public.view
    def get_report(self, report_id: str) -> str:
        if report_id not in self.reports:
            raise UserError("Report does not exist")
        return json.dumps(self._report_dict(report_id, self.reports[report_id], True))

    @gl.public.view
    def list_reports(self, program_filter: str) -> str:
        results = []
        n = int(self.report_counter)
        for i in range(n):
            rid = str(i)
            if rid in self.reports:
                report = self.reports[rid]
                if program_filter == "" or report.program_id == program_filter:
                    results.append(self._report_dict(rid, report, False))
        return json.dumps(results)

    @gl.public.view
    def get_program_count(self) -> int:
        return int(self.program_counter)

    @gl.public.view
    def get_report_count(self) -> int:
        return int(self.report_counter)

    @gl.public.view
    def get_owner(self) -> str:
        return _addr_str(self.owner)
