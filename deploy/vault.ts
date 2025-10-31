import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const vaultF: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedVault = await deploy("Vault", {
    from: deployer,
    args: [],
    log: true,
  });

  console.log(`Vault contract: `, deployedVault.address);
};
export default vaultF;
vaultF.id = "deploy_vault"; // id required to prevent reexecution
vaultF.tags = ["Vault"];