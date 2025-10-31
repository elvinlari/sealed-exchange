// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { euint64 } from "@fhevm/solidity/lib/FHE.sol";

interface IVaultNotify { 
    function onDepositFromToken(address owner, bytes32 assetId, euint64 amt) external;
}

interface IVaultView {
    function isAcceptingDeposits(bytes32 assetId) external view returns (bool);
}

interface IVaultMarketPair {
    // Moves user funds from available -> reservedAgg and bucketReserved[trader][asset][market][batch]
    function reserveFor(address trader, bytes32 assetId, uint64 batchId, euint64 eAmt) external returns (euint64);

    // Releases reserved funds for a trader from bucketReserved[trader][asset][market][batch] -> available
    function releaseFor(address trader, bytes32 assetId, uint64 batchId, euint64 eAmt) external;

    // Buyer leg: credit base, consume quote from reserved
    function settleBuy(
        address buyer,
        bytes32 baseAsset,
        bytes32 quoteAsset,
        uint64  batchId,
        euint64 eBaseFillSize,   // base credited to buyer
        euint64 eQuoteDebit      // quote debited from buyer reserved
    ) external;

    // Seller leg: consume base from reserved, credit quote
    function settleSell(
        address seller,
        bytes32 baseAsset,
        bytes32 quoteAsset,
        uint64  batchId,
        euint64 eBaseDebit,      // base debited from seller reserved
        euint64 eQuoteCredit     // quote credited to seller
    ) external;
}