import { expect } from "chai";
import { ethers } from "hardhat";

const id = (s: string) => ethers.id(s);

describe("Vault", () => {
  async function deployVault() {
    const [admin, mkt, alice, bob] = await ethers.getSigners();
    const Vault = await ethers.getContractFactory("Vault");
    const vault = await Vault.deploy();
    await vault.waitForDeployment();

    const Token = await ethers.getContractFactory("ConfidentialERC20");
    const token = await Token.deploy("ConfUSDT", "cUSDT", 6);
    await token.waitForDeployment();

    return { vault, token, admin, mkt, alice, bob };
  }

  it("sets deployer as admin and can change admin", async () => {
    const { vault, admin, alice } = await deployVault();
    expect(await vault.admin()).to.equal(await admin.getAddress());

    const setTx = await vault.connect(admin).setAdmin(await alice.getAddress());
    await setTx.wait();

    expect(await vault.admin()).to.equal(await alice.getAddress());

    await expect(vault.connect(admin).setAdmin(await admin.getAddress())).to.be.revertedWith("NOT_ADMIN");
  });

  it("manages assets registry and status", async () => {
    const { vault, admin, token } = await deployVault();
    const net = await ethers.provider.getNetwork();
    if (net.chainId !== 31337n) {
      // Skip heavy stateful flows on live networks
      return;
    }
    const assetId = id("cUSDT");

    const regTx = await vault.connect(admin).registerAsset(assetId, await token.getAddress(), true);
    await regTx.wait();

    let asset = await vault.getAsset(assetId);
    expect(asset.token).to.equal(await token.getAddress());
    expect(asset.enabled).to.equal(true);
    expect(asset.paused).to.equal(false);
    expect(asset.isNumeraire).to.equal(true);

    expect(await vault.assetCount()).to.equal(1n);
    expect(await vault.assetAt(0)).to.equal(assetId);

    // listAssets: just sanity check sizes and first item
    const res = await vault.listAssets(0, 10);
    expect(res[0].length).to.equal(1);
    expect(res[0][0]).to.equal(assetId);

    const statusTx = await vault.connect(admin).setAssetStatus(assetId, false, true);
    await statusTx.wait();

    asset = await vault.getAsset(assetId);
    expect(asset.enabled).to.equal(false);
    expect(asset.paused).to.equal(true);
  });

  it("approves and revokes markets; enumerates markets", async () => {
    const { vault, admin, mkt } = await deployVault();
    const net = await ethers.provider.getNetwork();
    if (net.chainId !== 31337n) {
      return;
    }

    const approveTx = await vault.connect(admin).setMarketApproved(await mkt.getAddress(), true);
    await approveTx.wait();

    expect(await vault.isMarket(await mkt.getAddress())).to.equal(true);
    expect(await vault.marketCount()).to.equal(1n);
    expect(await vault.marketAt(0)).to.equal(await mkt.getAddress());

    const page = await vault.listMarkets(0, 10);
    expect(page.length).to.equal(1);
    expect(page[0]).to.equal(await mkt.getAddress());

    const revokeTx = await vault.connect(admin).setMarketApproved(await mkt.getAddress(), false);
    await revokeTx.wait();

    expect(await vault.isMarket(await mkt.getAddress())).to.equal(false);
    expect(await vault.marketCount()).to.equal(0n);
  });

  it("auditor role management and catalog is admin-only", async () => {
    const { vault, admin, alice, bob } = await deployVault();
    const net = await ethers.provider.getNetwork();
    if (net.chainId !== 31337n) {
      return;
    }

    // Non-admin cannot view catalog
    await expect(vault.connect(alice).auditorCount()).to.be.revertedWith("NOT_ADMIN");

    // Admin grants auditor role to Bob
  const grantTx = await vault.connect(admin).grantAuditorRole(await bob.getAddress());
  await grantTx.wait();

    // Admin can view catalog
    expect(await vault.connect(admin).auditorCount()).to.equal(1n);
    expect(await vault.connect(admin).auditorAt(0)).to.equal(await bob.getAddress());

    const res = await vault.connect(admin).listAuditors(0, 10);
    const page: string[] = res[0];
    const total = res[1];
    expect(total).to.equal(1n);
    expect(page).to.deep.equal([await bob.getAddress()]);

    // Revoke
  const rTx = await vault.connect(admin).revokeAuditorRole(await bob.getAddress());
  await rTx.wait();
    expect(await vault.connect(admin).auditorCount()).to.equal(0n);
  });

  it("exposes minimal encrypted balance views without reverting", async () => {
    const { vault, admin } = await deployVault();
    const assetId = id("cUSDT");

    // Without registering asset, the default mapping values are zero-ciphertext placeholders
    const [eAvail, eRes] = await vault.connect(admin).selfGetBalancesForCaller(assetId);
    expect(eAvail).to.be.ok;
    expect(eRes).to.be.ok;
  });
});
