# Gelato Gasless Gas Station

Demo dapp showing how to swap USDC to native ETH on Base mainnet without the user holding gas. It uses an EIP-2612 permit to pull USDC, swaps through the Uniswap Universal Router, pays Gelato relay fees in native ETH, and forwards the leftover ETH to the caller. The onchain logic lives in `src/PermitSwapPayFeeNative.sol`; a Vite + React frontend wraps the flow.

## Frontend

- Install deps once: `npm install`
- Create `frontend/.env` with at least `VITE_GELATO_RELAY_API_KEY=<your_key>`. Optional overrides:
  - `VITE_PERMIT_SWAP_PAY_FEE_NATIVE` (target contract, defaults to Base mainnet deployment)
  - `VITE_PERMIT_TOKEN` or `VITE_USDC` (ERC20 with permit, defaults to Base USDC)
  - `VITE_RPC_URL`, `VITE_CHAIN_ID` (defaults: Base mainnet), `VITE_SWAP_MIN_ETH_OUT`, `VITE_GAS_LIMIT`, `VITE_FEE_BUFFER_BPS`
- Run dev server: `npm run dev` (opens Vite preview pointing at `frontend/`)
- Build/preview: `npm run build` then `npm run preview`
- In the UI, connect a Base wallet with USDC, enter an amount, and submit to relay the permit + swap through Gelato.

## Deploy PermitSwapPayFeeNative

- Script: `script/DeployPermitSwapPayFeeNative.s.sol`
- Env (from `.env`): `PRIVATE_KEY`, `USDC`, `UNIVERSAL_ROUTER`, `WETH`, `POOL_FEE`; pass `--rpc-url` manually.
- Deploys `PermitSwapPayFeeNative` configured with the provided addresses and pool fee.

```shell
forge script script/DeployPermitSwapPayFeeNative.s.sol:DeployPermitSwapPayFeeNative \
  --rpc-url $MAINNET_RPC_URL --broadcast
```
