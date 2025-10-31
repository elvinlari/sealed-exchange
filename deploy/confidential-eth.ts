import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const CETH_SCALE = 6; 

const eth: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedConfidentialERC20 = await deploy("ConfidentialERC20", {
    from: deployer,
    args: ["ConfETH", "cETH", CETH_SCALE],
    log: true,
  });

  console.log(`Confidential ETH contract: `, deployedConfidentialERC20.address);
};
export default eth;
eth.id = "deploy_confidentialETH"; 
eth.tags = ["ConfidentialETH"];