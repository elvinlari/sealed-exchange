import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const id = (s: string) => ethers.id(s);

describe("MarketPair", () => {
  async function deploySetup() {
    const [admin] = await ethers.getSigners();

    // Deploy Vault (used only as address in MarketPair ctor)
    const Vault = await ethers.getContractFactory("Vault");
    const vault = await Vault.deploy();
    await vault.waitForDeployment();

    // Constructor params
    const baseAsset = id("cBTC");
    const quoteAsset = id("cUSDT");

    // Scales
    const QSCALE = 10n ** 8n; // quote decimals = 8
    const BSCALE = 10n ** 8n; // base decimals = 8
    const RECIP_SCALE = 10n ** 18n;

    // Prices ladder (strictly increasing, scaled by QSCALE)
    const prices = [100_000_000n, 150_000_000n, 200_000_000n];

    // Reciprocals: floor(BSCALE * RECIP_SCALE / price)
    const recip = prices.map((p) => (BSCALE * RECIP_SCALE) / p);

    const MarketPair = await ethers.getContractFactory("MarketPair");
    const mp = await MarketPair.deploy(
      await vault.getAddress(),
      baseAsset,
      quoteAsset,
      QSCALE,
      BSCALE,
      prices,
      32,       // MAX_ORDERS
      1,        // lastPIdx
      RECIP_SCALE,
      recip,
      120       // closeWindowSeconds
    );
    await mp.waitForDeployment();

    return { mp, vault, admin, QSCALE, BSCALE, prices, recip };
  }

  it("deploys and exposes initial views", async () => {
    const { mp, admin } = await deploySetup();
    const net = await ethers.provider.getNetwork();

    // timeUntilClose should be > 0 right after deploy
    const remaining = await mp.timeUntilClose();
    expect(remaining).to.be.greaterThan(0);

    // On non-local networks, avoid sending stateful view-like txs that may be slow/expensive
    if (net.chainId === 31337n) {
      const tx1 = await mp.connect(admin).lastTickEncForCaller();
      await tx1.wait();
      const tx2 = await mp.connect(admin).lastPriceEncForCaller();
      await tx2.wait();
    }
  });

  it("admin can set close window seconds; non-admin cannot", async () => {
    const { mp, admin } = await deploySetup();
    const [, other] = await ethers.getSigners();

    await expect(mp.connect(other).setCloseWindowSeconds(300)).to.be.revertedWith("NOT_ADMIN");
    const before = await mp.closeWindowSeconds();
    const tx = await mp.connect(admin).setCloseWindowSeconds(300);
    await tx.wait();
    const after = await mp.closeWindowSeconds();
    expect(after).to.not.equal(before);
    expect(after).to.equal(300n);
  });

  it("can open next batch when orders empty; can freeze after close time", async () => {
    const { mp, admin } = await deploySetup();
    const net = await ethers.provider.getNetwork();
    if (net.chainId !== 31337n) {
      // Skip heavy lifecycle on live networks
      return;
    }

    // openNextBatch allowed because _orders is empty by default
    const beforeId = await mp.currentBatchId();
    await mp.connect(admin).openNextBatch(60);
    const afterId = await mp.currentBatchId();
    expect(afterId).to.equal(beforeId + 1n);

    // fast-forward beyond closeTs and freeze only on local hardhat network
    {
      const now = await time.latest();
      const closeSeconds = await mp.timeUntilClose();
      await time.increaseTo(now + Number(closeSeconds) + 1);
      await expect(mp.connect(admin).freezeBatch()).to.not.be.reverted;
    }
  });

  it("lastMatchedVolForCaller is admin-only", async () => {
    const { mp, admin } = await deploySetup();
    const [, other] = await ethers.getSigners();

    await expect(mp.connect(other).lastMatchedVolForCaller()).to.be.revertedWith("NOT_ADMIN");

    // calling as admin may still revert if lastMatchedVol wasn't initialized with a zero-ciphertext
    // We only assert the access control here.
    await expect(mp.connect(admin).lastMatchedVolForCaller()).to.be.reverted;
  });
});
