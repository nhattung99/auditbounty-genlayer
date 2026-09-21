export const STUDIO_RPC = 'https://studio.genlayer.com/api';
export const VIEW_FROM = '0x0000000000000000000000000000000000000001';

export function studioRpcUrl(origin) {
  if (!origin || typeof origin !== 'string') return STUDIO_RPC;
  return `${origin.replace(/\/$/, '')}/api/genlayer`;
}

export function formatWalletError(err, fallback = 'Wallet request failed') {
  const raw = `${err?.shortMessage || ''} ${err?.details || ''} ${err?.message || ''}`.toLowerCase();
  if (raw.includes('user rejected') || raw.includes('user denied') || raw.includes('user cancel')) {
    return 'MetaMask cancelled the request. Switch to Genlayer Studio Network, then click Confirm — do not Reject.';
  }
  if (raw.includes('no address provided') || raw.includes('no account')) {
    return 'Connect a wallet first, then try again.';
  }
  if (raw.includes('unrecognized chain') || raw.includes('chain disconnected') || raw.includes('4902')) {
    return 'Approve adding Genlayer Studio Network in MetaMask, then retry the transaction.';
  }
  if (raw.includes('operator cannot') || raw.includes('own bounty program')) {
    return 'Program operators cannot submit reports against their own bounty. Switch to a hunter wallet.';
  }
  if (raw.includes('different hosts') || raw.includes('must not match') || raw.includes('independent websites')) {
    return 'Reference URLs must be on different hosts from each other and from every PoC URL.';
  }
  if (raw.includes('genvm error') || raw.includes('no new report appeared')) {
    return err?.message || fallback;
  }
  return err?.shortMessage || err?.message || fallback;
}

export function urlHost(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    let host = (u.hostname || '').toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    return host;
  } catch {
    return '';
  }
}

export function assertIndependentHosts(pocUrls, refUrls) {
  const pocs = (pocUrls || []).map((u) => String(u || '').trim()).filter(Boolean);
  const refs = (refUrls || []).map((u) => String(u || '').trim()).filter(Boolean);
  if (pocs.length < 1) throw new Error('Paste at least 1 proof-of-concept URL.');
  if (refs.length < 2) throw new Error('Paste at least 2 independent reference URLs.');

  const pocHosts = pocs.map(urlHost);
  const refHosts = refs.map(urlHost);
  if (pocHosts.some((h) => !h) || refHosts.some((h) => !h)) {
    throw new Error('Every URL must be a valid http(s) link with a hostname.');
  }
  if (new Set(refHosts).size < 2) {
    throw new Error('Reference URLs must be on different websites (different hosts).');
  }
  for (const h of refHosts) {
    if (pocHosts.includes(h)) {
      throw new Error(`Reference host must not match a PoC host: ${h}`);
    }
  }
}

