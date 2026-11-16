// BattChain in-browser chain: menjalankan bytecode BattChain asli di EVM (@ethereumjs/vm).
import { createVM, runTx } from '@ethereumjs/vm';
import { Common, Mainnet, Hardfork } from '@ethereumjs/common';
import { createLegacyTx } from '@ethereumjs/tx';
import { createBlock } from '@ethereumjs/block';
import { Account, createAddressFromPrivateKey, createAddressFromString, hexToBytes, bytesToHex } from '@ethereumjs/util';
import { Interface, getAddress } from 'ethers';

// Kunci uji publik bawaan Hardhat (akun 0-5). Hanya untuk demo, bukan dana sungguhan.
const KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
];

export class Chain {
  constructor(abi, bytecode) {
    this.iface = new Interface(abi);
    this.bytecode = bytecode;
    this.accounts = KEYS.map((k) => {
      const pk = hexToBytes(k);
      const a = createAddressFromPrivateKey(pk);
      return { pk, address: getAddress(a.toString()), addr: a };
    });
    this.blockNumber = 0n;
    this.txs = [];
    this.contract = null;
  }

  async init() {
    this.common = new Common({ chain: Mainnet, hardfork: Hardfork.Cancun });
    this.vm = await createVM({ common: this.common });
    for (const a of this.accounts) {
      await this.vm.stateManager.putAccount(a.addr, new Account(0n, 10_000n * 10n ** 18n));
    }
  }

  _nextBlock() {
    this.blockNumber += 1n;
    const ts = BigInt(Math.floor(Date.now() / 1000));
    return createBlock(
      { header: { number: this.blockNumber, timestamp: ts, gasLimit: 30_000_000n, baseFeePerGas: 1_000_000_000n } },
      { common: this.common, skipConsensusFormatValidation: true },
    );
  }

  async _send(fromIdx, to, data, meta) {
    const acc = this.accounts[fromIdx];
    const nonce = (await this.vm.stateManager.getAccount(acc.addr)).nonce;
    const tx = createLegacyTx(
      { nonce, gasPrice: 1_000_000_000n, gasLimit: 3_000_000n, to: to ? createAddressFromString(to) : undefined, value: 0n, data: hexToBytes(data) },
      { common: this.common },
    ).sign(acc.pk);
    const block = this._nextBlock();
    const res = await runTx(this.vm, { tx, block, skipBlockGasLimitValidation: true, skipHardForkValidation: true });
    const ok = !res.execResult.exceptionError;
    const out = {
      hash: bytesToHex(tx.hash()),
      block: Number(this.blockNumber),
      time: Number(block.header.timestamp),
      from: acc.address,
      fromIdx,
      to,
      ok,
      gas: Number(res.totalGasSpent),
      events: [],
      error: null,
      ...meta,
    };
    if (ok) {
      if (res.createdAddress) out.created = getAddress(res.createdAddress.toString());
      for (const [addr, topics, ldata] of res.receipt.logs) {
        try {
          const p = this.iface.parseLog({ topics: topics.map((t) => bytesToHex(t)), data: bytesToHex(ldata) });
          if (p) out.events.push({ name: p.name, args: p.args, frag: p.fragment });
        } catch (_) {}
      }
    } else {
      out.error = this.decodeError(bytesToHex(res.execResult.returnValue));
    }
    this.txs.push(out);
    return out;
  }

  decodeError(hex) {
    if (!hex || hex === '0x') return { name: 'Revert', args: [], text: 'Revert tanpa alasan' };
    try {
      const e = this.iface.parseError(hex);
      return { name: e.name, args: [...e.args], frag: e.fragment };
    } catch (_) {
      return { name: 'Revert', args: [], raw: hex };
    }
  }

  async deploy(fromIdx = 0) {
    const r = await this._send(fromIdx, null, this.bytecode, { fn: 'deploy', args: [] });
    this.contract = r.created;
    return r;
  }

  async send(fromIdx, fn, args) {
    const data = this.iface.encodeFunctionData(fn, args);
    return this._send(fromIdx, this.contract, data, { fn, args });
  }

  async call(fn, args = [], fromIdx = 0) {
    const data = this.iface.encodeFunctionData(fn, args);
    const block = createBlock(
      { header: { number: this.blockNumber, timestamp: BigInt(Math.floor(Date.now() / 1000)), gasLimit: 30_000_000n, baseFeePerGas: 1_000_000_000n } },
      { common: this.common, skipConsensusFormatValidation: true },
    );
    const vm2 = await this.vm.shallowCopy();
    const res = await vm2.evm.runCall({
      to: createAddressFromString(this.contract),
      caller: this.accounts[fromIdx].addr,
      origin: this.accounts[fromIdx].addr,
      data: hexToBytes(data),
      gasLimit: 30_000_000n,
      block,
    });
    if (res.execResult.exceptionError) throw new Error('call failed');
    return this.iface.decodeFunctionResult(fn, bytesToHex(res.execResult.returnValue));
  }
}
