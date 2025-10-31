import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const CUSDT_SCALE = 6; // USDT typically uses 6 decimals (microdollar precision)

const func2: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedConfidentialERC20 = await deploy("ConfidentialERC20", {
    from: deployer,
    args: ["ConfUSDT", "cUSDT", CUSDT_SCALE],
    log: true,
  });

  console.log(`Confidential USDT contract: `, deployedConfidentialERC20.address);
};
export default func2;
func2.id = "deploy_confidentialUSDT"; // id required to prevent reexecution
func2.tags = ["ConfidentialUSDT"];