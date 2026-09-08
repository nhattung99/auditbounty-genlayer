import React, { useCallback, useEffect, useState } from 'react';
import {
  Bug,
  Wallet,
  PlusCircle,
  List,
  RefreshCw,
  ClipboardPaste,
  Scale,
  RotateCcw,
  Plus,
  Trash2,
  FileWarning,
} from 'lucide-react';
import {
  CONTRACT_ADDRESS,
  hasContractAddress,
  getWriteClient,
  getListClient,
  loadPrograms,
  loadReports,
  readView,
  waitForTx,
  ensureStudioNetwork,
  formatWalletError,
  parseGenToWei,
  formatWeiToGen,
  sanitizeGenInput,
} from './genlayerClient.js';
import {
  extractCreatedId,
  pollUntilListed,
  sameAddress,
  resolveReadAccount,
} from './bountyPoll.js';
import { tiersAreDescending } from './money.js';
import {
  CATEGORIES,
  PAYOUT_PRESETS,
  FUND_PRESETS,
} from './data/categories.js';

const shortAddr = (a) => {
  if (!a) return '—';
  const s = String(a);
  if (s.length < 12) return s;
  return `${s.slice(0, 6)}...${s.slice(-4)}`;
};

const pasteClipboard = async () => {
  const text = await navigator.clipboard.readText();
  return (text || '').trim();
};

const verdictClass = (verdict) => {
  const v = String(verdict || '').toUpperCase();
  if (v === 'CRITICAL') return 'verdict-critical';
  if (v === 'HIGH') return 'verdict-high';
  if (v === 'MEDIUM') return 'verdict-medium';
  if (v === 'LOW') return 'verdict-low';
  if (v === 'INVALID') return 'verdict-invalid';
  return '';
};

const statusClass = (status) => `badge badge-${String(status || '').toLowerCase()}`;

