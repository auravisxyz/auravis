# Findings from building on X Layer

Written for the BuildX AI Season submission. Everything below was observed
while building Auravis, Aug 15 2026, and is reproducible with the scripts in
`agent/src/` (`npm run probe`, `npm run routes`, `npm run diagnose`).

## 1. OKX aggregator quotes routes on X Layer that revert on-chain

**The finding.** `GET /api/v6/dex/aggregator/swap` for native USDT
(`0x779ded0c…`) → native USDC (`0xb6ceceab…`) on chain 196 returns healthy
quotes — sensible amounts, ~0.09% impact, executable calldata. Every such
route reverts when executed.

**How we isolated it.** In order:

1. Vault (smart contract) executes the returned calldata → generic revert.
2. Seven route variants (`singleRouteOnly`, `directRoute`, `disableRFQ`,
   `singlePoolPerHop`, combinations, and a USDG pair) → all revert identically.
3. Control: the same swap from a plain EOA, fresh quote, correct approval,
   down to 1 USDT → also reverts on-chain.

Step 3 rules out our architecture entirely: this fails for ordinary wallets
using the documented flow. The quotes appear to reference pool paths that
cannot actually fill.

**Impact on builders.** An integrator trusting quote → execute will pass
every pre-check and fail only at execution, with an undecodable revert from
inside the routed pools. Cost us roughly an evening to isolate.

**What we did.** Deployed a minimal fixed-rate router (`DemoRouter.sol`,
`0x8324bA40…`) holding a small real-token reserve, and pointed autonomous
execution at it. Every Auravis guarantee — caps, rolling windows, router
allowlist, price floor, balance-delta measurement — is enforced in our vault
contract and is identical regardless of which router fills. Support ticket
filed with OKX.

## 2. Native vs bridged stablecoins are an easy silent trap

X Layer carries `USDT` and `USDT_Bridged` (same symbol in most UIs, same
6 decimals, different contracts) — likewise USDC. Both are liquid, so code
holding the wrong one still gets valid quotes and sensible prices; nothing
fails until a balance read returns zero against a wallet that visibly holds
funds. Addresses must come from the token-list endpoint
(`/api/v6/dex/aggregator/all-tokens?chainIndex=196`), never from memory.

## 3. Smaller notes

- **The market price endpoint is POST**, not GET (`/api/v6/dex/market/price`),
  and the HMAC signature must cover the exact body bytes. The GET form returns
  a 200 with an error payload rather than a 405.
- **`approveTransaction=true` without `approveAmount`** on the swap endpoint
  returns `50026 System error` — a generic code for what is actually a
  missing-parameter validation.
- **The aggregator does not serve X Layer testnet** (chain 1952 → `50026`).
  Autonomous flows can only be integration-tested on mainnet or against a
  self-deployed router.
- **Builder Code registration is a mainnet transaction** (needs real OKB), and
  codes are non-hex identifiers; the calldata-suffix encoding for ERC-8021
  attribution is not documented on the swap reference.

## Why this section exists

Auravis's core claim is that safety should not depend on everything else
behaving — the vault assumes routers can lie, agents can be compromised, and
prices can be wrong, and enforces limits anyway. The aggregator issue was an
unplanned live demonstration of the same principle: the quote said one thing,
the chain did another, and the only checks that held were the ones enforced
on-chain. We'd rather document that honestly than present a build where
nothing ever went wrong.
