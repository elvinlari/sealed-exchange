// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*──────────────────────────────────────────────────────────────────────────────
 Vault — Shielded balance engine 

  • Per trader*asset:  available / reservedAgg (euint64)
  • Per trader*asset*market*batch: precise reserve bucket (euint64)
  • Only approved market contracts may reserve/release/settle
  • onDepositFromToken
  • No plaintext amounts in events; amounts never emitted

  Pair with:
   - ConfidentialERC20 for private tokens
   - MarketPair (per pair) for order intake/batching/finalization
──────────────────────────────────────────────────────────────────────────────*/

import { FHE, euint64, ebool, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { AccessControlEnumerable } from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import { IConfidentialERC20 } from "./IConfidentialERC20.sol";


abstract contract ReentrancyGuard {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED     = 2;
    uint256 private _status = _NOT_ENTERED;
    modifier nonReentrant() {
        require(_status != _ENTERED, "REENTRANCY");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}

contract Vault is SepoliaConfig, ReentrancyGuard, AccessControlEnumerable {
    /*───────────────────────────────────────────────────────────*
     *                         Admin & ACL                       *
     *───────────────────────────────────────────────────────────*/
    address public admin;
    bytes32 public constant AUDITOR_ROLE = keccak256("AUDITOR_ROLE");

    modifier onlyAdmin() { require(msg.sender == admin, "NOT_ADMIN"); _; }
    modifier onlyAuditor() { require(hasRole(AUDITOR_ROLE, msg.sender), "NOT_AUDITOR"); _; }


    event AdminChanged(address indexed oldAdmin, address indexed newAdmin);
    event MarketApproved(address indexed market, bool approved);

    constructor() {
        admin = msg.sender;
        emit AdminChanged(address(0), msg.sender);
    }

    function setAdmin(address next) external onlyAdmin {
        emit AdminChanged(admin, next);
        admin = next;
    }

    // grant AUDITOR_ROLE to an address
    function grantAuditorRole(address auditor) external onlyAdmin {
        _grantRole(AUDITOR_ROLE, auditor);
    }

    // revoke AUDITOR_ROLE from an address
    function revokeAuditorRole(address auditor) external onlyAdmin {
        _revokeRole(AUDITOR_ROLE, auditor);
    }    

    /*───────────────────────────────────────────────────────────*
     *                        Asset Registry                     *
     *───────────────────────────────────────────────────────────*/
    struct Asset {
        address token;     // confidential token address (zUSDC, zETH, etc.)
        bool    enabled;
        bool    paused;    // deposit/withdraw pause
        bool    isNumeraire;
    }

    // assetId suggestion: keccak256("zUSDC") etc.
    mapping(bytes32 => Asset) public assets;

    // Approved market contracts that can reserve/release/settle
    mapping(address => bool) public isMarket;
    modifier onlyMarket() { require(isMarket[msg.sender], "NOT_MARKET"); _; }

    // Track known asset ids for enumeration
    bytes32[] private _assetIds;
    mapping(bytes32 => bool) private _assetExists;
    // Track approved markets for enumeration
    address[] private _markets;
    mapping(address => uint256) private _marketIndexPlus1; // idx+1, 0 means not present

    event AssetRegistered(bytes32 indexed assetId, address token, bool isNumeraire);
    event AssetStatus(bytes32 indexed assetId, bool enabled, bool paused);

    // Register or update an asset. Overwrites if already present.
    function registerAsset(bytes32 assetId, address token, bool isNumeraire) external onlyAdmin {
        require(token != address(0), "BAD_TOKEN");

        bool isNew = !_assetExists[assetId];
        assets[assetId] = Asset({ token: token, enabled: true, paused: false, isNumeraire: isNumeraire });

        if (isNew) {
            _assetExists[assetId] = true;
            _assetIds.push(assetId);
        }

        emit AssetRegistered(assetId, token, isNumeraire);
    }

    function setAssetStatus(bytes32 assetId, bool enabled, bool paused) external onlyAdmin {
        Asset storage a = assets[assetId];
        a.enabled = enabled;
        a.paused  = paused;
        emit AssetStatus(assetId, enabled, paused);
    }

    function setMarketApproved(address market, bool approved) external onlyAdmin {
        require(market != address(0), "BAD_MARKET");
        bool old = isMarket[market];
        if (approved && !old) {
            isMarket[market] = true;
            // add
            _markets.push(market);
            _marketIndexPlus1[market] = _markets.length; // store idx+1
            emit MarketApproved(market, true);
        } else if (!approved && old) {
            isMarket[market] = false;
            // remove via swap-and-pop
            uint256 idxPlus1 = _marketIndexPlus1[market];
            if (idxPlus1 != 0) {
                uint256 idx = idxPlus1 - 1;
                uint256 last = _markets.length - 1;
                if (idx != last) {
                    address lastAddr = _markets[last];
                    _markets[idx] = lastAddr;
                    _marketIndexPlus1[lastAddr] = idx + 1;
                }
                _markets.pop();
                _marketIndexPlus1[market] = 0;
            }
            emit MarketApproved(market, false);
        }
    }


    /*───────────────────────────────────────────────────────────*
     *                        Encrypted Ledger                   *
     *───────────────────────────────────────────────────────────*
     *  Per trader*asset:
     *    available  : free balance
     *    reservedAgg: total locked across batches
     *
     *  Per trader*asset*market*batch:
     *    bucketReserved: precise lock for a given (market,batch)
     *───────────────────────────────────────────────────────────*/
    mapping(address => mapping(bytes32 => euint64)) public available;
    mapping(address => mapping(bytes32 => euint64)) public reservedAgg;

    mapping(address => mapping(bytes32 => mapping(address => mapping(uint64 => euint64))))
        public bucketReserved;

    /*───────────────────────────────────────────────────────────*
     *                            Events                         *
     *───────────────────────────────────────────────────────────*/
    uint256 internal constant _PH = type(uint256).max; // placeholder avoids leaking values
    event Deposit(address indexed trader, bytes32 indexed assetId);
    event Withdraw(address indexed trader, bytes32 indexed assetId);

    event Reserved(
        address indexed trader,
        bytes32 indexed assetId,
        address indexed market,
        uint64 batchId,
        bytes32 eAmtHash
    );
    event Released(
        address indexed trader,
        bytes32 indexed assetId,
        address indexed market,
        uint64 batchId,
        bytes32 eAmtHash
    );
    event SettledBuy(
        address indexed buyer,
        address indexed market,
        uint64  batchId,
        bytes32 baseFillHash,
        bytes32 quoteDebitHash
    );
    event SettledSell(
        address indexed seller,
        address indexed market,
        uint64  batchId,
        bytes32 baseDebitHash,
        bytes32 quoteCreditHash
    );

    /*───────────────────────────────────────────────────────────*
     *                    User Edge: Deposit/Withdraw            *
     *───────────────────────────────────────────────────────────*/

    // --- View preflight used by token ---
    function isAcceptingDeposits(bytes32 assetId) external view returns (bool) {
        Asset memory a = assets[assetId];
        return a.enabled && !a.paused;
    }

    // Restrict callback to the registered token of this asset
    error NotAssetToken();
    error AssetDisabled();

    modifier onlyAssetToken(bytes32 assetId) {
        if (msg.sender != assets[assetId].token) revert NotAssetToken();
        _;
    }

    /// Deposit: Called by the token in the same tx after moving funds owner -> vault.
    function onDepositFromToken(address owner, bytes32 assetId, euint64 amt)
        external
        onlyAssetToken(assetId) nonReentrant
    {
        Asset memory a = assets[assetId];
        if (!a.enabled || a.paused) revert AssetDisabled();
        
        // add to available
        available[owner][assetId] = FHE.add(available[owner][assetId], amt);

        _allowLedgerView(available[owner][assetId], owner);

        emit Deposit(owner, assetId);
    }

    // Withdraw encrypted amount back to caller. Uses private compare (constant-time).
    function withdraw(
        bytes32 assetId,
        externalEuint64 encAmount,
        bytes calldata inputProof
    ) external nonReentrant {
        Asset memory a = assets[assetId];
        require(a.enabled && !a.paused, "ASSET_DISABLED");

        // 1) Reconstruct requested amount IN THE VAULT SCOPE
        euint64 need = FHE.fromExternal(encAmount, inputProof);

        // 2) Private compare against available balance
        euint64 curA = available[msg.sender][assetId];
        ebool  ok    = FHE.le(need, curA);
        euint64 spend = FHE.select(ok, need, FHE.asEuint64(0));

        // 3) Deduct in constant time
        available[msg.sender][assetId] = FHE.sub(curA, spend);
        _allowLedgerView(available[msg.sender][assetId], msg.sender);

        // 4) Let the token use the ciphertext, then push to user
        FHE.allow(spend, a.token);
        FHE.allowThis(spend);
        IConfidentialERC20(a.token).transfer(msg.sender, spend);

        emit Withdraw(msg.sender, assetId);
    }

    /*───────────────────────────────────────────────────────────*
     *                Market API: Reserve / Release              *
     *───────────────────────────────────────────────────────────*/

    //Reserve funds for a batch (called by MarketPair on order submit).
    function reserveFor(
        address trader,
        bytes32 assetId,
        uint64  batchId,
        euint64 eAmt
    ) external onlyMarket nonReentrant returns (euint64) {
        Asset memory a = assets[assetId];
        require(a.enabled, "ASSET_DISABLED");

        // ok = (available >= eAmt)
        euint64 curA = available[trader][assetId];
        ebool ok = FHE.le(eAmt, curA);
        euint64 spend = FHE.select(ok, eAmt, FHE.asEuint64(0));

        // Move available -> reservedAgg
        available[trader][assetId]  = FHE.sub(curA, spend);
        reservedAgg[trader][assetId]= FHE.add(reservedAgg[trader][assetId], spend);

        // Bucket add -> trader*asset*market*batch
        euint64 curB = FHE.add(bucketReserved[trader][assetId][msg.sender][batchId], FHE.asEuint64(0));
        bucketReserved[trader][assetId][msg.sender][batchId] = FHE.add(curB, spend);

        _allowLedgerView(available[trader][assetId], trader);
        _allowLedgerView(reservedAgg[trader][assetId], trader);
        _allowLedgerView(bucketReserved[trader][assetId][msg.sender][batchId], trader);

        euint64 ret = FHE.add(bucketReserved[trader][assetId][msg.sender][batchId], FHE.asEuint64(0));
        FHE.allow(ret, msg.sender);
        FHE.allowThis(ret);

        emit Reserved(trader, assetId, msg.sender, batchId, _hashCipher(spend));

        return ret;
    }

    // Release (unused or cancel) a reserved amount back to available.
    function releaseFor(
        address trader,
        bytes32 assetId,
        uint64  batchId,
        euint64 eAmt
    ) external onlyMarket nonReentrant {
        Asset memory a = assets[assetId];
        require(a.enabled, "ASSET_DISABLED");

        euint64 curResAgg = reservedAgg[trader][assetId];
        euint64 curB      = bucketReserved[trader][assetId][msg.sender][batchId];

        // Take min to stay constant-time safe: release = min(eAmt, curB)
        ebool okB   = FHE.le(eAmt, curB);
        euint64 rel = FHE.select(okB, eAmt, curB);

        // reservedAgg -= rel ; available += rel ; bucket -= rel
        reservedAgg[trader][assetId] = FHE.sub(curResAgg, rel);
        available[trader][assetId]   = FHE.add(available[trader][assetId], rel);
        bucketReserved[trader][assetId][msg.sender][batchId] = FHE.sub(curB, rel);

        _allowLedgerView(available[trader][assetId], trader);
        _allowLedgerView(reservedAgg[trader][assetId], trader);
        _allowLedgerView(bucketReserved[trader][assetId][msg.sender][batchId], trader);

        emit Released(trader, assetId, msg.sender, batchId, _hashCipher(rel));
    }

    /*───────────────────────────────────────────────────────────*
     *               Market API: Encrypted Settlement            *
     *───────────────────────────────────────────────────────────*/

    // Buyer leg: consume quote from reserved; credit base to available.
    //            eBaseFillSize and eQuoteDebit are already computed by the Market (FHE math).
    function settleBuy(
        address buyer,
        bytes32 baseAsset,
        bytes32 quoteAsset,
        uint64  batchId,
        euint64 eBaseFillSize,
        euint64 eQuoteDebit
    ) external onlyMarket nonReentrant {
        require(assets[baseAsset].enabled && assets[quoteAsset].enabled, "ASSET_DISABLED");

        // Consume quote from reserved/bucket
        euint64 spent = _consumeReserved(buyer, quoteAsset, msg.sender, batchId, eQuoteDebit);

        // Credit base to available
        available[buyer][baseAsset] = FHE.add(available[buyer][baseAsset], eBaseFillSize);
        _allowLedgerView(available[buyer][baseAsset], buyer);

        emit SettledBuy(buyer, msg.sender, batchId, _hashCipher(eBaseFillSize), _hashCipher(spent));
    }

    // Seller leg: consume base from reserved; credit quote to available.
    function settleSell(
        address seller,
        bytes32 baseAsset,
        bytes32 quoteAsset,
        uint64  batchId,
        euint64 eBaseDebit,
        euint64 eQuoteCredit
    ) external onlyMarket nonReentrant {
        require(assets[baseAsset].enabled && assets[quoteAsset].enabled, "ASSET_DISABLED");

        // Consume base from reserved/bucket
        euint64 spent = _consumeReserved(seller, baseAsset, msg.sender, batchId, eBaseDebit);

        // Credit quote to available
        available[seller][quoteAsset] = FHE.add(available[seller][quoteAsset], eQuoteCredit);
        _allowLedgerView(available[seller][quoteAsset], seller);

        emit SettledSell(seller, msg.sender, batchId, _hashCipher(spent), _hashCipher(eQuoteCredit));
    }

    /*───────────────────────────────────────────────────────────*
     *                     Minimal Read Helpers                  *
     *───────────────────────────────────────────────────────────*/

    function selfGetBalancesForCaller(bytes32 assetId)
        external
        view
        returns (euint64 v, euint64 r)
    {  
        v = available[msg.sender][assetId];
        r = reservedAgg[msg.sender][assetId];
        return (v, r);
    }

    function selfGetBucketReservedForCaller(
        bytes32 assetId, 
        address market, 
        uint64 batchId
    ) external returns (euint64 eAmt) {
        euint64 cur = bucketReserved[msg.sender][assetId][market][batchId];
        euint64 safe = FHE.add(cur, FHE.asEuint64(0));
        bucketReserved[msg.sender][assetId][market][batchId] = safe;
        FHE.allow(safe, msg.sender);
        return safe;
    }

    function getBalancesForCaller(address trader, bytes32 assetId)
        external
        onlyAuditor
        returns (euint64 eAvailable, euint64 eReservedAgg)
    {
        FHE.allow(available[trader][assetId], msg.sender);
        FHE.allow(reservedAgg[trader][assetId], msg.sender);
        return (available[trader][assetId], reservedAgg[trader][assetId]);
    }

    function getBucketReservedForCaller(
        address trader,
        bytes32 assetId, 
        address market, 
        uint64 batchId
    ) external onlyAuditor returns (euint64 eAmt) {
        euint64 cur = bucketReserved[trader][assetId][market][batchId];
        euint64 safe = FHE.add(cur, FHE.asEuint64(0));
        bucketReserved[trader][assetId][market][batchId] = safe;
        FHE.allow(safe, msg.sender);
        return safe;
    }

    /*───────────────────────────────────────────────────────────*
     *                           Internals                       *
     *───────────────────────────────────────────────────────────*/
    function _consumeReserved(
        address trader,
        bytes32 assetId,
        address market,
        uint64  batchId,
        euint64 eAmt
    ) internal returns (euint64 spend) {
        // Current states
        euint64 curRes = reservedAgg[trader][assetId];
        euint64 curB   = bucketReserved[trader][assetId][market][batchId];

        // spendAgg = min(eAmt, curRes)
        ebool okAgg   = FHE.le(eAmt, curRes);
        euint64 spendAgg = FHE.select(okAgg, eAmt, curRes);

        // spendB = min(eAmt, curB)
        ebool okB   = FHE.le(eAmt, curB);
        euint64 spendB = FHE.select(okB, eAmt, curB);

        // spend = min(spendAgg, spendB)
        ebool sCmp  = FHE.le(spendAgg, spendB);
        spend = FHE.select(sCmp, spendAgg, spendB);

        // Apply
        reservedAgg[trader][assetId] = FHE.sub(curRes, spend);
        bucketReserved[trader][assetId][market][batchId] = FHE.sub(curB, spend);

        _allowLedgerView(reservedAgg[trader][assetId], trader);
        _allowLedgerView(bucketReserved[trader][assetId][market][batchId], trader);
    }


    function _hashCipher(euint64) internal pure returns (bytes32) {
        // Hashing an euint64 value is a placeholder; events intentionally avoid amounts.
        // Here we just return a constant to avoid leaking structure; keep events value-free.
        return bytes32(uint256(_PH));
    }

    function _allowLedgerView(euint64 v, address who) internal {
        FHE.allowThis(v);
        FHE.allow(v, who);
    }


    /*───────────────────────────────────────────────────────────*
     *                         Catalog                       *
     *───────────────────────────────────────────────────────────*/

    // ===== Asset catalog =====

    function getAsset(bytes32 assetId) external view returns (
        address token,
        bool enabled,
        bool paused,
        bool isNumeraire
    ) {
        Asset memory a = assets[assetId];
        return (a.token, a.enabled, a.paused, a.isNumeraire);
    }

    function assetCount() external view returns (uint256) {
        return _assetIds.length;
    }

    function assetAt(uint256 index) external view returns (bytes32 assetId) {
        require(index < _assetIds.length, "OUT_OF_BOUNDS");
        return _assetIds[index];
    }

    // Paged listing to keep responses small
    function listAssets(uint256 offset, uint256 limit)
        external
        view
        returns (bytes32[] memory ids, address[] memory tokens, bool[] memory enabled, bool[] memory paused, bool[] memory isNumeraire)
    {
        uint256 n = _assetIds.length;
        if (offset > n) offset = n;
        if (offset + limit > n) limit = n - offset;

        ids = new bytes32[](limit);
        tokens = new address[](limit);
        enabled = new bool[](limit);
        paused = new bool[](limit);
        isNumeraire = new bool[](limit);

        for (uint256 i = 0; i < limit; i++) {
            bytes32 id = _assetIds[offset + i];
            Asset memory a = assets[id];
            ids[i] = id;
            tokens[i] = a.token;
            enabled[i] = a.enabled;
            paused[i] = a.paused;
            isNumeraire[i] = a.isNumeraire;
        }
    }

    // ===== Markets catalog =====

    function marketCount() external view returns (uint256) {
        return _markets.length;
    }

    function marketAt(uint256 index) external view returns (address) {
        require(index < _markets.length, "OUT_OF_BOUNDS");
        return _markets[index];
    }

    function listMarkets(uint256 offset, uint256 limit) external view returns (address[] memory markets) {
        uint256 n = _markets.length;
        if (offset > n) offset = n;
        if (offset + limit > n) limit = n - offset;

        markets = new address[](limit);
        for (uint256 i = 0; i < limit; i++) {
            markets[i] = _markets[offset + i];
        }
    }

    // ===== Auditors catalog =====

    function auditorCount() external view onlyAdmin returns (uint256) {
        return getRoleMemberCount(AUDITOR_ROLE);
    }

    function auditorAt(uint256 index) external view onlyAdmin returns (address) {
        require(index < getRoleMemberCount(AUDITOR_ROLE), "OUT_OF_BOUNDS");
        return getRoleMember(AUDITOR_ROLE, index);
    }

    function listAuditors(uint256 offset, uint256 limit)
        external
        view
        onlyAdmin
        returns (address[] memory page, uint256 total)
    {
        total = getRoleMemberCount(AUDITOR_ROLE);
        if (limit == 0) limit = 10;

        if (offset >= total) {
            // empty page but still return total so the client knows the size
            page = new address[](0);
            return (page, total);
        }

        uint256 end = offset + limit;
        if (end > total) end = total;

        uint256 len = end - offset;
        page = new address[](len);

        for (uint256 i = 0; i < len; i++) {
            page[i] = getRoleMember(AUDITOR_ROLE, offset + i);
        }
    }


}
