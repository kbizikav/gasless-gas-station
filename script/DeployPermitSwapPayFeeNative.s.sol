// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {PermitSwapPayFeeNative} from "../src/PermitSwapPayFeeNative.sol";

/// @notice Deploys PermitSwapPayFeeNative with addresses/pool fee pulled from env vars.
contract DeployPermitSwapPayFeeNative is Script {
    struct Env {
        address usdc;
        address universalRouter;
        address weth;
        uint24 poolFee;
        uint256 privateKey;
    }

    function run() external returns (PermitSwapPayFeeNative deployed) {
        Env memory env = _loadEnv();

        vm.startBroadcast(env.privateKey);
        deployed = new PermitSwapPayFeeNative(env.usdc, env.universalRouter, env.weth, env.poolFee);
        vm.stopBroadcast();
    }

    function _loadEnv() internal view returns (Env memory env) {
        uint256 poolFeeRaw = vm.envUint("POOL_FEE");
        require(poolFeeRaw <= type(uint24).max, "pool fee too large");

        env.usdc = vm.envAddress("USDC");
        env.universalRouter = vm.envAddress("UNIVERSAL_ROUTER");
        env.weth = vm.envAddress("WETH");
        env.poolFee = uint24(poolFeeRaw);
        env.privateKey = vm.envUint("PRIVATE_KEY");
    }
}
