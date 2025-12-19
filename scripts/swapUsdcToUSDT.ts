import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodePacked,
  http,
  maxUint256,
  parseUnits,
  toHex,
  type Abi,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { base } from "viem/chains";

const UNIVERSAL_ROUTER_ABI = [
  {
    name: "execute",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
] as const satisfies Abi;

const ERC20_ABI = [
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const satisfies Abi;

const PERMIT2_ABI = [
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    outputs: [],
  },
] as const satisfies Abi;

const Commands = {
  V3_SWAP_EXACT_IN: 0x00,
} as const;

const Constants = {
  MSG_SENDER: "0x0000000000000000000000000000000000000001",
  ADDRESS_THIS: "0x0000000000000000000000000000000000000002",
} as const satisfies Record<string, Address>;

const MAX_UINT160 = (1n << 160n) - 1n;
const PERMIT2_APPROVAL_EXPIRATION = Number((1n << 48n) - 1n);

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env var ${name}`);
  }
  return value;
};

const buildChain = (chainId: bigint, rpcUrl: string): Chain => ({
  ...base,
  id: Number(chainId),
  rpcUrls: {
    default: { http: [rpcUrl] },
    public: { http: [rpcUrl] },
  },
});

const ensureApprovals = async (params: {
  publicClient: PublicClient;
  walletClient: WalletClient<Transport, Chain, PrivateKeyAccount>;
  account: PrivateKeyAccount;
  usdc: Address;
  permit2: Address;
  router: Address;
  amountIn: bigint;
}) => {
  const {
    publicClient,
    walletClient,
    account,
    usdc,
    permit2,
    router,
    amountIn,
  } = params;

  const tokenAllowance = await publicClient.readContract({
    address: usdc,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account.address, permit2],
  });
  if (tokenAllowance < amountIn) {
    const hash = await walletClient.writeContract({
      address: usdc,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [permit2, maxUint256],
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  const [permitted, expiration] = await publicClient.readContract({
    address: permit2,
    abi: PERMIT2_ABI,
    functionName: "allowance",
    args: [account.address, usdc, router],
  });
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (permitted < amountIn || BigInt(expiration) < now) {
    const permit2ApproveArgs = [
      usdc,
      router,
      MAX_UINT160,
      PERMIT2_APPROVAL_EXPIRATION,
    ] as const satisfies [Address, Address, bigint, number];
    const hash = await walletClient.writeContract({
      address: permit2,
      abi: PERMIT2_ABI,
      functionName: "approve",
      args: permit2ApproveArgs,
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }
};

async function main() {
  const rpcUrl = requireEnv("RPC_URL");
  const privateKey = requireEnv("PRIVATE_KEY") as `0x${string}`;
  const chainId = BigInt(process.env.CHAIN_ID ?? base.id);
  const account = privateKeyToAccount(privateKey);
  const chain = buildChain(chainId, rpcUrl);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({
    chain,
    account,
    transport: http(rpcUrl),
  });
  const recipient = (process.env.RECIPIENT ?? account.address) as Address;

  const usdc = requireEnv("USDC") as Address;
  const router = requireEnv("UNIVERSAL_ROUTER") as Address;
  const permit2 = requireEnv("PERMIT2") as Address;
  const usdt = requireEnv("USDT") as Address;
  const poolFee = Number(requireEnv("POOL_FEE"));
  if (!Number.isFinite(poolFee) || poolFee <= 0 || poolFee > 0xffffff) {
    throw new Error("POOL_FEE must be a uint24 greater than zero");
  }

  const usdcDecimals =
    process.env.USDC_DECIMALS !== undefined
      ? Number(process.env.USDC_DECIMALS)
      : await publicClient.readContract({
          address: usdc,
          abi: ERC20_ABI,
          functionName: "decimals",
        });
  const usdcAmountInput = process.env.USDC_AMOUNT ?? "0.0001"; // matches the foundry script default of 100 base units on 6 decimals
  const usdcAmountIn = parseUnits(usdcAmountInput, usdcDecimals);
  if (usdcAmountIn > MAX_UINT160) {
    throw new Error("USDC amount too large for Permit2 approval");
  }

  const usdtDecimals =
    process.env.USDT_DECIMALS !== undefined
      ? Number(process.env.USDT_DECIMALS)
      : await publicClient.readContract({
          address: usdt,
          abi: ERC20_ABI,
          functionName: "decimals",
        });
  const minUsdtOut = parseUnits(process.env.MIN_USDT_OUT ?? "0", usdtDecimals);
  const deadline = BigInt(
    process.env.SWAP_DEADLINE ?? Math.floor(Date.now() / 1000 + 15 * 60)
  );

  await ensureApprovals({
    publicClient,
    walletClient,
    account,
    usdc,
    permit2,
    router,
    amountIn: usdcAmountIn,
  });

  const path = encodePacked(["address", "uint24", "address"], [usdc, poolFee, usdt]);
  const commands = toHex(new Uint8Array([Commands.V3_SWAP_EXACT_IN]));

  const inputs: Hex[] = [
    encodeAbiParameters(
      [
        { name: "recipient", type: "address" },
        { name: "amountIn", type: "uint256" },
        { name: "amountOutMin", type: "uint256" },
        { name: "path", type: "bytes" },
        { name: "payerIsUser", type: "bool" },
      ],
      [recipient, usdcAmountIn, minUsdtOut, path, true]
    ),
  ];

  const txHash = await walletClient.writeContract({
    address: router,
    abi: UNIVERSAL_ROUTER_ABI,
    functionName: "execute",
    args: [commands, inputs, deadline],
    account,
  });
  console.log(`Swap tx sent: ${txHash}`);

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  console.log(`Swap confirmed in block ${receipt.blockNumber}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
