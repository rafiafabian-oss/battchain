// Deploy BattChain dan (opsional) beri peran awal.
//   npx hardhat run scripts/deploy.js --network localhost
//   REGISTRAR=0x... LABS=0x...,0x... npx hardhat run scripts/deploy.js --network sepolia
const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();
  const bc = await ethers.deployContract("BattChain");
  await bc.waitForDeployment();
  console.log(`BattChain di ${hre.network.name}: ${await bc.getAddress()} (admin: ${deployer.address})`);

  if (process.env.REGISTRAR) {
    await (await bc.grantRole(await bc.REGISTRAR_ROLE(), process.env.REGISTRAR)).wait();
    console.log(`REGISTRAR -> ${process.env.REGISTRAR}`);
  }
  for (const lab of (process.env.LABS || "").split(",").filter(Boolean)) {
    await (await bc.grantRole(await bc.LAB_ROLE(), lab.trim())).wait();
    console.log(`LAB -> ${lab.trim()}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
