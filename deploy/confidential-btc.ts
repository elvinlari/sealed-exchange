import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const CBTC_SCALE = 8; // BTC typically uses 8 decimals (Satoshi precision)

const func3: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedConfidentialERC20 = await deploy("ConfidentialERC20", {
    from: deployer,
    args: ["ConfBTC", "cBTC", CBTC_SCALE], 
    log: true,
  });

  console.log(`Confidential BTC contract: `, deployedConfidentialERC20.address);
};
export default func3;
func3.id = "deploy_confidentialBTC"; // id required to prevent reexecution
func3.tags = ["ConfidentialBTC"];