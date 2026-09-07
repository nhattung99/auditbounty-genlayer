export const CATEGORIES = [
  {
    id: 'smart-contract',
    icon: '⛓️',
    name: 'Smart Contract',
    blurb: 'On-chain protocol / DeFi / NFT contracts',
    scope: 'In-scope: Solidity/Vyper contracts in the published repository and the deployed addresses listed by the project. Out of scope: UI-only bugs, social engineering, and issues already disclosed in prior audits.',
    criteria: [
      'Critical: remote code execution equivalent, or direct unauthorized loss of user/protocol funds.',
      'High: privilege escalation, broken access control, or unauthorized state change that can lead to fund risk.',
      'Medium: significant information disclosure or griefing that requires a non-trivial fix.',
      'Low: low-impact misconfiguration, missing events, or best-practice issues with no direct fund risk.',
    ],
  },
  {
    id: 'web-app',
    icon: '🌐',
    name: 'Web App',
    blurb: 'dApp frontend / admin console / API',
    scope: 'In-scope: the production web app and documented public APIs that can affect user funds or authentication. Out of scope: self-XSS, clickjacking without impact, and third-party SaaS misconfig outside the project.',
    criteria: [
      'Critical: unauthenticated takeover of admin or ability to move user funds from the web surface.',
      'High: authenticated privilege escalation or account takeover of other users.',
      'Medium: significant data leak of private user or operational data.',
      'Low: low-impact CSRF, missing headers, or informational findings.',
    ],
  },
  {
    id: 'mobile-app',
    icon: '📱',
    name: 'Mobile App',
    blurb: 'iOS / Android wallet or companion app',
    scope: 'In-scope: official iOS/Android builds and the APIs they call for signing, recovery, or transfers. Out of scope: rooted-device-only issues with no extra impact, and store-listing phishing clones.',
    criteria: [
      'Critical: extraction of seed/private key or unauthorized transfer from a stock device.',
      'High: bypass of local authentication that lets another app or user sign transactions.',
      'Medium: sensitive data stored or logged in plaintext with realistic access.',
      'Low: insecure defaults or missing certificate pinning with no demonstrated impact.',
    ],
  },
  {
    id: 'infra',
    icon: '🛠️',
    name: 'Infra',
    blurb: 'RPC, sequencers, indexers, CI, keys',
    scope: 'In-scope: project-operated RPC, indexer, sequencer, CI/CD, and key-management surfaces listed in the program brief. Out of scope: generic cloud provider issues and physical access attacks.',
    criteria: [
      'Critical: remote code execution on a production host that can steal keys or halt finality.',
      'High: unauthorized access to staging/prod secrets or the ability to inject malicious artifacts.',
      'Medium: significant information disclosure of internal topology or non-public credentials.',
      'Low: misconfigured headers, verbose errors, or hardening gaps with no proven access.',
    ],
  },
];

export const PAYOUT_PRESETS = ['0.1', '0.5', '1', '2', '5', '10'];
export const FUND_PRESETS = ['1', '2', '5', '10', '20', '50'];

export const EXAMPLE_POC_URL = 'https://example.com/poc.md';
export const EXAMPLE_REFERENCE_URLS = [
  'https://docs.example.com/severity-policy',
  'https://advisory.example.com/independent-note',
];
