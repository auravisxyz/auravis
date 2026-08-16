<div align="center">

# Auravis

**Point at anything on the internet, tell it your price, and it acts — inside a limit the blockchain enforces.**

[auravis.xyz](https://auravis.xyz) · Built on [X Layer](https://web3.okx.com/xlayer)

</div>

---

## What it does

Auravis is a browser extension and dashboard. On any page, click the icon and say
what you want in plain English — *"buy $200 worth if it drops 8%"*. Auravis turns
that into a **mandate**: a signed, revocable licence with a spending cap enforced
by a smart contract.

Then it watches. When your condition is met it either prepares the swap and asks
you to confirm, or executes it itself — depending on the mode you chose. Either
way it writes down what it did, and why.

### Why the cap is on-chain

Agent products today enforce spending limits in the prompt. Prompts can be argued
with, jailbroken, and poisoned by text the agent reads off a web page — in May 2026
an AI wallet was drained of ~$180,000 by an instruction hidden in a public social
media reply.

Auravis puts the limit in the contract. The agent can be lied to, compromised, or
go completely haywire, and it still cannot move a unit beyond what you signed for.

```
                 ┌──────────────┐
   any web page  │  Extension   │  capture + plain-English intent
                 └──────┬───────┘
                        │  mandate (asset, trigger, cap, deadline)
                 ┌──────▼───────┐
                 │   Contract   │  ← the cap lives here, not in a prompt
                 └──────┬───────┘
                        │  bounded authority
                 ┌──────▼───────┐
                 │    Agent     │  watches, acts, explains itself
                 └──────────────┘
```

## Modes

| Mode | Behaviour |
|---|---|
| **Catch** *(default)* | Auravis prepares the swap and notifies you. You confirm in one tap. |
| **Auto** | Auravis executes autonomously under the mandate, within the on-chain cap. |

## Repo layout

```
contracts/   Solidity — the mandate and spend-limit contract
web/         Next.js dashboard
extension/   Browser extension (the capture surface)
agent/       Watcher + executor service
docs/        Research and technical notes
```

## Deployments

| Network | Contract | Address |
|---|---|---|
| X Layer testnet (1952) | AuravisMandate | [`0x63f18699A8fBa1FD9C9fd194FAF6722Ba50b4A55`](https://www.okx.com/web3/explorer/xlayer-test/address/0x63f18699A8fBa1FD9C9fd194FAF6722Ba50b4A55) |
| X Layer mainnet (196) | AuravisMandate | [`0x200d3d9A090AA9520D0Ab8Cb2864ba4Aa4189f00`](https://www.okx.com/web3/explorer/xlayer/address/0x200d3d9A090AA9520D0Ab8Cb2864ba4Aa4189f00) |

## Proof transactions

Real on-chain actions taken by the agent, unattended, with real money.

### Mainnet

Same agent, same key, same mandate. The only thing that changed between these
two rows was the price the router offered.

| What | Tx |
|---|---|
| Agent executed a swap on its own, inside its mandate. Spent 4 USDT, received 3.998 USDC, 16 left of the cap | [`0xbf431b33…`](https://www.okx.com/web3/explorer/xlayer/tx/0xbf431b339a4ff84c67851db2d2aac5744d8491acd49c3529ce8eaa6d6474300b) |
| The router's rate was then dropped below the owner's price floor, and the same agent was **refused by the contract** — reverted, `ReceivedLessThanMinimum(0.99, 0.90)` | [`0x255068e7…`](https://www.okx.com/web3/explorer/xlayer/tx/0x255068e702288bde4b5677111e75c2e5ef51c567756292636e3a7a89602ad456) |

The agent held a valid signature, was inside its cap, and called an allowlisted
router. It still could not move the money, because the price was wrong.
Permission was never what stood in its way.

### Testnet

Same agent, same key, same instruction in both rows below. The only thing that
changed was the price the router offered.

| What | Tx |
|---|---|
| Agent executed a swap on its own, inside its mandate | [`0xeda51fcc…`](https://www.okx.com/web3/explorer/xlayer-test/tx/0xeda51fccdd537ec875a24365812046b61eed706280e51ae8972a3f745b6fcb00) |
| Router rate dropped below the mandate's price floor | [`0x9970fc70…`](https://www.okx.com/web3/explorer/xlayer-test/tx/0x9970fc7040e5eb9c82a062535c77294ccb81338fc6ee1037619557241feb2508) |
| The same agent was then **refused by the contract** | reverted — `ReceivedLessThanMinimum(9.90, 9.00)` |

> The chain refused: the router offered too little — your floor requires 9.90,
> it offered 9.00. **The price floor held.**

That sentence is generated from the revert itself, not written by hand. A
separate run was refused by the rolling rate limit rather than the price floor,
so both independent guardrails have now held against a live agent.

| Network | Contract | Address |
|---|---|---|
| Testnet rehearsal vault | AuravisMandate | [`0x4b842c68…`](https://www.okx.com/web3/explorer/xlayer-test/address/0x4b842c68194042Fe559d2B924Aa32dFFFbfDB3b8) |

## Findings from building on X Layer

Building this surfaced real issues in the chain's own tooling — including an
aggregator that quotes routes which revert on-chain for every caller. They're
documented with reproduction steps in [docs/findings.md](docs/findings.md),
because the honest version of "our on-chain limits held when the
infrastructure didn't" is worth more than a demo where nothing went wrong.

## Development

```bash
# contracts
cd contracts && forge build && forge test

# web
cd web && npm install && npm run dev
```

Copy `.env.example` to `.env` and fill it in. Never commit `.env`.

## License

MIT
