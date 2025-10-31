// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { euint64 } from "@fhevm/solidity/lib/FHE.sol";

interface IConfidentialERC20 {
    function transfer(address to, euint64 amount) external returns (bool);
}
