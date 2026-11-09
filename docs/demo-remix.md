# Demo BattChain di Remix VM

Panduan ini menjalankan skenario demo yang sama dengan `scripts/demo.js`, tapi lewat [Remix](https://remix.ethereum.org) supaya bisa ditunjukkan langsung di kelas.

## 1. Siapkan kontrak

1. Buka https://remix.ethereum.org, buat file baru `BattChain.sol`, lalu tempel isi `contracts/BattChain.sol`.
2. Tab **Solidity Compiler**: pilih versi **0.8.28** (atau 0.8.24 ke atas), klik **Compile BattChain.sol**. Impor OpenZeppelin diunduh otomatis.
3. Tab **Deploy & Run Transactions**: Environment **Remix VM**, akun pertama terpilih, klik **Deploy**.

## 2. Pembagian akun Remix VM

| Akun di dropdown | Peran dalam demo |
|---|---|
| Akun 1 | Admin konsorsium (yang men-deploy) |
| Akun 2 | Pabrikan (REGISTRAR) |
| Akun 3 | Lab A (LAB) |
| Akun 4 | Lab B (LAB) |
| Akun 5 | Penjual (tanpa peran) |
| Akun 6 | Pembeli (hanya membaca) |

Salin alamat tiap akun dengan ikon salin di sebelah dropdown.

## 3. Nilai yang dipakai berulang

- Klik `REGISTRAR_ROLE` dan `LAB_ROLE` (tombol biru) untuk mendapatkan nilai perannya.
- Isi `idOf` dengan `PACK-001` lalu klik. Hasilnya: `0x19e8a6542e800c88535a6065f0499c16106cee58334f8b61d995c1d437bfd883`.
- Hash laporan (SHA-256 dari file di `contoh-laporan/`):
  - H1, Lab A uji 2 Nov: `0x933abfe3beb11fb244aca9567f8930f56dc54abfed02e02979985cb1dfb1e283`
  - H2, Lab B uji 5 Nov: `0x3e6ed707149ba9873e68167c898e73609234d04e087c09ca6188ba7eb57ebec8`
  - H3, Lab A refurbish 7 Nov: `0x68978ae4e36fbb9f25913afe023a14a421530453870220d8acdd17e4a09d3de3`

## 4. Skenario

| # | Akun | Panggilan | Hasil yang diharapkan |
|---|---|---|---|
| 1 | Admin | `grantRole(REGISTRAR_ROLE, akun 2)`, `grantRole(LAB_ROLE, akun 3)`, `grantRole(LAB_ROLE, akun 4)` | diterima |
| 2 | Pabrikan | `registerBattery(id, 60000)` | diterima, event `BatteryRegistered` |
| 3 | Lab A | `recordTest(id, 9400, 18000, 320, H1)` | diterima |
| 4 | Lab B | `recordTest(id, 9750, 25000, 400, H2)` | **ditolak** `SohIncreaseTooLarge(9400, 9750)` |
| 5 | Lab B | `recordTest(id, 9100, 15000, 400, H2)` | **ditolak** `OdometerRollback(18000, 15000)` |
| 6 | Penjual | `recordTest(id, 9900, 26000, 410, H2)` | **ditolak** `AccessControlUnauthorizedAccount` |
| 7 | Lab B | `recordTest(id, 9100, 25000, 450, H2)` | diterima |
| 8 | Lab A | `recordRefurbish(id, 9800, 26000, 455, H3)` | diterima (SOH boleh naik karena refurbish) |
| 9 | Pembeli | `getHistory(id)` | 3 catatan dari 2 lab, tanpa transaksi |

Pesan error muncul di terminal Remix (bagian bawah). Klik baris transaksi untuk melihat detail dan event-nya.

## 5. Screenshot untuk deck

1. Kontrak ter-deploy di panel *Deployed Contracts*.
2. Langkah 4, 5, dan 6 yang ditolak, dengan nama error terlihat di terminal.
3. Hasil `getHistory` di langkah 9.
