<div align="center">

# Auravis

**Point at anything on the internet, tell it your price, and it acts, inside a limit the blockchain enforces.**

[auravis.xyz](https://www.auravis.xyz) · Built on [X Layer](https://web3.okx.com/xlayer)

</div>

---

## What it does

Auravis is a browser extension and a dashboard. On any page, click the icon and
say what you want in plain English: *"buy 1 if it drops 8%"*. That becomes a
**mandate**, a signed and revocable licence with a spending cap enforced by a
smart contract.

Then it watches. When your condition is met it either prepares the swap and asks
you to confirm, or executes it itself, depending on the mode you chose. Either
way it writes down what it did, and why.

### Why the cap is on-chain

Agent products today enforce spending limits in the prompt. Prompts can be
argued with, jailbroken, and poisoned by text the agent reads off a web page. In
May 2026 an AI wallet was drained of about $180,000 by an instruction hidden in
a public social media reply.

Auravis puts the limit in the contract. The agent can be lied to, compromised,
or go completely haywire, and it still cannot move a unit beyond what you signed
for.

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

---

## Proof

Real actions taken by the agent, unattended, on X Layer mainnet, with real
money. Two runs on two separate mandates. Each is a pair: the agent acts on its
own, then the router's rate is dropped below the owner's price floor and the
same agent is told to buy anyway.

**Mandate #1**, *"buy it the moment it drops 8%"*

| What | Tx |
|---|---|
| Executed on its own. Spent 4 USDT, received 3.996 USDC, 15 left of the cap | [`0x07108663…`](https://www.okx.com/web3/explorer/xlayer/tx/0x07108663251e453a26a0e6b3d551fee7fc6987e824a174287d6a34dc21702d33) |
| **Refused by the contract** after the rate dropped. Reverted, `ReceivedLessThanMinimum(0.99, 0.90)` | [`0xd7cc7a53…`](https://www.okx.com/web3/explorer/xlayer/tx/0xd7cc7a53a16ee5f73916986caefe9f01ecba80c1b94eb357d322942a69dddf07) |

**Mandate #0**, *"buy USDC with USDT when the price is right"*

| What | Tx |
|---|---|
| Executed on its own. Spent 4 USDT, received 3.998 USDC, 16 left of the cap | [`0xbf431b33…`](https://www.okx.com/web3/explorer/xlayer/tx/0xbf431b339a4ff84c67851db2d2aac5744d8491acd49c3529ce8eaa6d6474300b) |
| **Refused by the contract** after the rate dropped. Reverted, `ReceivedLessThanMinimum(0.99, 0.90)` | [`0x255068e7…`](https://www.okx.com/web3/explorer/xlayer/tx/0x255068e702288bde4b5677111e75c2e5ef51c567756292636e3a7a89602ad456) |

In every case the agent held a valid signature, was inside its cap, and called
an allowlisted router. It still could not move the money, because the price was
wrong. Permission was never what stood in its way.

The first pair is the one in the demo video, so the hashes on screen can be
checked against this table.

<details>
<summary>Testnet, where both guardrails were first proven</summary>

| What | Tx |
|---|---|
| Agent executed a swap on its own, inside its mandate | [`0xeda51fcc…`](https://www.okx.com/web3/explorer/xlayer-test/tx/0xeda51fccdd537ec875a24365812046b61eed706280e51ae8972a3f745b6fcb00) |
| Router rate dropped below the mandate's price floor | [`0x9970fc70…`](https://www.okx.com/web3/explorer/xlayer-test/tx/0x9970fc7040e5eb9c82a062535c77294ccb81338fc6ee1037619557241feb2508) |
| The same agent was then **refused by the contract** | reverted, `ReceivedLessThanMinimum(9.90, 9.00)` |

> The chain refused: the router offered too little. Your floor requires 9.90,
> it offered 9.00. **The price floor held.**

That sentence is generated from the revert itself, not written by hand. A
separate run was refused by the rolling rate limit rather than the price floor,
so both independent guardrails have held against a live agent.

</details>

---

## Try it yourself

Every vault has exactly one owner. That is the point of a non-custodial design,
and it also means connecting your own wallet to our vault correctly gets you a
read-only view. So there is a second vault on testnet whose key is published
below. Import it and you own that one.

```
key      0xb9754e3366eff4f89cbb334188a170836e406dd5a5c30fa49d0667f21b61efb4
address  0x441698d746Ddc2629d719Fb092c726564033c2b2
vault    0xAFABD7b4dDF492c1D9f1DD2aEe727697725F78Ff
```

This key is public on purpose and lives only on X Layer testnet, holding mock
tokens minted for the occasion. Nothing on it is worth anything. Do not send it
real funds, and do not reuse it anywhere.

Import it into any wallet, switch to X Layer testnet, and open
[auravis.xyz](https://www.auravis.xyz). You get the owner view, with a mandate
already open: 50 cap, 20 per hour, a 0.99 price floor, and 200 mock USDT
deposited. The demo wallet holds 800 more, so you can deposit further, open your
own mandates, or revoke ours and watch the agent stop.

The extension needs no wallet at all. Point it at any page and state an
instruction to see the capture and the parsing on their own.

---

## What the contract guarantees

Every one of these is enforced in `AuravisMandate.sol` and tested in
`contracts/test/`, not asserted in a prompt or checked by the agent.

| Guarantee | How |
|---|---|
| It cannot spend past your total | Lifetime cap, checked against amount already spent |
| It cannot drain the cap in one burst | Rolling window cap, resets on a timer you set |
| It cannot pay a bad price | Owner-set price floor the agent may tighten, never loosen |
| It cannot route through anywhere it likes | Router allowlist, owner-controlled |
| It cannot lie about what it spent | Balance deltas measured before and after, not taken on trust |
| It cannot act after you are done | Revoke in one transaction, or set an expiry up front |
| It cannot hold your money | Funds sit in your vault, withdrawable without anyone's permission |

Two more properties fall out of the architecture rather than the code. The
extension has no key and no wallet access, so a compromised extension can
propose and nothing more. And the agent's key is deliberately disposable: steal
it and you inherit exactly the authority the mandate describes, which is a
capped amount of one token, into one allowlisted router, above a price floor
you cannot move.

`forge test` covers 22 cases, including every refusal path above.

---

## What makes it more than a price alert

### Waiting is the feature

Price is only one reason to wait. Auravis also watches whether a thing can be
bought at all, and treats coming back in stock as its own event.

A sold-out item never fires a price alert, because sending someone to a page
they cannot buy from is worse than staying quiet. It remembers the item was
gone, keeps checking, and tells you the moment it returns. That is the concert
ticket at 10am, the sneaker drop, the restock you would otherwise have to sit
and refresh for.

Checking runs in your own browser, on your own session, so it sees the page you
would see: your region, your currency, your account pricing. A server watching
the same URL from a datacentre sees a different page, or a bot wall.

### Reading the page, not scraping it

A price-shaped string exists on plenty of pages where it means nothing: an
article quoting last year's figure, a sidebar advert, a footer. So before
anything else, the extension asks a model what kind of page this is, and gets
back what the page is about, whether the price is something you could act on,
and whether delivery or tax apply here at all.

That decides what you see. A shop page warns that delivery and tax come on top.
A token chart does not, because they do not exist there. An article shows no
price at all, only a quiet offer to show one anyway, because sometimes the
judgment is wrong and burying the number would be its own kind of guessing.

Where the price had to be guessed from page text, the other prices found on the
page are offered as one-tap corrections, alongside a field to type the real one.
A warning that gives you no way to act on it is not honesty, it is a disclaimer.

If the model is unreachable, every one of these falls back to a local heuristic
and the extension keeps working offline.

### Understanding what you asked for

Three different numbers turn up in these sentences and they are not
interchangeable:

| You type | It reads |
|---|---|
| `buy 83$ if price drops 8%` | spend $83, when it falls 8% |
| `buy 1 if price drops to 82$` | one unit, when it reaches $82 |
| `buy at 85$ if price drops 8%` | trigger at $85, and 8% down |
| `buy two when it goes under 40` | two units, when it falls below $40 |

Money can lead or trail the number, be written as a word, carry separators and
decimals, or be a ticker. A count can be a digit or a word. A threshold works
with or without a currency symbol. Every case above, and about thirty more, is
pinned in `shared/src/intent.test.ts`, because each one was broken at some point
and read as though it worked.

---

## Modes

| Mode | Behaviour |
|---|---|
| **Catch** *(default)* | Auravis prepares the swap and notifies you. You confirm in one tap, through OKX's own interface. |
| **Auto** | Auravis executes autonomously under the mandate, within the on-chain cap. |

## Where this goes

Not built. Written down because the architecture points at it, and because it is
clearer to say what is missing than to imply it already works.

The watching half of the queue problem is done. Auravis already sits on a ticket
page or a drop and tells you the instant it opens, from your own browser, and a
mandate already expresses "spend up to $400 the moment these go on sale" without
a single contract change.

What is missing is the payment side. Auravis settles on-chain, so it can watch
any page in the world but can only *buy* where an on-chain route exists. For an
ordinary merchant it can take you to the moment; it cannot yet take the moment
for you.

Closing that gap is a payments integration, not a redesign. The cap, the window,
the allowlist and the price floor are indifferent to what is being bought.

## Findings from building on X Layer

Building this surfaced real issues in the chain's own tooling, including an
aggregator that quotes routes which revert on-chain for every caller, on a pair
OKX's own interface fills in under a second. They are documented with
reproduction steps and a mined transaction in [docs/findings.md](docs/findings.md),
because the honest version of "our on-chain limits held when the infrastructure
did not" is worth more than a demo where nothing went wrong.

---

## Deployments

| Network | Contract | Address |
|---|---|---|
| X Layer mainnet (196) | AuravisMandate | [`0x200d3d9A090AA9520D0Ab8Cb2864ba4Aa4189f00`](https://www.okx.com/web3/explorer/xlayer/address/0x200d3d9A090AA9520D0Ab8Cb2864ba4Aa4189f00) |
| X Layer testnet (1952) | AuravisMandate | [`0x63f18699A8fBa1FD9C9fd194FAF6722Ba50b4A55`](https://www.okx.com/web3/explorer/xlayer-test/address/0x63f18699A8fBa1FD9C9fd194FAF6722Ba50b4A55) |
| X Layer testnet (1952) | Public demo vault | [`0xAFABD7b4dDF492c1D9f1DD2aEe727697725F78Ff`](https://www.okx.com/web3/explorer/xlayer-test/address/0xAFABD7b4dDF492c1D9f1DD2aEe727697725F78Ff) |
| X Layer testnet (1952) | Rehearsal vault | [`0x4b842c68194042Fe559d2B924Aa32dFFFbfDB3b8`](https://www.okx.com/web3/explorer/xlayer-test/address/0x4b842c68194042Fe559d2B924Aa32dFFFbfDB3b8) |

The dashboard runs at [auravis.xyz](https://www.auravis.xyz) and the watcher
runs hosted, so the agent keeps checking whether or not anyone's laptop is open.

## Repo layout

```
contracts/   Solidity, the mandate and spend-limit contract
web/         Next.js dashboard and the API the extension talks to
extension/   Browser extension, the capture surface
agent/       Watcher and executor service
shared/      Types and intent parsing, used by all three
docs/        Findings and technical notes
```

## Development

```bash
# contracts
cd contracts && forge build && forge test

# dashboard
cd web && npm install && npm run dev

# extension
cd extension && npm install && npm run dev

# intent parsing tests
cd shared && npx tsx src/intent.test.ts
```

Copy `.env.example` to `.env` and fill it in. Never commit `.env`.

## License

MIT
