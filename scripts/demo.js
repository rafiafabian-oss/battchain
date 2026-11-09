// Menjalankan skenario demo BattChain dari awal sampai akhir.
//   npx hardhat run scripts/demo.js                      (jaringan sementara di memori)
//   npx hardhat run scripts/demo.js --network localhost  (ke `npx hardhat node`, untuk halaman web)
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers } = hre;

const hashFile = (nama) =>
  ethers.sha256(fs.readFileSync(path.join(__dirname, "..", "contoh-laporan", nama)));

function alasan(err) {
  const m = /custom error '([^']+)'/.exec(err.message || "");
  const r = m ? m[1] : err.shortMessage || err.message;
  return r.replace(/^AccessControlUnauthorizedAccount\(.*\)$/, "AccessControlUnauthorizedAccount (tidak punya peran LAB)");
}

async function main() {
  const [admin, pabrikan, labA, labB, penjual, pembeli] = await ethers.getSigners();
  const bc = await ethers.deployContract("BattChain");
  await bc.waitForDeployment();
  const address = await bc.getAddress();
  const id = await bc.idOf("PACK-001");

  const baris = [];
  async function langkah(no, aktor, aksi, kirim) {
    try {
      const tx = await kirim();
      const r = await tx.wait();
      baris.push([no, aktor, aksi, "DITERIMA", `gas ${r.gasUsed.toLocaleString("id-ID")}`]);
    } catch (e) {
      baris.push([no, aktor, aksi, "DITOLAK", alasan(e)]);
    }
  }

  const LAB = await bc.LAB_ROLE();
  const REGISTRAR = await bc.REGISTRAR_ROLE();
  const H1 = hashFile("lab-a-uji-2026-11-02.txt");
  const H2 = hashFile("lab-b-uji-2026-11-05.txt");
  const H3 = hashFile("lab-a-refurbish-2026-11-07.txt");

  await langkah("1", "Admin", "beri peran REGISTRAR ke pabrikan", () => bc.grantRole(REGISTRAR, pabrikan.address));
  await langkah("1", "Admin", "beri peran LAB ke Lab A dan Lab B", async () => {
    await (await bc.grantRole(LAB, labA.address)).wait();
    return bc.grantRole(LAB, labB.address);
  });
  await langkah("2", "Pabrikan", "registerBattery(PACK-001, 60 kWh)", () => bc.connect(pabrikan).registerBattery(id, 60000));
  await langkah("3", "Lab A", "recordTest: SOH 94,00%, 18.000 km, 320 siklus", () => bc.connect(labA).recordTest(id, 9400, 18000, 320, H1));
  await langkah("4", "Lab B", "recordTest: SOH 97,50% (melonjak)", () => bc.connect(labB).recordTest(id, 9750, 25000, 400, H2));
  await langkah("5", "Lab B", "recordTest: odometer 15.000 km (mundur)", () => bc.connect(labB).recordTest(id, 9100, 15000, 400, H2));
  await langkah("6", "Penjual", "recordTest: SOH 99,00% (bukan lab)", () => bc.connect(penjual).recordTest(id, 9900, 26000, 410, H2));
  await langkah("7", "Lab B", "recordTest: SOH 91,00%, 25.000 km, 450 siklus", () => bc.connect(labB).recordTest(id, 9100, 25000, 450, H2));
  await langkah("8", "Lab A", "recordRefurbish: SOH 98,00%, 26.000 km", () => bc.connect(labA).recordRefurbish(id, 9800, 26000, 455, H3));

  console.log(`\nBattChain di ${hre.network.name}: ${address}\n`);
  for (const [no, aktor, aksi, hasil, ket] of baris) {
    console.log(`${no.padEnd(2)} ${aktor.padEnd(9)} ${aksi.padEnd(47)} ${hasil.padEnd(9)} ${ket}`);
  }

  const h = await bc.connect(pembeli).getHistory(id);
  console.log(`\n9  Pembeli   getHistory(PACK-001): ${h.length} catatan dari ${new Set(h.map((r) => r.lab)).size} lab`);
  h.forEach((r, i) =>
    console.log(`   #${i} ${r.lab.slice(0, 8)}…  SOH ${(Number(r.sohBps) / 100).toFixed(2)}%  ${r.odometerKm} km  ${r.cycleCount} siklus  ${r.refurbish ? "refurbish" : "uji"}`)
  );

  if (hre.network.name === "localhost") {
    console.log(`\nHalaman verifikasi: buka web/index.html?address=${address}&pack=PACK-001`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
