## Foundry

**Foundry is a blazing fast, portable and modular toolkit for Ethereum application development written in Rust.**

Foundry consists of:

- **Forge**: Ethereum testing framework (like Truffle, Hardhat and DappTools).
- **Cast**: Swiss army knife for interacting with EVM smart contracts, sending transactions and getting chain data.
- **Anvil**: Local Ethereum node, akin to Ganache, Hardhat Network.
- **Chisel**: Fast, utilitarian, and verbose solidity REPL.

## Documentation

https://book.getfoundry.sh/

## Usage

### Build

```shell
$ forge build
```

### Test

```shell
$ forge test
```

### Format

```shell
$ forge fmt
```

### Swap USDC → ETH via Universal Router

- Script: `script/SwapUsdcToEth.s.sol`
- Env (from `.env`): `PRIVATE_KEY`, `UNIVERSAL_ROUTER`, `PERMIT2`, `USDC`, `WETH`, `POOL_FEE`; pass `--rpc-url` manually.
- Uses the env-provided router, tokens, and pool fee (v3 path encodes `USDC -> WETH`), with hardcoded `usdcAmountIn = 100` (6 decimals) and `minEthOut = 0`.

```shell
forge script script/SwapUsdcToEth.s.sol:SwapUsdcToEth \
  --sig "run()" \
  --rpc-url $MAINNET_RPC_URL --broadcast
```

- Amounts are fixed in the script; adjust there if needed.

### Gas Snapshots

```shell
$ forge snapshot
```

### Anvil

```shell
$ anvil
```

### Deploy

```shell
$ forge script script/Counter.s.sol:CounterScript --rpc-url <your_rpc_url> --private-key <your_private_key>
```

### Cast

```shell
$ cast <subcommand>
```

### Help

```shell
$ forge --help
$ anvil --help
$ cast --help
```
