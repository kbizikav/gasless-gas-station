// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IUniversalRouter} from "@uniswap/universal-router/contracts/interfaces/IUniversalRouter.sol";
import {Commands} from "@uniswap/universal-router/contracts/libraries/Commands.sol";
import {Constants} from "@uniswap/universal-router/contracts/libraries/Constants.sol";
import {GelatoRelayContext} from "@gelatonetwork/relay-context/contracts/GelatoRelayContext.sol";
import {NATIVE_TOKEN} from "@gelatonetwork/relay-context/contracts/constants/Tokens.sol";

/// @notice Pulls USDC via permit, swaps to ETH through the Uniswap Universal Router,
///         pays Gelato in native ETH, and forwards the remainder to the user.
contract PermitSwapPayFeeNative is GelatoRelayContext {
    using SafeERC20 for IERC20;

    IERC20Permit public immutable usdcPermit;
    IERC20 public immutable usdc;
    IUniversalRouter public immutable router;
    address public immutable weth;
    uint24 public immutable poolFee;

    struct PermitData {
        address owner;
        uint256 value;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    struct SwapParams {
        uint256 minEthOut;
        uint256 deadline;
    }

    constructor(address _usdc, address _router, address _weth, uint24 _poolFee) {
        require(_usdc != address(0), "usdc zero");
        require(_router != address(0), "router zero");
        require(_weth != address(0), "weth zero");
        require(_poolFee != 0, "pool fee zero");

        usdcPermit = IERC20Permit(_usdc);
        usdc = IERC20(_usdc);
        router = IUniversalRouter(_router);
        weth = _weth;
        poolFee = _poolFee;
    }

    /// @notice Executes permit, pulls USDC, swaps to ETH, pays Gelato's native fee, and sends the remainder to the owner.
    /// @param p EIP-2612 permit payload for USDC.
    /// @param s Swap parameters (minimum ETH out and swap deadline).
    /// @param maxFeeEth Max native fee (in wei) allowed to pay Gelato for this call.
    function permitSwapAndPayFeeNative(
        PermitData calldata p,
        SwapParams calldata s,
        uint256 maxFeeEth
    ) external payable onlyGelatoRelay {
        // Ensure relay is charging native fees (accept both canonical and zero-address markers).
        address feeToken = _getFeeToken();
        require(feeToken == NATIVE_TOKEN || feeToken == address(0), "fee token not native");

        // Permit and pull USDC from the owner.
        usdcPermit.permit(p.owner, address(this), p.value, p.deadline, p.v, p.r, p.s);
        usdc.safeTransferFrom(p.owner, address(this), p.value);

        // Swap pulled USDC to ETH via Universal Router.
        _swapUsdcToEth(p.value, s.minEthOut, s.deadline);

        // Pay Gelato from the freshly received ETH (capped).
        if (feeToken == NATIVE_TOKEN) {
            _transferRelayFeeCapped(maxFeeEth);
        } else {
            uint256 fee = _getFee();
            require(fee <= maxFeeEth, "fee gt max");
            (bool ok,) = _getFeeCollector().call{value: fee}("");
            require(ok, "fee transfer failed");
        }

        // Send remaining ETH to the user.
        uint256 leftover = address(this).balance;
        if (leftover > 0) {
            (bool sent,) = p.owner.call{value: leftover}("");
            require(sent, "eth send failed");
        }
    }

    function _swapUsdcToEth(uint256 amountIn, uint256 minEthOut, uint256 deadline) internal {
        require(amountIn > 0, "amount zero");
        require(deadline >= block.timestamp, "deadline passed");

        // Build v3 path USDC -> WETH.
        bytes memory path = abi.encodePacked(address(usdc), poolFee, weth);

        // V3 exact input swap + unwrap WETH.
        bytes memory commands =
            abi.encodePacked(bytes1(uint8(Commands.V3_SWAP_EXACT_IN)), bytes1(uint8(Commands.UNWRAP_WETH)));

        bytes[] memory inputs = new bytes[](2);
        inputs[0] = abi.encode(Constants.ADDRESS_THIS, amountIn, minEthOut, path, false);
        inputs[1] = abi.encode(Constants.MSG_SENDER, minEthOut);

        // Fund the router with USDC; payerIsUser=false keeps payment internal to the router.
        usdc.safeTransfer(address(router), amountIn);
        router.execute(commands, inputs, deadline);
    }

    receive() external payable {}
}
