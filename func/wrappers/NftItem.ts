import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode } from '@ton/core';

export type NftItemConfig = {
    itemIndex: bigint;
    collectionAddress: Address;
};

export function nftItemConfigToCell(config: NftItemConfig): Cell {
    return beginCell()
        .storeUint(config.itemIndex, 256)
        .storeAddress(config.collectionAddress)
        .endCell();
}

export class NftItem implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new NftItem(address);
    }

    static createFromConfig(config: NftItemConfig, code: Cell, workchain = 0) {
        const data = beginCell().storeRef(nftItemConfigToCell(config)).storeMaybeRef(null).endCell();
        const init = { code, data };
        return new NftItem(contractAddress(workchain, init), init);
    }

    async send(provider: ContractProvider, via: Sender, opts: {
        value: bigint;
        bounce?: boolean;
        sendMode?: SendMode;
        body?: Cell;
    }) {
        await provider.internal(via, opts);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.external(beginCell().endCell());
    }

    async getNftData(provider: ContractProvider): Promise<{
        init: boolean;
        index: bigint;
        collectionAddress: Address;
        ownerAddress: Address | null;
        content: Cell | null;
    }> {
        const result = await provider.get('get_nft_data', []);
        return {
            init: result.stack.readNumber() !== 0,
            index: result.stack.readBigNumber(),
            collectionAddress: result.stack.readAddress(),
            ownerAddress: result.stack.remaining > 0 ? result.stack.readAddress() : null,
            content: result.stack.remaining > 0 ? result.stack.readCell() : null,
        };
    }

    async getTelemintTokenName(provider: ContractProvider): Promise<string> {
        const result = await provider.get('get_telemint_token_name', []);
        return result.stack.readString();
    }

    async getTelemintAuctionState(provider: ContractProvider): Promise<{
        bidderAddress: Address | null;
        bid: bigint;
        bidTs: number;
        minBid: bigint;
        endTime: number;
    }> {
        const result = await provider.get('get_telemint_auction_state', []);
        return {
            bidderAddress: result.stack.readAddressOpt(),
            bid: result.stack.readBigNumber(),
            bidTs: result.stack.readNumber(),
            minBid: result.stack.readBigNumber(),
            endTime: result.stack.readNumber(),
        };
    }

    async getTelemintAuctionConfig(provider: ContractProvider): Promise<{
        beneficiaryAddress: Address | null;
        initialMinBid: bigint;
        maxBid: bigint;
        minBidStep: number;
        minExtendTime: number;
        duration: number;
    }> {
        const result = await provider.get('get_telemint_auction_config', []);
        return {
            beneficiaryAddress: result.stack.readAddressOpt(),
            initialMinBid: result.stack.readBigNumber(),
            maxBid: result.stack.readBigNumber(),
            minBidStep: result.stack.readNumber(),
            minExtendTime: result.stack.readNumber(),
            duration: result.stack.readNumber(),
        };
    }

    async getRoyaltyParams(provider: ContractProvider): Promise<{
        numerator: number;
        denominator: number;
        destination: Address;
    }> {
        const result = await provider.get('royalty_params', []);
        return {
            numerator: result.stack.readNumber(),
            denominator: result.stack.readNumber(),
            destination: result.stack.readAddress(),
        };
    }
}

