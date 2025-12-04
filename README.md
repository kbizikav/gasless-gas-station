### Deploy PermitSwapPayFeeNative

- Script: `script/DeployPermitSwapPayFeeNative.s.sol`
- Env (from `.env`): `PRIVATE_KEY`, `USDC`, `UNIVERSAL_ROUTER`, `WETH`, `POOL_FEE`; pass `--rpc-url` manually.
- Deploys `PermitSwapPayFeeNative` configured with the provided addresses and pool fee.

```shell
forge script script/DeployPermitSwapPayFeeNative.s.sol:DeployPermitSwapPayFeeNative \
  --rpc-url $MAINNET_RPC_URL --broadcast
```
