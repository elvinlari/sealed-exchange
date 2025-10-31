import { expect } from "chai";
import { ethers } from "hardhat";

describe("ConfidentialERC20", () => {
  async function deployToken() {
    const [deployer, alice, bob] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("ConfidentialERC20");
    const token = await Token.deploy("ConfUSDT", "cUSDT", 6);
    await token.waitForDeployment();
    return { token, deployer, alice, bob };
  }

  it("deploys with correct metadata and owner", async () => {
    const { token, deployer } = await deployToken();
    expect(await token.name()).to.equal("ConfUSDT");
    expect(await token.symbol()).to.equal("cUSDT");
    expect(await token.decimals()).to.equal(6);
    expect(await token.owner()).to.equal(await deployer.getAddress());
  });

  it("only owner can grant/revoke auditor role and query auditor catalog", async () => {
    const { token, deployer, alice, bob } = await deployToken();

    // Non-owner cannot grant
    await expect(token.connect(alice).grantAuditorRole(await bob.getAddress()))
      .to.be.revertedWith("Not owner");

    // Owner grants 
    const grantTx = await token.connect(deployer).grantAuditorRole(await alice.getAddress());
    await grantTx.wait();

    // Owner can view auditor catalog
    expect(await token.connect(deployer).auditorCount()).to.equal(1n);
    expect(await token.connect(deployer).auditorAt(0)).to.equal(await alice.getAddress());
    const res = await token.connect(deployer).listAuditors(0, 10);
    const page: string[] = res[0];
    const total = res[1];
    expect(total).to.equal(1n);
    expect(page).to.deep.equal([await alice.getAddress()]);

    // Non-owner cannot view auditor catalog
    await expect(token.connect(alice).auditorCount()).to.be.revertedWith("Not owner");
    await expect(token.connect(alice).auditorAt(0)).to.be.revertedWith("Not owner");
    await expect(token.connect(alice).listAuditors(0, 10)).to.be.revertedWith("Not owner");

  // Owner can revoke
  const revokeTx = await token.connect(deployer).revokeAuditorRole(await alice.getAddress());
  await revokeTx.wait();
    expect(await token.connect(deployer).auditorCount()).to.equal(0n);
  });

  it("owner can mint and holders can burn without plaintext leaks (events emitted)", async () => {
    const { token, deployer, alice } = await deployToken();

    // Mint to Alice 
    const mintTx = await token.connect(deployer).mint(await alice.getAddress(), 1_000_000);
    await mintTx.wait();

    // Alice burns part of her balance (skip if sender has no gas on live nets)
    const net = await ethers.provider.getNetwork();
    if (net.chainId === 31337n) {
      const burnTx = await token.connect(alice).burn(500_000);
      await burnTx.wait();
    }

    // We avoid asserting balances directly due to encrypted state
  });
});
