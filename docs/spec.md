# USDC→ETH ガスレススワップ設計書（ETH からガス相当を支払う）

## 1. ゴール / 要件

### 1.1 ビジネス・UX 要件

- ユーザーは **USDC しか持っていない状態** からスタート
- ユーザーは **1 回の署名（permit）＋ 1 回のボタンクリック**だけで、

  - USDC → ETH にスワップ
  - ETH の一部がガスコスト（＋サービス手数料）として差し引かれる
  - 残りの ETH がユーザーウォレットに入る

- ユーザー視点では **「ETH を持っていないのに、ETH を手に入れつつガスも払えた」** 体験になる
- アカウントアブストラクション（ERC-4337）は使わず、従来の EOA ウォレット（MetaMask 等）で利用可能

### 1.2 技術要件

- トランザクションの送信者は **Gelato Relay**（リレーアドレス）
- ガス代そのものは **リレーの ETH から支出**される
- コントラクト内で

  - USDC を pull
  - USDC を ETH に swap (Uniswap V3 の UniversalRouter を利用)
  - swap で得た ETH から **Gelato への fee（ETH）を支払う**

- Gelato との連携には `callWithSyncFee` ＋ `GelatoRelayContext` を利用

## 2. 全体アーキテクチャ

### 2.1 コンポーネント一覧

1. **フロントエンド dApp**

   - ユーザーに EIP-2612 permit 署名をさせる
   - Gelato Relay SDK で `callWithSyncFee` を発行
   - 見積もりレート（swap + fee）を表示

2. **USDC→ETH スワップコントラクト（PermitSwapPayFeeNative）**

   - `GelatoRelayContext` を継承
   - `permitSwapAndPayFeeNative()` を公開
   - 内部で：

     1. permit 実行
     2. USDC pull
     3. USDC → ETH swap (Uniswap V3)
     4. swap で得た ETH から Gelato への fee を支払う
     5. 残りの ETH をユーザーへ送付

3. **Gelato Relay**

   - フロントからの `callWithSyncFee` リクエストを受け取り
   - 自身の ETH から tx ガス代を払ってコントラクトを呼び出す
   - コントラクト内から送られてきた ETH fee を回収する

## 3. シーケンスフロー

### 3.1 オフチェーン

1. ユーザーが dApp で「USDC → ETH（ガスオンボード）」を選択
2. dApp が以下を計算

   - 入力：ユーザー指定の USDC amount（例: 100 USDC）
   - ルーターの見積もりで、USDC→ETH の期待値 `ethExpected`
   - Gelato の fee 見積もり（ETH 建て）`ethFeeEstimated`

3. dApp がユーザーに

   - 「100 USDC → 約 0.03 ETH、うち 0.002 ETH がガス・手数料として差し引かれ、最終的に 0.028 ETH 受け取り」
     を表示し、確認を取る

4. dApp がユーザーに **permit 署名**を要求

   - ドメイン：USDC（EIP-2612 対応）
   - spender：`PermitSwapPayFeeNative` コントラクトアドレス
   - value：100 USDC

5. 署名（`v,r,s`）と `owner, value, deadline, nonce` を取得して `PermitData` を構築

### 3.2 Relay リクエスト

6. フロントでコントラクトの calldata を生成

   - 関数：`permitSwapAndPayFeeNative(PermitData, SwapParams, uint256 maxFeeEth)`
   - `SwapParams`：

     - `minEthOut`（スリッページを考慮した最小 ETH）
     - `deadline`（swap 有効期限）

   - `maxFeeEth`：

     - `ethFeeEstimated` に安全マージンを足した値

7. Gelato Relay SDK で `callWithSyncFee` を発行

   - `feeToken = address(0)`（ネイティブ ETH）
   - `isRelayContext = true`
   - `gasLimit` を適切に指定

### 3.3 オンチェーン（tx 内部）

1. Gelato リレーアドレスが `PermitSwapPayFeeNative` コントラクトの `permitSwapAndPayFeeNative()` を呼び出す

2. コントラクト内部の処理順序：

   1. `onlyGelatoRelay` で呼び出し元が Gelato であることを確認
   2. `_getFeeToken()` が `address(0)`（ETH）であることをチェック
   3. `usdcPermit.permit(...)` 実行
   4. `transferFrom(owner → this, value)` で USDC をコントラクトへ
   5. USDC から ETH へ DEX で swap
   6. `address(this).balance` から fee 分の ETH を `_transferRelayFeeCapped(maxFeeEth)` で Gelato に送金
   7. 残りの ETH を `owner` に `transfer`（または `call{value: ...}`）する

3. tx 完了時：

   - ガス代は **リレー（Gelato）が負担し、その後 ETH fee で回収**
   - ユーザーは ETH 残高が増えている（USDC は減る）

---

## 4. スマートコントラクト仕様

### 4.1 インターフェイス概要

