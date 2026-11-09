const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");

// Hash laporan uji contoh (di sistem nyata: SHA-256 dari file PDF laporan lab)
const laporan = (teks) => ethers.sha256(ethers.toUtf8Bytes(teks));
const H1 = laporan("laporan-lab-a-uji-1");
const H2 = laporan("laporan-lab-b-uji-1");
const H3 = laporan("laporan-lab-a-refurbish");

async function deployFixture() {
  const [admin, pabrikan, labA, labB, penjual, pembeli] = await ethers.getSigners();
  const bc = await ethers.deployContract("BattChain");
  const REGISTRAR = await bc.REGISTRAR_ROLE();
  const LAB = await bc.LAB_ROLE();
  await bc.grantRole(REGISTRAR, pabrikan.address);
  await bc.grantRole(LAB, labA.address);
  await bc.grantRole(LAB, labB.address);
  const id = await bc.idOf("PACK-001");
  return { bc, admin, pabrikan, labA, labB, penjual, pembeli, REGISTRAR, LAB, id };
}

// Baterai terdaftar + satu hasil uji awal dari Lab A: SOH 94,00%, 18.000 km, 320 siklus
async function registeredWithFirstTest() {
  const f = await deployFixture();
  await f.bc.connect(f.pabrikan).registerBattery(f.id, 60000);
  await f.bc.connect(f.labA).recordTest(f.id, 9400, 18000, 320, H1);
  return f;
}

