import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const CXAU_SCALE = 6;

const xau: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedConfidentialERC20 = await deploy("ConfidentialERC20", {
    from: deployer,
    args: ["ConfGold", "cXAU", CXAU_SCALE],
    log: true,
  });

  console.log(`Confidential Gold contract: `, deployedConfidentialERC20.address);
};
export default xau;
xau.id = "deploy_confidentialGOLD";
xau.tags = ["ConfidentialGOLD"];