```solidity
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/draft-IERC20Permit.sol";
import {GelatoRelayContext} from "@gelatonetwork/relay-context/contracts/GelatoRelayContext.sol";
import {ISwapRouter} from "./ISwapRouter.sol"; // DEXごとにインターフェイス定義

contract PermitSwapPayFeeNative is GelatoRelayContext {
    IERC20Permit public immutable usdcPermit;
    IERC20 public immutable usdc;
    ISwapRouter public immutable router;
    address public immutable weth; // ルーターが扱う WETH アドレス

    constructor(address _usdc, address _router, address _weth) {
        usdcPermit = IERC20Permit(_usdc);
        usdc = IERC20(_usdc);
        router = ISwapRouter(_router);
        weth = _weth;
    }

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

    function permitSwapAndPayFeeNative(
        PermitData calldata p,
        SwapParams calldata s,
        uint256 maxFeeEth
    ) external payable onlyGelatoRelay {
        // 1. feeToken がネイティブかチェック
        require(_getFeeToken() == address(0), "Fee token must be native");

        // 2. permit
        usdcPermit.permit(
            p.owner,
            address(this),
            p.value,
            p.deadline,
            p.v,
            p.r,
            p.s
        );

        // 3. USDC pull
        usdc.transferFrom(p.owner, address(this), p.value);

        // 4. USDC -> ETH swap（例: V2ルーター）
        _swapUsdcToEth(p.value, s.minEthOut, s.deadline, p.owner);
        // この時点で:
        // - ETH の一部 or 全てがコントラクトにあり（ルーター実装による）
        // - 必要なら WETH unwrap する

        // 5. 現在の ETH 残高から fee を Gelato へ
        _transferRelayFeeCapped(maxFeeEth);

        // 6. 残り ETH をユーザーへ
        uint256 leftover = address(this).balance;
        if (leftover > 0) {
            (bool sent, ) = p.owner.call{value: leftover}("");
            require(sent, "ETH send failed");
        }
    }

    function _swapUsdcToEth(
        uint256 amountIn,
        uint256 minEthOut,
        uint256 deadline,
        address to
    ) internal {
        todo // DEX ルーターの swap 実装に応じて実装
    }

    receive() external payable {}
}
```

---

## 5. CLI 側の仕様（ざっくり）

### 5.1 permit 署名作成

- EIP-2612 準拠の typed data を用意し、`walletClient.signTypedData` 等で署名
- 必要な項目：

  - `owner`：ユーザーアドレス
  - `spender`：`PermitSwapPayFeeNative` アドレス
  - `value`：USDC 金額
  - `deadline`：署名有効期限
  - `nonce`：トークン側の `nonces(owner)` を事前に取得

### 5.2 fee 見積もり

- DEX ルーターから `USDC -> ETH` 見積もり取得
- Gelato SDK の fee 見積もり API から ETH 建てで `feeEstimate` を取得
- `maxFeeEth = feeEstimate * (1 + margin)` としてユーザーに表示

### 5.3 Relay リクエスト

```ts
import { GelatoRelay, CallWithSyncFeeRequest } from "@gelatonetwork/relay-sdk";
import { ethers } from "ethers";

const relay = new GelatoRelay();

const iface = new ethers.utils.Interface([
  "function permitSwapAndPayFeeNative((address owner,uint256 value,uint256 deadline,uint8 v,bytes32 r,bytes32 s),(uint256 minEthOut,uint256 deadline),uint256 maxFeeEth)",
]);

const data = iface.encodeFunctionData("permitSwapAndPayFeeNative", [
  permitData,
  swapParams,
  maxFeeEth,
]);

const request: CallWithSyncFeeRequest = {
  chainId,
  target: PERMIT_SWAP_CONTRACT,
  data,
  feeToken: ethers.constants.AddressZero, // ネイティブETH
  isRelayContext: true,
};

const resp = await relay.callWithSyncFee(
  request,
  { gasLimit: "500000" },
  apiKey
);
console.log("taskId:", resp.taskId);
```

---

## 6. セキュリティ・リスク・制約

1. **ガス支払の本質的制約**

   - Ethereum プロトコルの仕様上、tx のガスは常に tx sender（今回は Gelato）のネイティブ残高から事前ロックされる
   - したがって、完全に「swap 後の ETH からガスを払っている」わけではなく、
     **リレーが立て替え → 後で ETH fee で補填**という形になる

2. **onlyGelatoRelay**

   - `_transferRelayFee` を含む関数が誰からでも呼べると、
     攻撃者が「feeToken を意図しないトークンに設定して USDC/ETH を抜く」攻撃面が広がる
   - `onlyGelatoRelay` と `_getFeeToken() == address(0)` のチェックは必須

3. **スリッページ & price impact**

   - `minEthOut` をフロントでしっかり計算しないと、価格変動でユーザーが不利になる
   - `maxFeeEth` も同様に、過大にするとユーザーにとって高コストになる

4. **Reentrancy**

   - swap → fee 支払い → ETH 送金の流れで reentrancy の余地がないか検討
   - 必要であれば `nonReentrant` を利用