describe("BattChain", function () {
  describe("Deploy & helper", function () {
    it("memberi peran admin ke akun yang men-deploy", async function () {
      const { bc, admin } = await loadFixture(deployFixture);
      expect(await bc.hasRole(await bc.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
    });

    it("memakai toleransi kenaikan SOH 3 poin (300 bps) sebagai bawaan", async function () {
      const { bc } = await loadFixture(deployFixture);
      expect(await bc.sohToleranceBps()).to.equal(300);
    });

    it("idOf = keccak256(nomor seri pack)", async function () {
      const { id } = await loadFixture(deployFixture);
      expect(id).to.equal(ethers.keccak256(ethers.toUtf8Bytes("PACK-001")));
    });
  });

  describe("Aturan 1 · peran (access control)", function () {
    it("menolak akun tanpa peran REGISTRAR yang mendaftarkan baterai", async function () {
      const { bc, penjual, REGISTRAR, id } = await loadFixture(deployFixture);
      await expect(bc.connect(penjual).registerBattery(id, 60000))
        .to.be.revertedWithCustomError(bc, "AccessControlUnauthorizedAccount")
        .withArgs(penjual.address, REGISTRAR);
    });

    it("menolak penjual (bukan lab) yang mencoba menulis hasil uji", async function () {
      const { bc, penjual, LAB, id } = await loadFixture(registeredWithFirstTest);
      await expect(bc.connect(penjual).recordTest(id, 9900, 26000, 410, H2))
        .to.be.revertedWithCustomError(bc, "AccessControlUnauthorizedAccount")
        .withArgs(penjual.address, LAB);
    });

    it("menolak pabrikan yang mencoba menulis hasil uji baterainya sendiri", async function () {
      const { bc, pabrikan, LAB, id } = await loadFixture(registeredWithFirstTest);
      await expect(bc.connect(pabrikan).recordTest(id, 9900, 26000, 410, H2))
        .to.be.revertedWithCustomError(bc, "AccessControlUnauthorizedAccount")
        .withArgs(pabrikan.address, LAB);
    });

    it("menolak bengkel tanpa peran LAB yang mencatat refurbish", async function () {
      const { bc, penjual, LAB, id } = await loadFixture(registeredWithFirstTest);
      await expect(bc.connect(penjual).recordRefurbish(id, 9800, 26000, 455, H3))
        .to.be.revertedWithCustomError(bc, "AccessControlUnauthorizedAccount")
        .withArgs(penjual.address, LAB);
    });

    it("hanya admin yang boleh mengubah toleransi SOH", async function () {
      const { bc, labA, admin } = await loadFixture(deployFixture);
      await expect(bc.connect(labA).setSohTolerance(1000))
        .to.be.revertedWithCustomError(bc, "AccessControlUnauthorizedAccount");
      await bc.connect(admin).setSohTolerance(500);
      expect(await bc.sohToleranceBps()).to.equal(500);
    });

    it("lab yang perannya dicabut admin tidak bisa menulis lagi", async function () {
      const { bc, admin, labB, LAB, id } = await loadFixture(registeredWithFirstTest);
      await bc.connect(admin).revokeRole(LAB, labB.address);
      await expect(bc.connect(labB).recordTest(id, 9300, 20000, 350, H2))
        .to.be.revertedWithCustomError(bc, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Aturan 2 · baterai harus terdaftar, tidak boleh ganda", function () {
    it("mendaftarkan baterai dan mengirim event BatteryRegistered", async function () {
      const { bc, pabrikan, id } = await loadFixture(deployFixture);
      await expect(bc.connect(pabrikan).registerBattery(id, 60000))
        .to.emit(bc, "BatteryRegistered")
        .withArgs(id, 60000, pabrikan.address);
      const b = await bc.batteries(id);
      expect(b.registered).to.equal(true);
      expect(b.nominalWh).to.equal(60000);
      expect(b.registrar).to.equal(pabrikan.address);
    });

    it("menolak pendaftaran ulang ID yang sama (AlreadyRegistered)", async function () {
      const { bc, pabrikan, id } = await loadFixture(registeredWithFirstTest);
      await expect(bc.connect(pabrikan).registerBattery(id, 60000))
        .to.be.revertedWithCustomError(bc, "AlreadyRegistered");
    });

    it("menolak hasil uji untuk baterai yang belum terdaftar (NotRegistered)", async function () {
      const { bc, labA } = await loadFixture(deployFixture);
      const idLain = await bc.idOf("PACK-999");
      await expect(bc.connect(labA).recordTest(idLain, 9000, 1000, 10, H1))
        .to.be.revertedWithCustomError(bc, "NotRegistered");
    });
  });

  describe("Aturan 3 · SOH harus 0,01–100%", function () {
    it("menolak SOH 0", async function () {
      const { bc, pabrikan, labA, id } = await loadFixture(deployFixture);
      await bc.connect(pabrikan).registerBattery(id, 60000);
      await expect(bc.connect(labA).recordTest(id, 0, 1000, 10, H1))
        .to.be.revertedWithCustomError(bc, "SohOutOfRange");
    });

    it("menolak SOH 105,00% (10500 bps)", async function () {
      const { bc, labB, id } = await loadFixture(registeredWithFirstTest);
      await expect(bc.connect(labB).recordTest(id, 10500, 25000, 400, H2))
        .to.be.revertedWithCustomError(bc, "SohOutOfRange");
    });

    it("menerima SOH tepat 100,00% pada uji pertama", async function () {
      const { bc, pabrikan, labA, id } = await loadFixture(deployFixture);
      await bc.connect(pabrikan).registerBattery(id, 60000);
      await expect(bc.connect(labA).recordTest(id, 10000, 0, 0, H1)).to.not.be.reverted;
    });
  });

  describe("Aturan 4 & 5 · odometer dan siklus tidak boleh mundur", function () {
    it("menolak odometer yang mundur (OdometerRollback)", async function () {
      const { bc, labB, id } = await loadFixture(registeredWithFirstTest);
      await expect(bc.connect(labB).recordTest(id, 9100, 15000, 400, H2))
        .to.be.revertedWithCustomError(bc, "OdometerRollback")
        .withArgs(18000, 15000);
    });

    it("menolak jumlah siklus yang berkurang (CycleRollback)", async function () {
      const { bc, labB, id } = await loadFixture(registeredWithFirstTest);
      await expect(bc.connect(labB).recordTest(id, 9100, 25000, 300, H2))
        .to.be.revertedWithCustomError(bc, "CycleRollback")
        .withArgs(320, 300);
    });

    it("menerima odometer dan siklus yang sama (uji ulang di hari yang sama)", async function () {
      const { bc, labB, id } = await loadFixture(registeredWithFirstTest);
      await expect(bc.connect(labB).recordTest(id, 9350, 18000, 320, H2)).to.not.be.reverted;
    });

    it("refurbish tetap tidak boleh memundurkan odometer", async function () {
      const { bc, labA, id } = await loadFixture(registeredWithFirstTest);
      await expect(bc.connect(labA).recordRefurbish(id, 9800, 17000, 330, H3))
        .to.be.revertedWithCustomError(bc, "OdometerRollback");
    });
  });

  describe("Aturan 6 · SOH tidak boleh melonjak tanpa refurbish", function () {
    it("menolak kenaikan 3,5 poin (94,00% → 97,50%)", async function () {
      const { bc, labB, id } = await loadFixture(registeredWithFirstTest);
      await expect(bc.connect(labB).recordTest(id, 9750, 25000, 400, H2))
        .to.be.revertedWithCustomError(bc, "SohIncreaseTooLarge")
        .withArgs(9400, 9750);
    });

    it("menerima kenaikan tepat 3 poin (batas toleransi alat ukur)", async function () {
      const { bc, labB, id } = await loadFixture(registeredWithFirstTest);
      await expect(bc.connect(labB).recordTest(id, 9700, 25000, 400, H2)).to.not.be.reverted;
    });

    it("menerima kenaikan besar kalau dicatat sebagai refurbish", async function () {
      const { bc, labA, id } = await loadFixture(registeredWithFirstTest);
      await expect(bc.connect(labA).recordRefurbish(id, 9800, 26000, 455, H3))
        .to.emit(bc, "TestRecorded")
        .withArgs(id, 1, labA.address, 9800, 26000, 455, true);
    });

    it("mengikuti toleransi baru setelah diubah admin", async function () {
      const { bc, admin, labB, id } = await loadFixture(registeredWithFirstTest);
      await bc.connect(admin).setSohTolerance(500);
      await expect(bc.connect(labB).recordTest(id, 9800, 25000, 400, H2)).to.not.be.reverted;
    });
  });

  describe("Riwayat & skenario demo end-to-end", function () {
    it("menjalankan skenario demo: 3 percobaan curang ditolak, riwayat berisi 3 catatan dari 2 lab", async function () {
      const { bc, labA, labB, penjual, pembeli, id } = await loadFixture(registeredWithFirstTest);

      await expect(bc.connect(labB).recordTest(id, 9750, 25000, 400, H2))
        .to.be.revertedWithCustomError(bc, "SohIncreaseTooLarge");
      await expect(bc.connect(labB).recordTest(id, 9100, 15000, 400, H2))
        .to.be.revertedWithCustomError(bc, "OdometerRollback");
      await expect(bc.connect(penjual).recordTest(id, 9900, 26000, 410, H2))
        .to.be.revertedWithCustomError(bc, "AccessControlUnauthorizedAccount");

      await bc.connect(labB).recordTest(id, 9100, 25000, 450, H2);
      await bc.connect(labA).recordRefurbish(id, 9800, 26000, 455, H3);

      const h = await bc.connect(pembeli).getHistory(id);
      expect(h.length).to.equal(3);
      expect(h.map((r) => r.lab)).to.deep.equal([labA.address, labB.address, labA.address]);
      expect(h.map((r) => Number(r.sohBps))).to.deep.equal([9400, 9100, 9800]);
      expect(h.map((r) => r.refurbish)).to.deep.equal([false, false, true]);
      expect(h.map((r) => r.reportHash)).to.deep.equal([H1, H2, H3]);
      expect(h[2].timestamp).to.be.greaterThan(0);
    });

    it("riwayat baterai lain tetap terpisah", async function () {
      const { bc, pabrikan, labA, id } = await loadFixture(registeredWithFirstTest);
      const id2 = await bc.idOf("PACK-002");
      await bc.connect(pabrikan).registerBattery(id2, 75000);
      await bc.connect(labA).recordTest(id2, 8800, 52000, 900, H2);
      expect((await bc.getHistory(id)).length).to.equal(1);
      expect((await bc.getHistory(id2)).length).to.equal(1);
    });
  });
});