export function sameAddress(a, b) {
  if (!a || !b) return false;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

export function resolveReadAccount(account) {
  if (typeof account === 'string' && /^0x[0-9a-fA-F]{40}$/.test(account)) {
    return { address: account };
  }
  if (account && typeof account === 'object' && typeof account.address === 'string') {
    return { address: account.address };
  }
  return { address: VIEW_FROM };
}

export function unwrapViewResult(res) {
  if (res === null || res === undefined) return res;
  if (typeof res === 'bigint') return Number(res);
  if (typeof res === 'number' || typeof res === 'boolean') return res;
  if (res instanceof Uint8Array) {
    return unwrapViewResult(new TextDecoder().decode(res));
  }
  if (res instanceof Map) {
    return unwrapViewResult(Object.fromEntries(res));
  }
  if (typeof res === 'object') {
    if (Array.isArray(res)) return res.map((item) => unwrapViewResult(item));
    if ('result' in res) return unwrapViewResult(res.result);
    if ('data' in res && (typeof res.data === 'string' || Array.isArray(res.data))) {
      return unwrapViewResult(res.data);
    }
    return res;
  }
  if (typeof res !== 'string') return res;

  const trimmed = res.trim();
  if (/^0x[0-9a-fA-F]+$/.test(trimmed) && trimmed.length > 4 && trimmed.length % 2 === 0) {
    try {
      const hex = trimmed.slice(2);
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      }
      const text = new TextDecoder().decode(bytes).trim();
      if (text.startsWith('[') || text.startsWith('{') || /^\d+$/.test(text)) {
        return unwrapViewResult(text);
      }
    } catch {
      // keep original string
    }
  }
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    try {
      return unwrapViewResult(JSON.parse(trimmed));
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

export function normalizeProgramRow(row, fallbackId) {
  if (row === null || row === undefined) return null;
  const unwrapped = unwrapViewResult(row);
  if (!unwrapped || typeof unwrapped !== 'object' || Array.isArray(unwrapped)) return null;
  const id = unwrapped.program_id ?? unwrapped.id ?? fallbackId;
  if (id === null || id === undefined || id === '') return null;
  return { ...unwrapped, program_id: String(id) };
}

export function normalizeReportRow(row, fallbackId) {
  if (row === null || row === undefined) return null;
  const unwrapped = unwrapViewResult(row);
  if (!unwrapped || typeof unwrapped !== 'object' || Array.isArray(unwrapped)) return null;
  const id = unwrapped.report_id ?? unwrapped.id ?? fallbackId;
  if (id === null || id === undefined || id === '') return null;
  return { ...unwrapped, report_id: String(id) };
}

export function normalizeProgramList(raw) {
  const unwrapped = unwrapViewResult(raw);
  if (Array.isArray(unwrapped)) {
    return unwrapped
      .map((row, index) => normalizeProgramRow(row, String(index)))
      .filter(Boolean);
  }
  if (unwrapped && typeof unwrapped === 'object' && Array.isArray(unwrapped.programs)) {
    return normalizeProgramList(unwrapped.programs);
  }
  const single = normalizeProgramRow(unwrapped);
  return single ? [single] : [];
}

export function normalizeReportList(raw) {
  const unwrapped = unwrapViewResult(raw);
  if (Array.isArray(unwrapped)) {
    return unwrapped
      .map((row, index) => normalizeReportRow(row, String(index)))
      .filter(Boolean);
  }
  if (unwrapped && typeof unwrapped === 'object' && Array.isArray(unwrapped.reports)) {
    return normalizeReportList(unwrapped.reports);
  }
  const single = normalizeReportRow(unwrapped);
  return single ? [single] : [];
}

export function parseCount(raw) {
  const unwrapped = unwrapViewResult(raw);
  if (typeof unwrapped === 'number' && Number.isFinite(unwrapped)) return unwrapped;
  if (typeof unwrapped === 'string' && /^\d+$/.test(unwrapped)) return Number(unwrapped);
  if (unwrapped && typeof unwrapped === 'object' && unwrapped.count != null) {
    return parseCount(unwrapped.count);
  }
  return null;
}

export function extractCreatedId(writeResult) {
  const unwrapped = unwrapViewResult(writeResult);
  if (unwrapped == null) return null;
  if (typeof unwrapped === 'number' && Number.isInteger(unwrapped) && unwrapped >= 0) {
    return String(unwrapped);
  }
  if (typeof unwrapped === 'string') {
    const trimmed = unwrapped.trim();
    if (/^\d+$/.test(trimmed)) return trimmed;
    return null;
  }
  if (typeof unwrapped === 'object') {
    const id = unwrapped.program_id ?? unwrapped.report_id ?? unwrapped.id;
    if (id != null && /^\d+$/.test(String(id))) return String(id);
  }
  return null;
}

export function shouldKeepPolling({ previousCount = 0, currentCount, rows } = {}) {
  const listed = Array.isArray(rows) ? rows.length : 0;
  if (listed > previousCount) return false;
  if (typeof currentCount === 'number' && currentCount > previousCount && listed > 0) return false;
  return true;
}

export async function pollUntilListed({
  load,
  previousCount = 0,
  attempts = 12,
  intervalMs = 2000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  let last = { rows: [], count: previousCount };
  for (let i = 0; i < attempts; i += 1) {
    last = await load();
    if (!shouldKeepPolling({ previousCount, currentCount: last.count, rows: last.rows })) {
      return last;
    }
    if (i < attempts - 1) await sleep(intervalMs);
  }
  return last;
}
