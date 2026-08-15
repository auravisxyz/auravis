// Generated from contracts/out — regenerate after any contract change.
// Hand-synced rather than codegen'd: this is a six-day build and the ABI is
// small enough to eyeball. If the contract changes, recompile and replace this.

export const auravisMandateAbi = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_owner",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_agent",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "requested",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "remaining",
        "type": "uint256"
      }
    ],
    "name": "ExceedsLifetimeCap",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "requested",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "remaining",
        "type": "uint256"
      }
    ],
    "name": "ExceedsWindowCap",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ExpiryInPast",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "MandateExpired",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "MandateInactive",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotAgent",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotOwner",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "minOut",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "actual",
        "type": "uint256"
      }
    ],
    "name": "ReceivedLessThanMinimum",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "Reentrancy",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "RouterCallFailed",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "router",
        "type": "address"
      }
    ],
    "name": "RouterNotAllowed",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "declared",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "actual",
        "type": "uint256"
      }
    ],
    "name": "SpentMoreThanDeclared",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "TransferFailed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZeroAmount",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "previousAgent",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "newAgent",
        "type": "address"
      }
    ],
    "name": "AgentChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "token",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "Deposited",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "spent",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "received",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "lifetimeRemaining",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "reason",
        "type": "string"
      }
    ],
    "name": "MandateExecuted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "spendToken",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "buyToken",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "lifetimeCap",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "windowCap",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "windowLength",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "expiry",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "minOutPerUnit",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "intent",
        "type": "string"
      }
    ],
    "name": "MandateOpened",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "MandateRevoked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "router",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "allowed",
        "type": "bool"
      }
    ],
    "name": "RouterAllowed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "token",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "Withdrawn",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "agent",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "allowedRouters",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "amountIn",
        "type": "uint256"
      }
    ],
    "name": "canExecute",
    "outputs": [
      {
        "internalType": "bool",
        "name": "allowed",
        "type": "bool"
      },
      {
        "internalType": "string",
        "name": "why",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "deposit",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "router",
        "type": "address"
      },
      {
        "internalType": "bytes",
        "name": "swapData",
        "type": "bytes"
      },
      {
        "internalType": "uint256",
        "name": "declaredIn",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "minOut",
        "type": "uint256"
      },
      {
        "internalType": "string",
        "name": "reason",
        "type": "string"
      }
    ],
    "name": "execute",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "spent",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "received",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "getMandate",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "spendToken",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "buyToken",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "lifetimeCap",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "spent",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "windowCap",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "windowSpent",
            "type": "uint256"
          },
          {
            "internalType": "uint64",
            "name": "windowLength",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "windowStart",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "expiry",
            "type": "uint64"
          },
          {
            "internalType": "bool",
            "name": "active",
            "type": "bool"
          },
          {
            "internalType": "string",
            "name": "intent",
            "type": "string"
          },
          {
            "internalType": "uint256",
            "name": "minOutPerUnit",
            "type": "uint256"
          }
        ],
        "internalType": "struct AuravisMandate.Mandate",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "mandateCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "spendToken",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "buyToken",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "lifetimeCap",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "windowCap",
        "type": "uint256"
      },
      {
        "internalType": "uint64",
        "name": "windowLength",
        "type": "uint64"
      },
      {
        "internalType": "uint64",
        "name": "expiry",
        "type": "uint64"
      },
      {
        "internalType": "uint256",
        "name": "minOutPerUnit",
        "type": "uint256"
      },
      {
        "internalType": "string",
        "name": "intent",
        "type": "string"
      }
    ],
    "name": "openMandate",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "revokeMandate",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "newAgent",
        "type": "address"
      }
    ],
    "name": "setAgent",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "router",
        "type": "address"
      },
      {
        "internalType": "bool",
        "name": "allowed",
        "type": "bool"
      }
    ],
    "name": "setRouterAllowed",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "withdraw",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;
