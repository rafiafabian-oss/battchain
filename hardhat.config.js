require("@nomicfoundation/hardhat-toolbox");

// Jaringan testnet hanya aktif kalau variabel lingkungan diisi (lihat README).
const networks = {};
if (process.env.SEPOLIA_RPC_URL && process.env.PRIVATE_KEY) {
  networks.sepolia = {
    url: process.env.SEPOLIA_RPC_URL,
    accounts: [process.env.PRIVATE_KEY],
  };
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks,
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true" || process.env.npm_lifecycle_event === "gas",
    noColors: true,
    showMethodSig: false,
  },
};
