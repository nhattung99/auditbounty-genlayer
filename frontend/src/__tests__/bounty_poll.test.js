import {
  VIEW_FROM,
  STUDIO_RPC,
  studioRpcUrl,
  formatWalletError,
  sameAddress,
  resolveReadAccount,
  unwrapViewResult,
  normalizeProgramList,
  normalizeReportList,
  normalizeReportRow,
  parseCount,
  extractCreatedId,
  shouldKeepPolling,
  pollUntilListed,
} from '../bountyPoll.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertEqual(actual, expected, msg) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${msg}: expected ${right}, got ${left}`);
}

const program = {
  program_id: '0',
  project_name: 'VaultX',
  pool_balance: '1000',
  critical_payout: '400',
};

const report = {
  report_id: '0',
  program_id: '0',
  status: 'SUBMITTED',
  payout_amount: '0',
};

function runBountyPollTests() {
  console.log('Starting bounty poll / list tests...');

  assertEqual(studioRpcUrl(undefined), STUDIO_RPC, 'node uses Studio RPC');
  assertEqual(studioRpcUrl('https://auditbounty-genlayer.vercel.app'), 'https://auditbounty-genlayer.vercel.app/api/genlayer', 'browser uses same-origin proxy');
  assertEqual(studioRpcUrl('http://localhost:3000/'), 'http://localhost:3000/api/genlayer', 'local proxy');

  assert(
    formatWalletError({ message: 'User rejected the request. Details: user cancel Version: viem@2.55.19' }).includes('Confirm'),
    'rejected wallet request is explained'
  );
  assert(sameAddress('0xAbc', '0xabc') === true, 'same address ignores case');
  assert(sameAddress('0xabc', '0xdef') === false, 'different addresses');

  assertEqual(resolveReadAccount(undefined).address, VIEW_FROM, 'missing account uses view from');
  assertEqual(resolveReadAccount('0xabc').address, VIEW_FROM, 'short address rejected');
  assertEqual(
    resolveReadAccount('0x0000000000000000000000000000000000000002').address,
    '0x0000000000000000000000000000000000000002',
    'wallet address passed through'
  );

  assertEqual(unwrapViewResult('[]'), [], 'empty JSON array');
  assertEqual(unwrapViewResult(JSON.stringify([program]))[0].program_id, '0', 'JSON list string');
  assertEqual(unwrapViewResult({ result: JSON.stringify([report]) })[0].status, 'SUBMITTED', 'wrapped result');
  assertEqual(unwrapViewResult(2n), 2, 'bigint count');
  assertEqual(parseCount('3'), 3, 'count string');

  assertEqual(normalizeProgramList([program]).length, 1, 'native program array');
  assertEqual(normalizeReportList([report]).length, 1, 'native report array');
  assertEqual(normalizeReportRow({ id: 7, status: 'SUBMITTED' }).report_id, '7', 'fallback id field');

  assertEqual(extractCreatedId('0'), '0', 'create returns id string');
  assertEqual(extractCreatedId({ program_id: '1' }), '1', 'create returns object');
  assertEqual(extractCreatedId('0xabc123'), null, 'hash is not an id');

  assert(shouldKeepPolling({ previousCount: 0, currentCount: 0, rows: [] }) === true, 'keep polling while empty');
  assert(shouldKeepPolling({ previousCount: 0, currentCount: 1, rows: [program] }) === false, 'stop when list grows');

  let calls = 0;
  return pollUntilListed({
    previousCount: 0,
    attempts: 5,
    intervalMs: 1,
    sleep: async () => {},
    load: async () => {
      calls += 1;
      if (calls < 3) return { rows: [], count: 0 };
      return { rows: [program], count: 1 };
    },
  }).then((out) => {
    assert(calls === 3, `poll should retry until listed, got ${calls} calls`);
    assertEqual(out.rows[0].program_id, '0', 'poll returns listed program');
    console.log('All bounty poll / list tests passed.');
  });
}

runBountyPollTests();
