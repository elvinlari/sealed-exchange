// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * Confidential ERC20-like with ENCRYPTED totalSupply using fhEVM FHE facade.
 * - Uses FHE, euint64, externalEuint64, FHE.fromExternal(...)
 * - Encrypted balances, allowances, AND totalSupply
 * - Constant-time updates via FHE.select to avoid leaking through control flow
 * - Events use a placeholder amount to avoid leaking plaintext values
 */


import { FHE, euint64, ebool, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { AccessControlEnumerable } from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import { IVaultNotify, IVaultView } from "./IVault.sol";

contract ConfidentialERC20 is SepoliaConfig, AccessControlEnumerable {

    // ---- Metadata ----
    string  private _name;
    string  private _symbol;
    uint8   public  immutable decimals;

    // ---- Encrypted state ----
    euint64 private _totalSupply;
    mapping(address => euint64) private _balances;
    mapping(address => mapping(address => euint64)) private _allowances;

    // ---- Access Control ----
    address public owner;
    bytes32 public constant AUDITOR_ROLE = keccak256("AUDITOR_ROLE");

    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }
    modifier onlyAuditor() { require(hasRole(AUDITOR_ROLE, msg.sender), "Not auditor"); _; }

    // ---- Events (placeholder value avoids leaking amounts) ----
    uint256 internal constant _PLACEHOLDER = type(uint256).max;
    event Transfer(address indexed from, address indexed to, uint256 value /* _PLACEHOLDER */);
    event Approval(address indexed owner, address indexed spender, uint256 value /* _PLACEHOLDER */);

    // =========================================================================

    constructor(string memory name_, string memory symbol_, uint8 decimals_)
    {
        require(decimals_ <= 12, "decimals too large for uint64");
        _name    = name_;
        _symbol  = symbol_;
        decimals = decimals_;
        owner    = msg.sender;

        // Initialize encrypted total supply to zero (ciphertext)
        _totalSupply = FHE.asEuint64(0);
        FHE.allowThis(_totalSupply);
    }
  
    // grant AUDITOR_ROLE to an address
    function grantAuditorRole(address auditor) external onlyOwner {
        _grantRole(AUDITOR_ROLE, auditor);
    }

    // revoke AUDITOR_ROLE from an address
    function revokeAuditorRole(address auditor) external onlyOwner {
        _revokeRole(AUDITOR_ROLE, auditor);
    }



    // =========================================================================
    //                         Transfer and Notify to Vault
    // =========================================================================
    // Owner-initiated confidential transfer into a Vault, then notify Vault to credit.
    function transferEncryptedAndNotify(
        address vault,                  // target vault
        bytes32 assetId,                // vault's registered asset id
        externalEuint64 encAmount,      // external ciphertext handle (SDK)
        bytes calldata inputProof       // proof for FHE.fromExternal in THIS token
    ) external returns (bool) {
        // Cheap preflight to avoid wasting gas if vault/asset disabled
        require(IVaultView(vault).isAcceptingDeposits(assetId), "VAULT_NOT_ACCEPTING");

        // Reconstruct WHERE the proof is valid 
        euint64 amt = FHE.fromExternal(encAmount, inputProof);

        // Grant the Vault rights to use this ciphertext
        FHE.allow(amt, vault);   
        FHE.allowThis(amt); 

        // move funds owner -> vault
        euint64 spent = _transferToVault(msg.sender, vault, amt);
        FHE.allow(spent, vault);  
        FHE.allowThis(spent);

        // Atomic callback: if vault rejects, whole tx reverts and transfer rolls back
        IVaultNotify(vault).onDepositFromToken(msg.sender, assetId, spent);
        return true;
    }


    // --------------------------------------------------------------------------
    //                                Views
    // --------------------------------------------------------------------------

    function name() public view returns (string memory) { return _name; }
    function symbol() public view returns (string memory) { return _symbol; }

    /// Encrypted total supply (raw ciphertext). For private reading, use totalSupplyEncrypted.
    function totalSupply() public view returns (euint64) { return _totalSupply; }
    function balanceOf(address account) public view returns (euint64) { return _balances[account]; }
    function allowance(address owner_, address spender) public view returns (euint64) { return _allowances[owner_][spender]; }

    // Grant decryption to a viewer's public key

    function totalSupplyForCaller() external returns (euint64) {
        FHE.allow(_totalSupply, msg.sender);  
        return _totalSupply;                  
    }

    function selfBalanceForCaller() external returns (euint64) {
        FHE.allow(_balances[msg.sender], msg.sender); // grant only to self
        return _balances[msg.sender];
    }

    function balanceOfForCaller(address account) external onlyAuditor returns (euint64) {
        FHE.allow(_balances[account], msg.sender);
        return _balances[account];
    }

    // --------------------------------------------------------------------------
    //                               Approve
    // --------------------------------------------------------------------------

    function approve(address spender, externalEuint64 encAmount, bytes calldata inputProof) public returns (bool) {
        euint64 amount = FHE.fromExternal(encAmount, inputProof);
        _approve(msg.sender, spender, amount);
        emit Approval(msg.sender, spender, _PLACEHOLDER);
        return true;
    }

    function approve(address spender, euint64 amount) public returns (bool) {
        _approve(msg.sender, spender, amount);
        emit Approval(msg.sender, spender, _PLACEHOLDER);
        return true;
    }

    // --------------------------------------------------------------------------
    //                               Transfer
    // --------------------------------------------------------------------------

    function transfer(address to, externalEuint64 encAmount, bytes calldata inputProof) public returns (bool) {
        euint64 amount = FHE.fromExternal(encAmount, inputProof);
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transfer(address to, euint64 amount) public returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    // --------------------------------------------------------------------------
    //                            TransferFrom (allowance)
    // --------------------------------------------------------------------------

    function transferFrom(address from, address to, externalEuint64 encAmount, bytes calldata inputProof) public returns (bool) {
        euint64 amount = FHE.fromExternal(encAmount, inputProof);
        _spendAllowanceAndTransfer(from, to, amount);
        return true;
    }

    function transferFrom(address from, address to, euint64 amount) public returns (bool) {
        _spendAllowanceAndTransfer(from, to, amount);
        return true;
    }

    // --------------------------------------------------------------------------
    //                              Mint / Burn
    // --------------------------------------------------------------------------

    /// Mint a plaintext raw amount (already scaled by `decimals`). Admin only.
    function mint(address to, uint64 rawAmount) external onlyOwner {
        euint64 inc = FHE.asEuint64(rawAmount);

        // balances[to] += inc
        _balances[to] = FHE.add(_balances[to], inc);
        FHE.allowThis(_balances[to]);
        FHE.allow(_balances[to], to);

        // totalSupply += inc (encrypted)
        _totalSupply = FHE.add(_totalSupply, inc);
        FHE.allowThis(_totalSupply);

        emit Transfer(address(0), to, _PLACEHOLDER);
    }

    /// Burn a plaintext raw amount from caller (scaled by `decimals`).
    /// Constant-time: uses `spend = ok ? need : 0`, then subtracts `spend` from both => dont branch on conditions
    /// the caller balance and the encrypted total supply.
    function burn(uint64 rawAmount) external {
        euint64 need   = FHE.asEuint64(rawAmount);
        euint64 bal    = _balances[msg.sender];

        // ok = (need <= bal)
        ebool ok       = FHE.le(need, bal);
        euint64 spend  = FHE.select(ok, need, FHE.asEuint64(0));

        // caller balance -= spend
        _balances[msg.sender] = FHE.sub(bal, spend);
        FHE.allowThis(_balances[msg.sender]);
        FHE.allow(_balances[msg.sender], msg.sender);

        // encrypted total supply -= spend
        _totalSupply = FHE.sub(_totalSupply, spend);
        FHE.allowThis(_totalSupply);

        // Optional strict revert on dev/test:
        // require(FHE.decrypt(ok), "burn exceeds balance");

        emit Transfer(msg.sender, address(0), _PLACEHOLDER);
    }

    // --------------------------------------------------------------------------
    //                               Internals
    // --------------------------------------------------------------------------

    function _approve(address owner_, address spender, euint64 amount) internal {
        require(owner_ != address(0) && spender != address(0), "zero addr");
        _allowances[owner_][spender] = amount;

        // permissions so both owner & spender can reference/use the ciphertext
        FHE.allowThis(amount);
        FHE.allow(amount, owner_);
        FHE.allow(amount, spender);
    }

    function _transfer(address from, address to, euint64 amount) internal {
        require(from != address(0) && to != address(0), "zero addr");

        euint64 fromBal = _balances[from];
        euint64 fromBalSafe = FHE.add(fromBal, FHE.asEuint64(0));
        ebool   ok      = FHE.le(amount, fromBalSafe);

        // constant-time spend
        euint64 spend = FHE.select(ok, amount, FHE.asEuint64(0));

        // from -= spend
        _balances[from] = FHE.sub(fromBalSafe, spend);
        FHE.allowThis(_balances[from]);
        FHE.allow(_balances[from], from);

        // to += spend
        _balances[to] = FHE.add(_balances[to], spend);
        FHE.allowThis(_balances[to]);
        FHE.allow(_balances[to], to);



        emit Transfer(from, to, _PLACEHOLDER);
    }

    function _transferToVault(address from, address to, euint64 amount) internal returns (euint64) {
        require(from != address(0) && to != address(0), "zero addr");

        euint64 fromBal = _balances[from];
        euint64 fromBalSafe = FHE.add(fromBal, FHE.asEuint64(0));
        ebool   ok      = FHE.le(amount, fromBalSafe);

        // constant-time spend
        euint64 spend = FHE.select(ok, amount, FHE.asEuint64(0));

        // from -= spend
        _balances[from] = FHE.sub(fromBalSafe, spend);
        FHE.allowThis(_balances[from]);
        FHE.allow(_balances[from], from);

        // to += spend
        _balances[to] = FHE.add(_balances[to], spend);
        FHE.allowThis(_balances[to]);
        FHE.allow(_balances[to], to);

        emit Transfer(from, to, _PLACEHOLDER);
        return spend;
    }

    function _spendAllowanceAndTransfer(address from, address to, euint64 amount) internal {
        require(from != address(0) && to != address(0), "zero addr");

        euint64 cur = _allowances[from][msg.sender];

        ebool okAllow = FHE.le(amount, cur);
        ebool okBal   = FHE.le(amount, _balances[from]);
        ebool ok      = FHE.and(okAllow, okBal);

        // new allowance = ok ? cur - amount : cur
        euint64 next = FHE.select(ok, FHE.sub(cur, amount), cur);
        _allowances[from][msg.sender] = next;
        FHE.allowThis(next);
        FHE.allow(next, from);
        FHE.allow(next, msg.sender);

        // transfer using constant-time spend
        euint64 spend = FHE.select(ok, amount, FHE.asEuint64(0));

        _balances[from] = FHE.sub(_balances[from], spend);
        FHE.allowThis(_balances[from]);
        FHE.allow(_balances[from], from);

        _balances[to] = FHE.add(_balances[to], spend);
        FHE.allowThis(_balances[to]);
        FHE.allow(_balances[to], to);

        emit Transfer(from, to, _PLACEHOLDER);
    }

    // ===== Auditors catalog =====

    function auditorCount() external view onlyOwner returns (uint256) {
        return getRoleMemberCount(AUDITOR_ROLE);
    }

    function auditorAt(uint256 index) external view onlyOwner returns (address) {
        require(index < getRoleMemberCount(AUDITOR_ROLE), "OUT_OF_BOUNDS");
        return getRoleMember(AUDITOR_ROLE, index);
    }

    function listAuditors(uint256 offset, uint256 limit)
        external
        view
        onlyOwner()
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
