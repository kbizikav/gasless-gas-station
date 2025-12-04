import { parseUnits, type Address } from "viem";

const toNumber = (value: string | undefined, fallback: number): number => {
  const parsed = value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBigInt = (value: string | undefined, fallback: bigint): bigint => {
  if (!value) return fallback;
  try {
    return BigInt(value);
  } catch {
    return fallback;
  }
};

const toWei = (value: string | undefined, fallback: bigint): bigint => {
  if (!value) return fallback;
  try {
    return parseUnits(value, 18);
  } catch {
    return fallback;
  }
};

export const NATIVE_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

const DEFAULT_CONTRACT = "0xfB990A2eDc7811223B737cC25ac68aEccEC97d5f";
const DEFAULT_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export const appConfig = {
  chainId: toNumber(import.meta.env.VITE_CHAIN_ID, 8453),
  rpcUrl: import.meta.env.VITE_RPC_URL as string | undefined,
  relayApiKey: import.meta.env.VITE_GELATO_RELAY_API_KEY ?? "",
  target: (import.meta.env.VITE_PERMIT_SWAP_PAY_FEE_NATIVE ?? DEFAULT_CONTRACT) as Address,
  token: (import.meta.env.VITE_PERMIT_TOKEN ?? import.meta.env.VITE_USDC ?? DEFAULT_USDC) as Address,
  gasLimit: toBigInt(import.meta.env.VITE_GAS_LIMIT, 800_000n),
  feeBufferBps: toBigInt(import.meta.env.VITE_FEE_BUFFER_BPS, 2000n),
  permitDeadlineSeconds: toNumber(import.meta.env.VITE_PERMIT_DEADLINE_SEC, 30 * 60),
  swapDeadlineSeconds: toNumber(import.meta.env.VITE_SWAP_DEADLINE_SEC, 20 * 60),
  swapMinEthOut: toWei(import.meta.env.VITE_SWAP_MIN_ETH_OUT, 0n),
  highPriority: import.meta.env.VITE_GELATO_HIGH_PRIORITY === "true",
  statusPolls: toNumber(import.meta.env.VITE_STATUS_POLL_MAX_ATTEMPTS, 12),
  statusIntervalMs: toNumber(import.meta.env.VITE_STATUS_POLL_INTERVAL_MS, 5000),
};
