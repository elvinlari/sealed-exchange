// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * Walrasian on-chain batch matcher (fhEVM)
 * - Public tick grid (tiny)
 * - Encrypted order sizes and all arithmetic (euint64)
 * - Finds p* fully on-chain (encrypted index + matched volume)
 * - Price-time settlement in a single finalize tx
 *
 * Tick prices:
 *   prices[t] = (QUOTE per 1 BASE) * 10^Q  where Q = quote token decimals (QSCALE)
 * Scales:
 *   BSCALE = 10^B where B = base token decimals
 *   RECIP_SCALE = 10^18 for price reciprocals
 * Conversions:
 *   baseRaw  = quoteRaw * BSCALE / priceScaled
 *   quoteRaw = baseRaw  * priceScaled / BSCALE
 */

import { FHE, euint64, ebool, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { IVaultMarketPair as IVault } from "./IVault.sol";

abstract contract ReentrancyGuard {
    uint256 private constant _NOT = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _s = _NOT;
    modifier nonReentrant() {
        require(_s != _ENTERED, "REENTRANCY");
        _s = _ENTERED;
        _;
        _s = _NOT;
    }
}

contract MarketPair is SepoliaConfig, ReentrancyGuard {
    /* ───────────────────────── Config / Constants ───────────────────────── */

    address public admin;
    modifier onlyAdmin() { require(msg.sender == admin, "NOT_ADMIN"); _; }


    uint64 public closeWindowSeconds; 

    uint8  public immutable MAX_TICKS;   // e.g., ≤128
    uint16 public immutable MAX_ORDERS;  // e.g., ≤256

    IVault public immutable vault;
    bytes32 public immutable BASE_ASSET;
    bytes32 public immutable QUOTE_ASSET;

    // prices[t] = quote per 1 base, scaled by QSCALE (10^quoteDecimals)
    uint64[] public prices;
    uint64[] public recip; // recip[i] = floor(BSCALE * RECIP_SCALE / prices[i])

    // QSCALE documents how prices[] were scaled; BSCALE is used in math
    uint64 public immutable QSCALE;  // 10^quoteDecimals 
    uint64 public immutable BSCALE;  // 10^baseDecimals (used in conversions)
    uint64 public immutable RECIP_SCALE;

    /* ───────────────────────── Batch State ───────────────────────── */

    uint64  public currentBatchId;
    euint64 public lastPIdxEnc; // encrypted previous clearing tick index
    euint64 private lastMatchedVol; // encrypted previous matched volume
    euint64 private selectedPriceEnc; // encrypted selected price at p*
    euint64 private selectedRecipEnc; // encrypted selected reciprocal at p*

    enum Side { BUY, SELL }

    struct Order {
        address trader;
        Side    side;
        uint8   tick;   // 0..MAX_TICKS-1
        euint64 qty;    // SELL: BASE raw; BUY: QUOTE raw
        bool    partialFill;
        bool    settled;
        bool    cancelled;
    }

    Order[] private _orders;
    
    // Queued orders scheduled for a specific future batch. These are imported
    // into _orders automatically when that batch becomes current.
    struct QueueOrder {
        address trader;
        Side    side;
        uint8   tick;        // 0..MAX_TICKS-1
        euint64 qty;         // SELL: BASE raw; BUY: QUOTE raw
        bool    partialFill; // allow partial fills
        bool    cancelled;   // allow cancelling queued orders before import
    }

    // Mapping of queueBatchId => list of queued orders for that batch
    mapping(uint64 => QueueOrder[]) private _queuedOrdersByBatch;

    // Per-tick encrypted accumulators (BASE units)
    euint64[] private _dAt; // demand per tick (converted BUY → BASE at their limit tick)
    euint64[] private _sAt; // supply per tick (SELL already in BASE)

    enum Phase { OPEN, FROZEN }
    Phase public phase;
    uint64 public closeTs;


    modifier onlyOpenAutoRoll() {
        if (phase == Phase.OPEN && block.timestamp >= closeTs) {
            phase = Phase.FROZEN;
            if (_orders.length == 0) {
                currentBatchId += 1;
                closeTs = uint64(block.timestamp + closeWindowSeconds);
                phase = Phase.OPEN;
            } else {
                revert("INTAKE_CLOSED");
            }
        }
        require(phase == Phase.OPEN, "BATCH_FROZEN");
        require(block.timestamp < closeTs, "INTAKE_CLOSED");
        _;
    }

    /* ───────────────────────── Events ───────────────────────── */

    event Submitted(address indexed trader, uint64 batchId, Side side, uint8 tick, uint256 orderId);
    event ClearingChosen(uint64 indexed batchId, euint64 pIdxEnc, euint64 matchedEnc, euint64 priceEnc, euint64 recipEnc);
    event Settled(uint64 indexed batchId, euint64 pIdxEnc);
    event Cancelled(address indexed trader, uint64 batchId, uint256 orderId);
    event CloseWindowUpdated(uint64 oldSeconds, uint64 newSeconds);

    /* ───────────────────────── Ctor ───────────────────────── */

    constructor(
        address vault_,
        bytes32 baseAssetId,
        bytes32 quoteAssetId,
        uint64  qscale_,                 // 10^quoteDecimals (how prices[] were scaled)
        uint64  bscale_,                 // 10^baseDecimals
        uint64[] memory tickPrices,      // strictly increasing, scaled by qscale_
        uint16 maxOrders_,
        uint8   lastPIdx_,
        uint64  recipScale_,
        uint64[] memory recip_,
        uint64  closeWindowSeconds_
    ) {
        require(vault_ != address(0), "BAD_VAULT");
        require(tickPrices.length > 1 && tickPrices.length <= 64, "BAD_TICKS");
        require(maxOrders_ > 0 && maxOrders_ <= 64, "BAD_MAX_ORDERS");

        admin       = msg.sender;
        vault       = IVault(vault_);
        BASE_ASSET  = baseAssetId;
        QUOTE_ASSET = quoteAssetId;

        QSCALE      = qscale_;
        BSCALE      = bscale_;
        MAX_TICKS   = uint8(tickPrices.length);
        MAX_ORDERS  = maxOrders_;
        RECIP_SCALE = recipScale_;

        prices      = tickPrices;
        recip       = recip_;
        for (uint256 i = 0; i < recip.length; ++i) {
            require(recip[i] > 0 && recip[i] <= type(uint64).max, "RECIP_OOB"); // fit price reciprocals in uint64
        }

        lastPIdxEnc = FHE.asEuint64(lastPIdx_);
        FHE.allowThis(lastPIdxEnc);

        selectedPriceEnc = FHE.asEuint64(prices[lastPIdx_]);
        FHE.allowThis(selectedPriceEnc);

        phase   = Phase.OPEN;
        closeWindowSeconds = closeWindowSeconds_;
        closeTs = uint64(block.timestamp + closeWindowSeconds);
        currentBatchId = 1;

        _dAt = new euint64[](MAX_TICKS);
        _sAt = new euint64[](MAX_TICKS);
        for (uint256 i = 0; i < MAX_TICKS; ++i) {
            _dAt[i] = FHE.asEuint64(0);
            _sAt[i] = FHE.asEuint64(0);
        }
    }

    /* ───────────────────────── Admin ───────────────────────── */

    // Update the default intake close window
    function setCloseWindowSeconds(uint64 newSeconds) external onlyAdmin {
        require(newSeconds > 0, "BAD_WINDOW");
        uint64 old = closeWindowSeconds;
        closeWindowSeconds = newSeconds;
        emit CloseWindowUpdated(old, newSeconds);
    }

    function openNextBatch(uint64 intakeDuration) external onlyAdmin {
        // require(phase == Phase.FROZEN || _orders.length == 0, "BATCH_NOT_FINALIZED"); // commented out for testing
        currentBatchId += 1;
        delete _orders;
        closeTs = uint64(block.timestamp + intakeDuration);
        phase = Phase.OPEN;
    }

    function freezeBatch() public onlyAdmin {
        require(phase == Phase.OPEN, "ALREADY_FROZEN");
        require(block.timestamp >= closeTs, "TOO_EARLY");
        phase = Phase.FROZEN;
    }

    /* ───────────────────────── User API ───────────────────────── */

    function submitBuy(
        uint8 tick,
        bool partialFill,
        externalEuint64 encQuoteAmount,  // QUOTE raw
        bytes calldata proof
    ) external nonReentrant onlyOpenAutoRoll returns (uint256 orderId, uint64 batchId) {
        require(tick < MAX_TICKS, "BAD_TICK");
        require(_orders.length < MAX_ORDERS, "BATCH_FULL");

        euint64 quoteAmt = FHE.fromExternal(encQuoteAmount, proof);
        
        FHE.allow(quoteAmt, address(vault));
        FHE.allowThis(quoteAmt);

        euint64 reserved = vault.reserveFor(msg.sender, QUOTE_ASSET, currentBatchId, quoteAmt);

        // if reserved < quoteAmt change qty to 0
        ebool sufficient = FHE.le(quoteAmt, reserved);
        euint64 finalAmount = FHE.select(sufficient, quoteAmt, FHE.asEuint64(0));

        FHE.allow(finalAmount, address(vault));
        FHE.allowThis(finalAmount);

        // Determine order id before push (array index)
        orderId = _orders.length;
        batchId = currentBatchId;

        _orders.push(Order({
            trader: msg.sender,
            side:   Side.BUY,
            tick:   tick,
            qty:    finalAmount,
            partialFill: partialFill,
            settled:false,
            cancelled:false
        }));

        emit Submitted(msg.sender, batchId, Side.BUY, tick, orderId);
        return (orderId, batchId);
    }

    function submitSell(
        uint8 tick,
        bool partialFill,
        externalEuint64 encBaseAmount,   // BASE raw
        bytes calldata proof
    ) external nonReentrant onlyOpenAutoRoll returns (uint256 orderId, uint64 batchId) {
        require(tick < MAX_TICKS, "BAD_TICK");
        require(_orders.length < MAX_ORDERS, "BATCH_FULL");

        euint64 baseAmt = FHE.fromExternal(encBaseAmount, proof);
        
        FHE.allow(baseAmt, address(vault));
        FHE.allowThis(baseAmt);

        euint64 reserved = vault.reserveFor(msg.sender, BASE_ASSET, currentBatchId, baseAmt);

        // if reserved < baseAmt change qty to 0
        ebool sufficient = FHE.le(baseAmt, reserved);
        euint64 finalAmount = FHE.select(sufficient, baseAmt, FHE.asEuint64(0));

        FHE.allow(finalAmount, address(vault));
        FHE.allowThis(finalAmount);

        // Determine order id before push (array index)
        orderId = _orders.length;
        batchId = currentBatchId;

        _orders.push(Order({
            trader: msg.sender,
            side:   Side.SELL,
            tick:   tick,
            qty:    finalAmount,
            partialFill: partialFill,
            settled:false,
            cancelled:false
        }));

        emit Submitted(msg.sender, batchId, Side.SELL, tick, orderId);
        return (orderId, batchId);
    }

    /* ───────────────────────── Finalize (Walrasian p*) ───────────────────────── */

    function finalizeBatch() external nonReentrant {
        require(phase == Phase.OPEN, "ALREADY_FROZEN");
        // require(block.timestamp >= closeTs, "TOO_EARLY"); // commented out for testing
        require(_orders.length > 0, "NO_ORDERS");
        phase = Phase.FROZEN;

        uint8 T = MAX_TICKS;

        // guard: need both sides to clear
        bool sawBuy = false;
        bool sawSell = false;
        for (uint256 k = 0; k < _orders.length; ++k) {
            if (_orders[k].side == Side.BUY)  sawBuy  = true;
            if (_orders[k].side == Side.SELL) sawSell = true;
            if (sawBuy && sawSell) break;
        }
        if (!sawBuy || !sawSell) {
            // Release reserved funds back to available
            for (uint256 k = 0; k < _orders.length; ++k) {
                Order storage o = _orders[k];
                bytes32 asset = (o.side == Side.BUY) ? QUOTE_ASSET : BASE_ASSET;
                vault.releaseFor(o.trader, asset, currentBatchId, o.qty);
            }
            delete _orders;
            phase = Phase.OPEN;
            closeTs = uint64(block.timestamp + closeWindowSeconds);
            currentBatchId += 1;
            for (uint8 z = 0; z < T; ++z) { _dAt[z] = FHE.asEuint64(0); _sAt[z] = FHE.asEuint64(0); }
            return;
        }

        // 0) reset per-tick sums
        for (uint8 i = 0; i < T; ++i) {
            _dAt[i] = FHE.asEuint64(0);
            _sAt[i] = FHE.asEuint64(0);
        }

        // 1) accumulate per-tick (demand in BASE, supply in BASE)
        for (uint256 k2 = 0; k2 < _orders.length; ++k2) {
            Order storage o = _orders[k2];
            if (o.cancelled) continue;
            if (o.side == Side.SELL) {
                _sAt[o.tick] = FHE.add(_sAt[o.tick], o.qty);             // already BASE
            } else {
                euint64 baseAtTick = _convertQuoteToBase(o.qty, prices[o.tick], BSCALE);
                _dAt[o.tick] = FHE.add(_dAt[o.tick], baseAtTick);        // convert BUY QUOTE → BASE
            }
        }

        // 2) cum supply (L→R)
        euint64[] memory cumS = new euint64[](T);
        euint64 runS = FHE.asEuint64(0);
        for (uint8 j = 0; j < T; ++j) {
            runS = FHE.add(runS, _sAt[j]);
            cumS[j] = runS;
        }

        // 3) one-pass best selection scanning demand (R→L)
        Best memory best = Best({
            vol:  FHE.asEuint64(0),
            imb:  FHE.asEuint64(type(uint64).max),
            idx:  FHE.asEuint64(0),
            dist: FHE.asEuint64(type(uint64).max),
            pri:  FHE.asEuint64(0),
            recip:FHE.asEuint64(0)
        });
        euint64 runD = FHE.asEuint64(0);
        for (uint8 i2 = T; i2 > 0; --i2) {
            uint8 idx = i2 - 1;
            runD = FHE.add(runD, _dAt[idx]); // cumD[idx]
            ebool dLEs = FHE.le(runD, cumS[idx]);
            euint64 mAtI = FHE.select(dLEs, runD, cumS[idx]); // matched[idx]
            euint64 imb = _imbalance(runD, cumS[idx]);
            euint64 distEnc = _distance(FHE.asEuint64(idx), lastPIdxEnc);
            Candidate memory cand = Candidate({
                idx:   FHE.asEuint64(idx),
                mAtI:  mAtI,
                imb:   imb,
                dist:  distEnc,
                pri:   FHE.asEuint64(prices[idx]),
                recip: FHE.asEuint64(recip[idx])
            });
            best = _updateBest(best, cand);
        }

        euint64 pIdxEnc  = best.idx;
        euint64 mStarEnc = best.vol;

        // Select price and reciprocal for p*
        euint64 sPrice = best.pri;
        euint64 sPriceRecip = best.recip;

        emit ClearingChosen(currentBatchId, pIdxEnc, mStarEnc, sPrice, sPriceRecip);

        // rotate
        lastPIdxEnc = pIdxEnc;
        FHE.allowThis(lastPIdxEnc);
        lastMatchedVol = mStarEnc;
        FHE.allowThis(lastMatchedVol);
        selectedPriceEnc = sPrice;
        FHE.allowThis(selectedPriceEnc);
        selectedRecipEnc = sPriceRecip;
        FHE.allowThis(selectedRecipEnc);

        // delete _orders;
        // phase = Phase.OPEN;
        // closeTs = uint64(block.timestamp + closeWindowSeconds);
        // currentBatchId += 1;
        // for (uint8 z = 0; z < T; ++z) { _dAt[z] = FHE.asEuint64(0); _sAt[z] = FHE.asEuint64(0); }
    }

    function settleBatch() external nonReentrant {
        require(phase == Phase.FROZEN, "NOT_FROZEN");
        require(_orders.length > 0, "NO_ORDERS");

        euint64 pIdxEncLoc = lastPIdxEnc;
        euint64 remBuyBase  = lastMatchedVol;
        euint64 remSellBase = lastMatchedVol;
        euint64 sPriceLoc = selectedPriceEnc;
        euint64 sRecipLoc = selectedRecipEnc;
        

        // Convert remaining BUY liquidity once to QUOTE
        euint64 remBuyQuote = _convertBaseToQuoteAtIdx(remBuyBase, sPriceLoc);
        euint64 remBuyQuoteLoc = FHE.add(remBuyQuote, FHE.asEuint64(0));

        for (uint256 k3 = 0; k3 < _orders.length; ++k3) {
            Order storage o = _orders[k3];
            if (o.settled || o.cancelled) continue;

            euint64 tickEnc = FHE.asEuint64(o.tick);
            if (o.side == Side.BUY) {
                // BUY leg: credit base, debit quote from reserved
                // qualifies if limit >= p*
                ebool qualifies = FHE.le(pIdxEncLoc, tickEnc);
                euint64 qMasked = FHE.select(qualifies, o.qty, FHE.asEuint64(0));
                euint64 fillQ = _min64(qMasked, remBuyQuoteLoc); // partial fill in QUOTE allowed
                
                // disable partial fills if specified
                if (!o.partialFill) {
                    ebool canFillFull = FHE.le(qMasked, remBuyQuoteLoc);
                    fillQ = FHE.select(canFillFull, qMasked, FHE.asEuint64(0));
                }

                euint64 fillB = _convertQuoteToBaseAtIdx(fillQ, sRecipLoc);
                FHE.allow(fillB, address(vault));
                FHE.allowThis(fillB);
                FHE.allow(fillQ, address(vault));
                FHE.allowThis(fillQ);
                vault.settleBuy(o.trader, BASE_ASSET, QUOTE_ASSET, currentBatchId, fillB, fillQ);
                remBuyBase  = FHE.sub(remBuyBase, fillB);
                remBuyQuoteLoc = FHE.sub(remBuyQuoteLoc, fillQ);

                // release any unfilled reserved amounts for this order
                euint64 quoteBalance = FHE.sub(o.qty, fillQ);
                FHE.allow(quoteBalance, address(vault));
                FHE.allowThis(quoteBalance);
                vault.releaseFor(o.trader, QUOTE_ASSET, currentBatchId, quoteBalance);
            } else {
                // SELL leg: debit base from reserved, credit quote
                ebool qualifies = FHE.le(tickEnc, pIdxEncLoc); // limit <= p*
                euint64 deliver = FHE.select(qualifies, o.qty, FHE.asEuint64(0)); // BASE
                euint64 fillC   = _min64(deliver, remSellBase); // partial fill in BASE allowed
                
                // disable partial fills if specified
                if (!o.partialFill) {
                    ebool canFillFull = FHE.le(deliver, remSellBase);
                    fillC = FHE.select(canFillFull, deliver, FHE.asEuint64(0));
                }
                
                euint64 qCred   = _convertBaseToQuoteAtIdx(fillC, sPriceLoc);
                FHE.allow(fillC, address(vault));
                FHE.allowThis(fillC);
                FHE.allow(qCred, address(vault));
                FHE.allowThis(qCred);
                vault.settleSell(o.trader, BASE_ASSET, QUOTE_ASSET, currentBatchId, fillC, qCred);
                remSellBase = FHE.sub(remSellBase, fillC);
                
                // release any unfilled reserved amounts for this order
                euint64 baseBalance = FHE.sub(o.qty, fillC);
                FHE.allow(baseBalance, address(vault));
                FHE.allowThis(baseBalance);
                vault.releaseFor(o.trader, BASE_ASSET, currentBatchId, baseBalance);
            }

            o.settled = true;
        }

        delete _orders;
        for (uint8 z = 0; z < MAX_TICKS; ++z) { _dAt[z] = FHE.asEuint64(0); _sAt[z] = FHE.asEuint64(0); }
        phase  = Phase.OPEN;
        closeTs = uint64(block.timestamp + closeWindowSeconds);
        currentBatchId += 1;

        emit Settled(currentBatchId - 1, lastPIdxEnc);
    }


    // Cancel an order by id during OPEN phase; releases reserved funds for this order only.
    function cancelOrder(uint256 orderId) external nonReentrant {
        require(orderId < _orders.length, "BAD_ID");
        Order storage o = _orders[orderId];
        require(o.trader == msg.sender, "NOT_OWNER");
        require(phase == Phase.OPEN, "BATCH_FROZEN");
        require(!o.settled, "ALREADY_SETTLED");
        require(!o.cancelled, "ALREADY_CANCELLED");

        FHE.allow(o.qty, address(vault));
        FHE.allowThis(o.qty);

        // Release reserved funds back to available, bucket-wise for this market+batch
        bytes32 asset = (o.side == Side.BUY) ? QUOTE_ASSET : BASE_ASSET;
        vault.releaseFor(o.trader, asset, currentBatchId, o.qty);

        // mark cancelled to exclude from finalize/settle
        o.cancelled = true;

        emit Cancelled(o.trader, currentBatchId, orderId);
    }


    /* ───────────────────────── Internal helpers ───────────────────────── */

    struct Best {
        euint64 vol;
        euint64 imb;
        euint64 idx;
        euint64 dist;
        euint64 pri;
        euint64 recip;
    }

    struct Candidate {
        euint64 idx;
        euint64 mAtI;
        euint64 imb;
        euint64 dist;
        euint64 pri;
        euint64 recip;
    }

    function _imbalance(euint64 cumD_i, euint64 cumS_i) internal returns (euint64) {
        ebool d_le_s  = FHE.le(cumD_i, cumS_i);
        euint64 diff1 = FHE.sub(cumS_i, cumD_i);
        euint64 diff2 = FHE.sub(cumD_i, cumS_i);
        return FHE.select(d_le_s, diff1, diff2);
    }

    function _distance(euint64 iEnc, euint64 prevIdxEnc) internal returns (euint64) {
        ebool i_ge_prev = FHE.le(prevIdxEnc, iEnc);
        euint64 d1 = FHE.sub(iEnc, prevIdxEnc);
        euint64 d2 = FHE.sub(prevIdxEnc, iEnc);
        return FHE.select(i_ge_prev, d1, d2);
    }

    function _updateBest(
        Best memory best,
        Candidate memory cand
    ) internal returns (Best memory) {
        // 1) maximize matched volume
        // 2) minimize imbalance
        // 3) minimize distance to previous index

        ebool gtVol = FHE.not(FHE.le(cand.mAtI, best.vol));
        ebool eqVol = FHE.eq(cand.mAtI, best.vol);
        ebool ltImb = FHE.not(FHE.le(best.imb, cand.imb));
        ebool eqImb = FHE.eq(cand.imb, best.imb);
        ebool ltDist = FHE.not(FHE.le(best.dist, cand.dist));

        ebool c2 = FHE.and(eqVol, ltImb);
        ebool c3 = FHE.and(FHE.and(eqVol, eqImb), ltDist);
        ebool take = FHE.or(gtVol, FHE.or(c2, c3));

        best.vol   = FHE.select(take, cand.mAtI, best.vol);
        best.imb   = FHE.select(take, cand.imb,  best.imb);
        best.idx   = FHE.select(take, cand.idx,  best.idx);
        best.dist  = FHE.select(take, cand.dist, best.dist);
        best.pri   = FHE.select(take, cand.pri,  best.pri);
        best.recip = FHE.select(take, cand.recip, best.recip);
        return best;
    }

    // --- Converters ---
    // priceScaled = price * 10^Q (public uint64); baseScale = 10^B
    // baseRaw = quoteRaw * baseScale / priceScaled
    function _convertQuoteToBase(euint64 q, uint64 priceScaled, uint64 baseScale) internal returns (euint64) {
        euint64 num = FHE.mul(q, baseScale);
        return FHE.div(num, priceScaled);
    }

    function _min64(euint64 a, euint64 b) internal returns (euint64) {
        ebool aleb = FHE.le(a, b);
        return FHE.select(aleb, a, b);
    }


    // base = q * BSCALE / priceScaled
    // Implemented as: base ≈ (q * recip[p*]) / RECIP_SCALE
    function _convertQuoteToBaseAtIdx(euint64 q, euint64 selectedPriceRecip) internal returns (euint64) {
        euint64 prod = FHE.mul(q, selectedPriceRecip);
        euint64 baseAtP = FHE.div(prod, RECIP_SCALE);
        return baseAtP;
    }
     // Implemented as: base ≈ (q * recip[p*]) / RECIP_SCALE
    // function _convertQuoteToBaseAtIdx(euint64 q, euint64 pxIdxEnc) internal returns (euint64) {
    //     euint64 acc = FHE.asEuint64(0);
    //     uint8 TT = uint8(recip.length);
    //     for (uint8 i = 0; i < TT; ++i) {
    //         ebool isSel = FHE.eq(pxIdxEnc, FHE.asEuint64(i));
    //         // cipher × clear
    //         euint64 prod_i = FHE.mul(q, uint64(recip[i]));
    //         euint64 term = FHE.select(isSel, prod_i, FHE.asEuint64(0));
    //         acc = FHE.add(acc, term);
    //     }
    //     euint64 baseAtP = FHE.div(acc, RECIP_SCALE);
    //     return baseAtP;
    // }
    // // base = q * BSCALE / priceScaled
    // function _convertQuoteToBaseAtIdx(euint64 q, euint64 pxIdxEnc) internal returns (euint64) {
    //     euint64 acc = FHE.asEuint64(0);
    //     uint8 TT = uint8(prices.length);
    //     for (uint8 i = 0; i < TT; ++i) {
    //         ebool isSel = FHE.eq(pxIdxEnc, FHE.asEuint64(i));
    //         // cipher / clear
    //         euint64 div_i = FHE.div(q, uint64(prices[i]));
    //         euint64 term = FHE.select(isSel, div_i, FHE.asEuint64(0));
    //         acc = FHE.add(acc, term);
    //     }
    //     euint64 baseAtP = FHE.mul(acc, BSCALE);
    //     return baseAtP;
    // }

    // quoteRaw = baseRaw * priceScaled / BSCALE
    function _convertBaseToQuoteAtIdx(euint64 b, euint64 selectedPrice) internal returns (euint64) {
        euint64 num = FHE.mul(b, selectedPrice); // 0.001*10^8 * 500000'
        euint64 resDiv = FHE.div(num, BSCALE);
        return resDiv;
    }

    // // quoteRaw = (b * price[p*]) / BSCALE  without cipher×cipher
    // function _convertBaseToQuoteAtIdx(euint64 b, euint64 pIdxEnc)
    //     internal
    //     returns (euint64)
    // {
    //     euint64 acc = FHE.asEuint64(0);
    //     uint8 TT = uint8(prices.length); // ensure TT ≤ 255

    //     for (uint8 i = 0; i < TT; ++i) {
    //         ebool isSel = FHE.eq(pIdxEnc, FHE.asEuint64(i));
    //         // cipher × clear (cheap)
    //         euint64 prodI = FHE.mul(b, uint64(prices[i]));
    //         euint64 term  = FHE.select(isSel, prodI, FHE.asEuint64(0));
    //         acc = FHE.add(acc, term);
    //     }
    //     return FHE.div(acc, BSCALE); 
    // }

    /* ───────────────────────── View helpers ───────────────────────── */

    function orderCount() external view returns (uint256) { return _orders.length; }

    function priceAt(uint8 tick) external view returns (uint64) {
        require(tick < MAX_TICKS, "OOB");
        return prices[tick];
    }

    // retrieve the encrypted last matched volume of the previous finalized batch.
    function lastMatchedVolForCaller() external onlyAdmin() returns (euint64) {
        FHE.allowThis(lastMatchedVol);
        FHE.allow(lastMatchedVol, msg.sender);
        return lastMatchedVol;
    }

    // retrieve the encrypted last clearing tick index (0..MAX_TICKS-1) of the previous finalized batch.
    function lastTickEncForCaller() external returns (euint64) {
        FHE.allowThis(lastPIdxEnc);
        FHE.allow(lastPIdxEnc, msg.sender);
        return lastPIdxEnc;
    }

    // retrieve the encrypted last clearing price (scaled by QSCALE) computed with a privacy-preserving selection over the public price ladder using the encrypted tick.
    function lastPriceEncForCaller() external returns (euint64) {
        FHE.allowThis(selectedPriceEnc);
        FHE.allow(selectedPriceEnc, msg.sender);
        return selectedPriceEnc;
    }

    // Returns seconds remaining until the current intake closes.
    function timeUntilClose() external view returns (uint64) {
        if (phase != Phase.OPEN) return 0;
        if (block.timestamp >= closeTs) return 0;
        return uint64(closeTs - block.timestamp);
    }

    // Lightweight view of a trader's orders for the current batch (amounts are encrypted and omitted).
    struct TraderOrderView {
        uint256 orderId;
        uint64  batchId;   // all current orders share currentBatchId
        uint8   side;      // 0=BUY, 1=SELL
        uint8   tick;      // 0..MAX_TICKS-1
        bool    partialFill;
        bool    settled;
        bool    cancelled;
    }

    // Return all orders belonging to msg.sender for the current open/frozen batch.
    // amounts are not returned because they are encrypted (euint64)
    function getMyOrders() external view returns (TraderOrderView[] memory) {
        uint256 len = _orders.length;
        uint256 cnt = 0;
        for (uint256 i = 0; i < len; ++i) {
            if (_orders[i].trader == msg.sender) cnt++;
        }

        TraderOrderView[] memory out = new TraderOrderView[](cnt);
        uint256 j = 0;
        for (uint256 i = 0; i < len; ++i) {
            Order storage o = _orders[i];
            if (o.trader != msg.sender) continue;
            out[j] = TraderOrderView({
                orderId: i,
                batchId: currentBatchId,
                side: uint8(o.side),
                tick: o.tick,
                partialFill: o.partialFill,
                settled: o.settled,
                cancelled: o.cancelled
            });
            j++;
        }
        return out;
    }

}
