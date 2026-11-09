// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title BattChain — riwayat uji kesehatan (SOH) baterai EV yang tidak bisa disembunyikan
/// @notice MVP proyek ET-4133 Infrastruktur Blockchain. SOH disimpan dalam basis poin (9400 = 94,00%).
contract BattChain is AccessControl {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE"); // pabrikan / importir
    bytes32 public constant LAB_ROLE = keccak256("LAB_ROLE");             // lab uji terdaftar

    uint16 public constant SOH_MAX_BPS = 10_000; // 100,00%
    uint16 public sohToleranceBps = 300;         // toleransi beda alat ukur: 3 poin (asumsi, bisa diubah admin)

    struct Battery {
        bool registered;
        uint32 nominalWh;
        address registrar;
    }

    struct TestRecord {
        address lab;
        uint64 timestamp;
        uint16 sohBps;
        uint32 odometerKm;
        uint32 cycleCount;
        bytes32 reportHash; // hash SHA-256 laporan uji yang disimpan off-chain
        bool refurbish;
    }

    mapping(bytes32 => Battery) public batteries;
    mapping(bytes32 => TestRecord[]) private history;

    error AlreadyRegistered();
    error NotRegistered();
    error SohOutOfRange();
    error OdometerRollback(uint32 last, uint32 given);
    error CycleRollback(uint32 last, uint32 given);
    error SohIncreaseTooLarge(uint16 last, uint16 given);

    event BatteryRegistered(bytes32 indexed batteryId, uint32 nominalWh, address registrar);
    event TestRecorded(
        bytes32 indexed batteryId, uint256 index, address indexed lab,
        uint16 sohBps, uint32 odometerKm, uint32 cycleCount, bool refurbish
    );

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender); // admin konsorsium
    }

    /// Helper untuk demo di Remix: ID baterai = keccak256(nomor seri pack)
    function idOf(string calldata packSerial) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(packSerial));
    }

    function registerBattery(bytes32 batteryId, uint32 nominalWh) external onlyRole(REGISTRAR_ROLE) {
        if (batteries[batteryId].registered) revert AlreadyRegistered();
        batteries[batteryId] = Battery(true, nominalWh, msg.sender);
        emit BatteryRegistered(batteryId, nominalWh, msg.sender);
    }

    function recordTest(bytes32 batteryId, uint16 sohBps, uint32 odometerKm, uint32 cycleCount, bytes32 reportHash)
        external onlyRole(LAB_ROLE)
    {
        _record(batteryId, sohBps, odometerKm, cycleCount, reportHash, false);
    }

    /// Penggantian modul/sel: SOH boleh naik, tetapi odometer dan siklus tetap tidak boleh mundur
    function recordRefurbish(bytes32 batteryId, uint16 sohBps, uint32 odometerKm, uint32 cycleCount, bytes32 reportHash)
        external onlyRole(LAB_ROLE)
    {
        _record(batteryId, sohBps, odometerKm, cycleCount, reportHash, true);
    }

    function getHistory(bytes32 batteryId) external view returns (TestRecord[] memory) {
        return history[batteryId];
    }

    function setSohTolerance(uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        sohToleranceBps = bps;
    }

    function _record(bytes32 id, uint16 sohBps, uint32 km, uint32 cycles, bytes32 reportHash, bool refurbish) internal {
        if (!batteries[id].registered) revert NotRegistered();
        if (sohBps == 0 || sohBps > SOH_MAX_BPS) revert SohOutOfRange();

        TestRecord[] storage h = history[id];
        if (h.length > 0) {
            TestRecord storage last = h[h.length - 1];
            if (km < last.odometerKm) revert OdometerRollback(last.odometerKm, km);
            if (cycles < last.cycleCount) revert CycleRollback(last.cycleCount, cycles);
            if (!refurbish && uint256(sohBps) > uint256(last.sohBps) + sohToleranceBps) {
                revert SohIncreaseTooLarge(last.sohBps, sohBps);
            }
        }

        h.push(TestRecord(msg.sender, uint64(block.timestamp), sohBps, km, cycles, reportHash, refurbish));
        emit TestRecorded(id, h.length - 1, msg.sender, sohBps, km, cycles, refurbish);
    }
}
