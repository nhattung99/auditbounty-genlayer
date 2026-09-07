# Deploy AuditBounty on studionet

Do **not** switch the app or wallet to Asimov/Bradbury testnet. This project stays on **studionet**.

1. Open [GenLayer Studio](https://studio.genlayer.com).
2. New Intelligent Contract → paste [`contracts/audit_bounty.py`](../../contracts/audit_bounty.py).
3. Confirm the two header lines (`# v0.2.16` and the `Depends` hash) match the **current** Studio template. If Studio ships a newer hash, update the Depends line and redeploy.
4. Run & Debug → Deploy. Click the transaction and confirm **`Result: SUCCESS`** (not only `FINALIZED`).
5. Copy the contract address.
6. Set it in `frontend/.env` as `VITE_CONTRACT_ADDRESS=0x...` and restart `npm run dev`.
7. After handshake, the same address goes into Vercel production env, then rebuild.

Fund the operator/hunter wallets from the Studio **Accounts** panel. Do not use `testnet-faucet.genlayer.foundation` — that faucet credits a different chain.
