import { Interface } from "ethers";

const data = "0x9de3392c242a2c524e17991825056858ae9dce5c2e34e1268b000000000000007a6905000000000000000000000000005fc8d32690cc91d4c39d9d3abcbd16989f875707"; // your revert data

const iface = new Interface([
  "error CallerNotMarket(address caller)",
  "error NotRegisteredMarket(address market)",
  "error NotApprovedAsset(bytes32 asset)",
  "error InsufficientReserved(address user, bytes32 asset, uint64 want, uint64 have)",
  "error BatchMismatch(uint64 want, uint64 have)",
  "error PhaseClosed()",
  "error ZeroFill()",
]);

console.log(iface.parseError(data));
