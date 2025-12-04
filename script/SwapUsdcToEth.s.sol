// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAllowanceTransfer} from "@uniswap/permit2/src/interfaces/IAllowanceTransfer.sol";
import {IUniversalRouter} from "@uniswap/universal-router/contracts/interfaces/IUniversalRouter.sol";
import {Commands} from "@uniswap/universal-router/contracts/libraries/Commands.sol";
import {Constants} from "@uniswap/universal-router/contracts/libraries/Constants.sol";

/// @notice Swaps USDC to native ETH through Uniswap v3 via the Universal Router (all addresses pulled from env).
contract SwapUsdcToEth is Script {
    uint48 internal constant PERMIT2_APPROVAL_EXPIRATION = type(uint48).max;
    uint256 internal constant USDC_AMOUNT_IN = 100; // USDC amount (6 decimals assumed)
    uint256 internal constant MIN_ETH_OUT = 0; // accept any amount of ETH

    struct Env {
        IUniversalRouter router;
        IAllowanceTransfer permit2;
        IERC20 usdc;
        address weth;
        uint24 poolFee;
        uint256 privateKey;
        address user;
    }

    /// @notice Swaps USDC (amount hardcoded) to ETH using env-provided router/pool.
    function run() external {
        Env memory env = _loadEnv();
        _swap(env, USDC_AMOUNT_IN, MIN_ETH_OUT);
    }

    function _swap(Env memory env, uint256 usdcAmountIn, uint256 minEthOut) internal {
        require(env.poolFee != 0, "fee zero");
        require(usdcAmountIn > 0, "amount zero");
        require(usdcAmountIn <= type(uint160).max, "amount too large");

        vm.startBroadcast(env.privateKey);

        _ensureApprovals(env, usdcAmountIn);

        bytes memory path = abi.encodePacked(address(env.usdc), env.poolFee, env.weth);

        bytes memory commands =
            abi.encodePacked(bytes1(uint8(Commands.V3_SWAP_EXACT_IN)), bytes1(uint8(Commands.UNWRAP_WETH)));

        bytes[] memory inputs = new bytes[](2);
        inputs[0] = abi.encode(Constants.ADDRESS_THIS, usdcAmountIn, minEthOut, path, true);
        inputs[1] = abi.encode(Constants.MSG_SENDER, minEthOut);

        env.router.execute(commands, inputs, block.timestamp + 15 minutes);

        vm.stopBroadcast();
    }

    function _ensureApprovals(Env memory env, uint256 amountIn) internal {
        uint256 currentTokenAllowance = env.usdc.allowance(env.user, address(env.permit2));
        if (currentTokenAllowance < amountIn) {
            env.usdc.approve(address(env.permit2), type(uint256).max);
        }

        (uint160 permitted, uint48 expiration,) = env.permit2.allowance(env.user, address(env.usdc), address(env.router));
        if (permitted < uint160(amountIn) || expiration < block.timestamp) {
            env.permit2.approve(address(env.usdc), address(env.router), type(uint160).max, PERMIT2_APPROVAL_EXPIRATION);
        }
    }

    function _loadEnv() internal view returns (Env memory env) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        env.router = IUniversalRouter(vm.envAddress("UNIVERSAL_ROUTER"));
        env.permit2 = IAllowanceTransfer(vm.envAddress("PERMIT2"));
        env.usdc = IERC20(vm.envAddress("USDC"));
        env.weth = vm.envAddress("WETH");
        env.poolFee = uint24(vm.envUint("POOL_FEE"));
        env.privateKey = pk;
        env.user = vm.addr(pk);
    }
}
