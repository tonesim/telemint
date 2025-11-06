import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano } from '@ton/core';
import { NftItem, NftItemConfig, nftItemConfigToCell } from './NftItem';

export class NftItemNoDnsCheapDelayed extends NftItem {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {
        super(address, init);
    }

    static createFromAddress(address: Address) {
        return new NftItemNoDnsCheapDelayed(address);
    }

    static createFromConfig(config: NftItemConfig, code: Cell, workchain = 0) {
        const data = beginCell().storeRef(nftItemConfigToCell(config)).storeMaybeRef(null).endCell();
        const init = { code, data };
        return new NftItemNoDnsCheapDelayed(contractAddress(workchain, init), init);
    }
}