export default function App() {
  const [account, setAccount] = useState(null);
  const [tab, setTab] = useState('programs');
  const [programs, setPrograms] = useState([]);
  const [reports, setReports] = useState([]);
  const [details, setDetails] = useState({});
  const [loading, setLoading] = useState(false);
  const [resolvingId, setResolvingId] = useState(null);
  const [txHash, setTxHash] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  const [categoryId, setCategoryId] = useState(CATEGORIES[0].id);
  const [projectName, setProjectName] = useState('');
  const [scope, setScope] = useState(CATEGORIES[0].scope);
  const [criteria, setCriteria] = useState(CATEGORIES[0].criteria.join('\n'));
  const [criticalStr, setCriticalStr] = useState('10');
  const [highStr, setHighStr] = useState('5');
  const [mediumStr, setMediumStr] = useState('2');
  const [lowStr, setLowStr] = useState('1');
  const [fundStr, setFundStr] = useState('20');

  const [submitProgramId, setSubmitProgramId] = useState('');
  const [reportTitle, setReportTitle] = useState('');
  const [pocUrls, setPocUrls] = useState(['']);
  const [refUrls, setRefUrls] = useState(['', '']);
  const [activeReportId, setActiveReportId] = useState(null);
  const [fundDrafts, setFundDrafts] = useState({});

  const category = CATEGORIES.find((c) => c.id === categoryId) || CATEGORIES[0];

  const criticalWei = parseGenToWei(criticalStr);
  const highWei = parseGenToWei(highStr);
  const mediumWei = parseGenToWei(mediumStr);
  const lowWei = parseGenToWei(lowStr);
  const fundWei = parseGenToWei(fundStr);
  const tiersOk = tiersAreDescending(criticalWei, highWei, mediumWei, lowWei);

  const applyCategory = (id) => {
    const next = CATEGORIES.find((c) => c.id === id) || CATEGORIES[0];
    setCategoryId(next.id);
    setScope(next.scope);
    setCriteria(next.criteria.join('\n'));
  };

  const requireReady = () => {
    if (!hasContractAddress) {
      throw new Error('No contract address is configured. Deploy on GenLayer Studio, then set VITE_CONTRACT_ADDRESS.');
    }
    if (!account) {
      throw new Error('Connect a wallet first.');
    }
  };

  const connectWallet = async () => {
    try {
      if (!window.ethereum) {
        setErrorMessage('MetaMask is required to use AuditBounty.');
        return;
      }
      setErrorMessage(null);
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const addr = accounts[0];
      try {
        await ensureStudioNetwork();
      } catch (err) {
        console.warn('studionet switch note:', err);
      }
      setAccount(addr);
    } catch (err) {
      setErrorMessage(formatWalletError(err, 'Wallet connection failed'));
    }
  };

  const fetchPrograms = useCallback(async ({ silent = false } = {}) => {
    if (!hasContractAddress) {
      setPrograms([]);
      return { rows: [], count: 0 };
    }
    try {
      if (!silent) setLoading(true);
      const client = getListClient(account);
      if (!client) return { rows: [], count: 0 };
      const loaded = await loadPrograms(client, account);
      setPrograms(loaded.rows);
      if (!silent && !loaded.rows.length && loaded.listError) {
        setErrorMessage(loaded.listError.message || 'Could not load programs');
      }
      return loaded;
    } catch (err) {
      console.warn('list_programs failed:', err);
      if (!silent) setErrorMessage(err?.message || 'Could not load programs');
      return { rows: [], count: 0 };
    } finally {
      if (!silent) setLoading(false);
    }
  }, [account]);

  const fetchReports = useCallback(async ({ silent = false } = {}) => {
    if (!hasContractAddress) {
      setReports([]);
      return { rows: [], count: 0 };
    }
    try {
      if (!silent) setLoading(true);
      const client = getListClient(account);
      if (!client) return { rows: [], count: 0 };
      const loaded = await loadReports(client, account, '');
      setReports(loaded.rows);
      if (!silent && !loaded.rows.length && loaded.listError) {
        setErrorMessage(loaded.listError.message || 'Could not load reports');
      }
      return loaded;
    } catch (err) {
      console.warn('list_reports failed:', err);
      if (!silent) setErrorMessage(err?.message || 'Could not load reports');
      return { rows: [], count: 0 };
    } finally {
      if (!silent) setLoading(false);
    }
  }, [account]);

  const fetchDetail = async (reportId) => {
    if (!hasContractAddress || reportId == null || String(reportId).startsWith('0x')) return null;
    try {
      const client = getListClient(account);
      const row = await readView(client, 'get_report', [String(reportId)], account);
      if (row && typeof row === 'object') {
        setDetails((prev) => ({ ...prev, [String(reportId)]: row }));
        return row;
      }
      return null;
    } catch (err) {
      console.warn('get_report failed:', err);
      return null;
    }
  };

  useEffect(() => {
    fetchPrograms();
    fetchReports();
    if (!hasContractAddress) return undefined;
    const timer = setInterval(() => {
      fetchPrograms({ silent: true });
      fetchReports({ silent: true });
    }, 15000);
    return () => clearInterval(timer);
  }, [fetchPrograms, fetchReports]);

  useEffect(() => {
    if (!submitProgramId && programs.length) {
      setSubmitProgramId(programs[0].program_id);
    }
  }, [programs, submitProgramId]);

  const runWrite = async (fnName, args, value, { resolving, poll } = {}) => {
    requireReady();
    setErrorMessage(null);
    setTxHash(null);
    if (resolving) setResolvingId(resolving);
    setLoading(true);
    try {
      await ensureStudioNetwork();
      const client = getWriteClient(account);
      const sender = resolveReadAccount(account);
      const hash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: fnName,
        args,
        account: sender,
        value: value === undefined ? 0n : value,
      });
      setTxHash(hash);
      await waitForTx(client, hash);

      if (poll === 'programs') {
        const previousCount = programs.length;
        const listed = await pollUntilListed({
          previousCount,
          attempts: 6,
          intervalMs: 3000,
          load: async () => fetchPrograms({ silent: true }),
        });
        setPrograms(listed.rows || []);
      } else {
        const previousCount = reports.length;
        const listed = await pollUntilListed({
          previousCount,
          attempts: 6,
          intervalMs: 3000,
          load: async () => fetchReports({ silent: true }),
        });
        setReports(listed.rows || []);
        await fetchPrograms({ silent: true });
        const createdId =
          fnName === 'submit_report'
            ? extractCreatedId(hash) || (listed.count > 0 ? String(listed.count - 1) : null)
            : args && args[0] && !String(args[0]).startsWith('0x')
              ? String(args[0])
              : null;
        if (createdId) {
          setActiveReportId(createdId);
          await fetchDetail(createdId);
        }
      }
      return hash;
    } catch (err) {
      setErrorMessage(formatWalletError(err, `${fnName} failed`));
      throw err;
    } finally {
      setLoading(false);
      setResolvingId(null);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      if (!projectName.trim()) throw new Error('Project name cannot be empty.');
      if (!scope.trim()) throw new Error('Scope cannot be empty.');
      const criteriaList = criteria.split('\n').map((line) => line.trim()).filter(Boolean);
      if (!criteriaList.length) throw new Error('Add at least one severity criterion.');
      if (!tiersOk) throw new Error('Payout tiers must be > 0 and descending: Critical ≥ High ≥ Medium ≥ Low.');
      if (fundWei <= 0n) throw new Error('Initial pool must be greater than 0 GEN.');
      await runWrite(
        'create_bounty_program',
        [projectName.trim(), scope.trim(), criteriaList, criticalWei, highWei, mediumWei, lowWei],
        fundWei,
        { poll: 'programs' }
      );
      setTab('programs');
    } catch (err) {
      setErrorMessage(formatWalletError(err, 'Create program failed'));
    }
  };

  const handleFund = async (programId) => {
    try {
      const wei = parseGenToWei(fundDrafts[programId] || '');
      if (wei <= 0n) throw new Error('Fund amount must be greater than 0 GEN.');
      await runWrite('fund_program', [programId], wei, { poll: 'programs' });
    } catch (err) {
      setErrorMessage(formatWalletError(err, 'Fund failed'));
    }
  };

  const cleanUrls = (arr) => arr.map((u) => u.trim()).filter(Boolean);

  const handleSubmitReport = async (e) => {
    e.preventDefault();
    try {
      if (!submitProgramId) throw new Error('Select a bounty program.');
      if (!reportTitle.trim()) throw new Error('Title cannot be empty.');
      const pocs = cleanUrls(pocUrls);
      const refs = cleanUrls(refUrls);
      if (pocs.length < 1) throw new Error('Paste at least 1 proof-of-concept URL.');
      if (refs.length < 2) throw new Error('Paste at least 2 independent reference URLs.');
      await runWrite('submit_report', [submitProgramId, reportTitle.trim(), pocs, refs]);
      setReportTitle('');
      setPocUrls(['']);
      setRefUrls(['', '']);
      setTab('reports');
    } catch (err) {
      setErrorMessage(formatWalletError(err, 'Submit report failed'));
    }
  };

  const handleAddEvidence = async (reportId) => {
    try {
      const pocs = cleanUrls(pocUrls);
      const refs = cleanUrls(refUrls);
      if (pocs.length < 1) throw new Error('Paste at least 1 proof-of-concept URL.');
      if (refs.length < 2) throw new Error('Paste at least 2 independent reference URLs.');
      await runWrite('add_evidence', [reportId, pocs, refs]);
    } catch (err) {
      setErrorMessage(formatWalletError(err, 'Add evidence failed'));
    }
  };

  const handleResolve = async (reportId) => {
    try {
      await runWrite('resolve_report', [reportId], undefined, { resolving: reportId });
      setActiveReportId(reportId);
      await fetchDetail(reportId);
    } catch (err) {
      setErrorMessage(formatWalletError(err, 'AI classification failed'));
    }
  };

  const handleRetry = async (reportId) => {
    try {
      await runWrite('retry_resolution', [reportId]);
    } catch (err) {
      setErrorMessage(formatWalletError(err, 'Retry failed'));
    }
  };

  const programName = (id) => {
    const found = programs.find((p) => String(p.program_id) === String(id));
    return found ? found.project_name : `Program #${id}`;
  };

  const renderUrlEditor = () => (
    <>
      <div className="field">
        <label className="label">Proof-of-concept URLs (min 1)</label>
        {pocUrls.map((u, i) => (
          <div className="url-row" key={`p-${i}`}>
            <input
              className="input mono"
              placeholder="https://gist / PR / exploit demo…"
              value={u}
              onChange={(e) => {
                const next = [...pocUrls];
                next[i] = e.target.value;
                setPocUrls(next);
              }}
            />
            <button
              type="button"
              className="btn-ghost"
              onClick={async () => {
                const text = await pasteClipboard();
                const next = [...pocUrls];
                next[i] = text;
                setPocUrls(next);
              }}
            >
              <ClipboardPaste size={14} />
            </button>
            {pocUrls.length > 1 && (
              <button type="button" className="btn-ghost" onClick={() => setPocUrls(pocUrls.filter((_, j) => j !== i))}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
        <button type="button" className="btn-ghost" onClick={() => setPocUrls([...pocUrls, ''])}>
          <Plus size={14} /> Add PoC URL
        </button>
      </div>
      <div className="field">
        <label className="label">Independent reference URLs (min 2, not written by the hunter)</label>
        {refUrls.map((u, i) => (
          <div className="url-row" key={`r-${i}`}>
            <input
              className="input mono"
              placeholder="https://policy / CVE / independent write-up…"
              value={u}
              onChange={(e) => {
                const next = [...refUrls];
                next[i] = e.target.value;
                setRefUrls(next);
              }}
            />
            <button
              type="button"
              className="btn-ghost"
              onClick={async () => {
                const text = await pasteClipboard();
                const next = [...refUrls];
                next[i] = text;
                setRefUrls(next);
              }}
            >
              <ClipboardPaste size={14} />
            </button>
            {refUrls.length > 2 && (
              <button type="button" className="btn-ghost" onClick={() => setRefUrls(refUrls.filter((_, j) => j !== i))}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
        <button type="button" className="btn-ghost" onClick={() => setRefUrls([...refUrls, ''])}>
          <Plus size={14} /> Add reference URL
        </button>
      </div>
    </>
  );

  const renderPayoutField = (label, value, setter, tone) => (
    <div className="field">
      <label className="label">{label} payout (GEN)</label>
      <div className="chips" style={{ marginBottom: '0.55rem' }}>
        {PAYOUT_PRESETS.map((p) => (
          <button
            key={`${label}-${p}`}
            type="button"
            className={`chip ${value === p ? 'active' : ''}`}
            onClick={() => setter(p)}
          >
            {p}
          </button>
        ))}
      </div>
      <input
        className={`input mono ${tone}`}
        inputMode="decimal"
        value={value}
        onChange={(e) => setter(sanitizeGenInput(e.target.value))}
      />
      <div className="hint mono">wei: {parseGenToWei(value).toString()}</div>
    </div>
  );

  return (
    <div className="app">
      <div className="free-banner">
        Free to use — you only pay GenLayer network gas when you sign a transaction. There is no other platform fee.
      </div>

      {!hasContractAddress && (
        <div className="missing-banner">
          No contract address is wired yet. The app is in preview mode and will not crash. Deploy on GenLayer Studio,
          confirm <strong>Result: SUCCESS</strong>, then set <span className="mono">VITE_CONTRACT_ADDRESS</span> in
          <span className="mono"> frontend/.env</span> and restart <span className="mono">npm run dev</span>.
        </div>
      )}

      <header className="header">
        <div className="brand">
          <div className="brand-mark">
            <Bug size={22} />
          </div>
          <div>
            <h1>AuditBounty</h1>
            <p>Neutral escrow bug bounty · 5 discrete severity verdicts</p>
          </div>
        </div>
        <div className="header-right">
          <div className="network"><span className="dot" /> studionet</div>
          {account ? (
            <button className="btn-secondary mono" type="button">
              <Wallet size={16} /> {shortAddr(account)}
            </button>
          ) : (
            <button className="btn-primary" type="button" onClick={connectWallet}>
              <Wallet size={16} /> Connect Wallet
            </button>
          )}
        </div>
      </header>

      <nav className="tabs">
        <button className={`tab ${tab === 'programs' ? 'active' : ''}`} onClick={() => setTab('programs')}>
          <List size={16} /> Programs ({programs.length})
        </button>
        <button className={`tab ${tab === 'create' ? 'active' : ''}`} onClick={() => setTab('create')}>
          <PlusCircle size={16} /> Create program
        </button>
        <button className={`tab ${tab === 'submit' ? 'active' : ''}`} onClick={() => setTab('submit')}>
          <FileWarning size={16} /> Submit report
        </button>
        <button className={`tab ${tab === 'reports' ? 'active' : ''}`} onClick={() => setTab('reports')}>
          <Scale size={16} /> Reports ({reports.length})
        </button>
      </nav>

      {txHash && <div className="ok-banner">Transaction submitted: <span className="mono">{txHash}</span></div>}
      {errorMessage && <div className="err-banner">{errorMessage}</div>}

      {tab === 'programs' && (
        <div>
          <div className="row-between" style={{ marginBottom: '1rem' }}>
            <h2>Bounty programs</h2>
            <button className="btn-secondary" type="button" onClick={() => fetchPrograms()} disabled={loading || !hasContractAddress}>
              <RefreshCw size={14} /> Refresh
            </button>
          </div>

          {!hasContractAddress && (
            <div className="card empty">
              <Bug size={36} />
              <p style={{ marginTop: '0.75rem' }}>Preview mode — connect a deployed contract address to load live programs.</p>
              <button className="btn-primary" style={{ marginTop: '1rem' }} type="button" onClick={() => setTab('create')}>
                Explore create flow
              </button>
            </div>
          )}

          {hasContractAddress && programs.length === 0 && (
            <div className="card empty">
              <p>No bounty programs yet. Lock GEN into a pool with four fixed severity payouts.</p>
              <button className="btn-primary" style={{ marginTop: '1rem' }} type="button" onClick={() => setTab('create')}>
                Create first program
              </button>
            </div>
          )}

          <div className="grid">
            {programs.map((program) => {
              const isOperator = account && sameAddress(account, program.operator);
              return (
                <div className="card" key={program.program_id}>
                  <div className="row-between">
                    <div>
                      <div className="label">Program #{program.program_id}</div>
                      <div className="amount">{program.project_name}</div>
                    </div>
                    <span className={`badge ${program.active ? 'badge-active' : 'badge-inactive'}`}>
                      {program.active ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </div>
                  <p style={{ color: 'var(--muted)', fontSize: '0.85rem', margin: '0.7rem 0' }}>
                    {(program.scope_description || '').slice(0, 180)}
                  </p>
                  <div className="tier-grid">
                    <div><span>Critical</span><b>{formatWeiToGen(program.critical_payout)} GEN</b></div>
                    <div><span>High</span><b>{formatWeiToGen(program.high_payout)} GEN</b></div>
                    <div><span>Medium</span><b>{formatWeiToGen(program.medium_payout)} GEN</b></div>
                    <div><span>Low</span><b>{formatWeiToGen(program.low_payout)} GEN</b></div>
                  </div>
                  <div className="stack" style={{ color: 'var(--sub)', fontSize: '0.8rem', marginTop: '0.8rem' }}>
                    <div>Pool: <span className="mono">{formatWeiToGen(program.pool_balance)} GEN</span></div>
                    <div>Operator: <span className="mono">{shortAddr(program.operator)}</span></div>
                  </div>
                  <div className="actions">
                    <button
                      className="btn-ghost full"
                      type="button"
                      onClick={() => {
                        setSubmitProgramId(program.program_id);
                        setTab('submit');
                      }}
                    >
                      Submit a report
                    </button>
                    {isOperator && (
                      <div className="url-row">
                        <input
                          className="input mono"
                          inputMode="decimal"
                          placeholder="Add GEN"
                          value={fundDrafts[program.program_id] || ''}
                          onChange={(e) => setFundDrafts((prev) => ({
                            ...prev,
                            [program.program_id]: sanitizeGenInput(e.target.value),
                          }))}
                        />
                        <button className="btn-secondary" type="button" disabled={loading} onClick={() => handleFund(program.program_id)}>
                          Fund
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'create' && (
        <form className="card" style={{ maxWidth: 760, margin: '0 auto' }} onSubmit={handleCreate}>
          <h2 style={{ marginBottom: '1.1rem' }}>Create bounty program</h2>
          <p className="hint" style={{ marginBottom: '1rem' }}>
            MetaMask must be on <strong>Genlayer Studio Network</strong>. Approve the network switch, then click
            <strong> Confirm</strong> on the GEN transfer. Do not Reject the popup.
          </p>

          <div className="field">
            <label className="label">Project category</label>
            <div className="chips">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`chip-card ${categoryId === c.id ? 'active' : ''}`}
                  onClick={() => applyCategory(c.id)}
                >
                  <b>{c.icon} {c.name}</b>
                  <span>{c.blurb}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label className="label">Project name</label>
            <input
              className="input"
              placeholder={`${category.name} program`}
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label className="label">Scope (edit to match the repo / contracts)</label>
            <textarea className="input textarea" rows={4} value={scope} onChange={(e) => setScope(e.target.value)} />
          </div>

          <div className="field">
            <label className="label">Severity criteria (one line per criterion)</label>
            <textarea className="input textarea" rows={5} value={criteria} onChange={(e) => setCriteria(e.target.value)} />
          </div>

          <div className="payout-grid">
            {renderPayoutField('Critical', criticalStr, setCriticalStr, 'tone-critical')}
            {renderPayoutField('High', highStr, setHighStr, 'tone-high')}
            {renderPayoutField('Medium', mediumStr, setMediumStr, 'tone-medium')}
            {renderPayoutField('Low', lowStr, setLowStr, 'tone-low')}
          </div>
          {!tiersOk && (
            <div className="err-banner">Tiers must be greater than 0 and descending: Critical ≥ High ≥ Medium ≥ Low.</div>
          )}

          <div className="field">
            <label className="label">Initial pool (GEN)</label>
            <div className="chips" style={{ marginBottom: '0.55rem' }}>
              {FUND_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`chip ${fundStr === p ? 'active' : ''}`}
                  onClick={() => setFundStr(p)}
                >
                  {p} GEN
                </button>
              ))}
            </div>
            <input
              className="input mono"
              inputMode="decimal"
              value={fundStr}
              onChange={(e) => setFundStr(sanitizeGenInput(e.target.value))}
            />
            <div className="hint mono">wei (via parseGenToWei): {fundWei.toString()}</div>
          </div>

          <button className="btn-primary full" type="submit" disabled={loading || !hasContractAddress || !tiersOk || fundWei <= 0n}>
            {loading ? 'Creating program…' : `Create program · lock ${formatWeiToGen(fundWei)} GEN`}
          </button>
          {!hasContractAddress && (
            <p className="hint">Create is disabled until a contract address is wired in.</p>
          )}
        </form>
      )}

      {tab === 'submit' && (
        <form className="card" style={{ maxWidth: 760, margin: '0 auto' }} onSubmit={handleSubmitReport}>
          <h2 style={{ marginBottom: '1.1rem' }}>Submit a hunter report</h2>
          <div className="field">
            <label className="label">Bounty program</label>
            <select
              className="input"
              value={submitProgramId}
              onChange={(e) => setSubmitProgramId(e.target.value)}
            >
              <option value="">Select a program</option>
              {programs.map((p) => (
                <option key={p.program_id} value={p.program_id}>
                  #{p.program_id} {p.project_name} — pool {formatWeiToGen(p.pool_balance)} GEN
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label">Title</label>
            <input
              className="input"
              placeholder="Reentrancy in withdraw()"
              value={reportTitle}
              onChange={(e) => setReportTitle(e.target.value)}
              required
            />
          </div>
          {renderUrlEditor()}
          <button className="btn-primary full" type="submit" disabled={loading || !hasContractAddress}>
            {loading ? 'Submitting…' : 'Submit report'}
          </button>
        </form>
      )}

      {tab === 'reports' && (
        <div>
          <div className="row-between" style={{ marginBottom: '1rem' }}>
            <h2>Reports</h2>
            <button className="btn-secondary" type="button" onClick={() => fetchReports()} disabled={loading || !hasContractAddress}>
              <RefreshCw size={14} /> Refresh
            </button>
          </div>

          {hasContractAddress && reports.length === 0 && (
            <div className="card empty">
              <p>No reports yet. Hunters submit a PoC plus two independent references, then request AI classification.</p>
              <button className="btn-primary" style={{ marginTop: '1rem' }} type="button" onClick={() => setTab('submit')}>
                Submit first report
              </button>
            </div>
          )}

          <div className="grid">
            {reports.map((report) => {
              const detail = details[report.report_id];
              const status = detail?.status || report.status;
              const verdict = detail?.verdict || report.verdict;
              const reason = detail?.verdict_reason;
              const confidence = detail?.confidence ?? report.confidence;
              const payout = detail?.payout_amount ?? report.payout_amount;
              const isOpen = activeReportId === report.report_id;
              const isHunter = account && sameAddress(account, report.hunter);
              return (
                <div className="card" key={report.report_id}>
                  <div className="row-between">
                    <div>
                      <div className="label">Report #{report.report_id} · {programName(report.program_id)}</div>
                      <div className="amount">{report.title}</div>
                    </div>
                    <span className={statusClass(status)}>{status}</span>
                  </div>
                  <div className="stack" style={{ color: 'var(--sub)', fontSize: '0.8rem', marginTop: '0.6rem' }}>
                    <div>Hunter: <span className="mono">{shortAddr(report.hunter)}</span></div>
                    <div>Payout: <span className="mono">{formatWeiToGen(payout)} GEN</span></div>
                  </div>

                  {verdict && (
                    <div className={`verdict-box ${verdictClass(verdict)}`}>
                      <strong>{verdict}</strong>
                      {confidence !== undefined && confidence !== '' && (
                        <span className="mono" style={{ marginLeft: '0.5rem', color: 'var(--muted)' }}>
                          confidence {String(confidence)}
                        </span>
                      )}
                      {reason && <p style={{ marginTop: '0.4rem', fontSize: '0.82rem', color: 'var(--muted)' }}>{reason}</p>}
                    </div>
                  )}

                  <div className="actions">
                    <button
                      className="btn-ghost full"
                      type="button"
                      onClick={() => {
                        setActiveReportId(isOpen ? null : report.report_id);
                        fetchDetail(report.report_id);
                      }}
                    >
                      {isOpen ? 'Hide actions' : 'Open actions'}
                    </button>

                    {isOpen && (status === 'SUBMITTED' || status === 'DISPUTED') && (
                      <button className="btn-ai" type="button" disabled={loading} onClick={() => handleResolve(report.report_id)}>
                        {resolvingId === report.report_id ? (
                          <>
                            <span className="spinner" /> AI is classifying…
                          </>
                        ) : (
                          <>
                            <Scale size={16} /> Request AI classification
                          </>
                        )}
                      </button>
                    )}

                    {isOpen && status === 'DISPUTED' && isHunter && (
                      <>
                        {renderUrlEditor()}
                        <button className="btn-secondary full" type="button" disabled={loading} onClick={() => handleAddEvidence(report.report_id)}>
                          <Plus size={15} /> Add evidence, then request AI again
                        </button>
                      </>
                    )}

                    {isOpen && (status === 'PAYOUT_FAILED' || status === 'REJECTED_NO_FUNDS') && (
                      <button className="btn-primary full" type="button" disabled={loading} onClick={() => handleRetry(report.report_id)}>
                        <RotateCcw size={15} /> Retry
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
