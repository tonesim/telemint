import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano } from '@ton/core';

export type NftItemConfig = {
    itemIndex: bigint;
    collectionAddress: Address;
};

export type NftItemState = {
    ownerAddress: Address;
    content: Cell;
    auction: Cell | null;
    royaltyParams: Cell;
};

export function nftItemConfigToCell(config: NftItemConfig): Cell {
    return beginCell()
        .storeUint(config.itemIndex, 256)
        .storeAddress(config.collectionAddress)
        .endCell();
}

export function nftItemDataToCell(config: NftItemConfig, state: NftItemState | null): Cell {
    const configCell = nftItemConfigToCell(config);
    const stateCell = state
        ? beginCell()
              .storeAddress(state.ownerAddress)
              .storeRef(state.content)
              .storeMaybeRef(state.auction)
              .storeRef(state.royaltyParams)
              .endCell()
        : null;

    return beginCell().storeRef(configCell).storeMaybeRef(stateCell).endCell();
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

    async sendBid(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendStartAuction(
        provider: ContractProvider,
        via: Sender,
        opts: {
            value: bigint;
            queryId?: number;
            auctionConfig: Cell;
        }
    ) {
        const msg = beginCell()
            .storeUint(0x487a8e81, 32) // op::teleitem_start_auction
            .storeUint(opts.queryId || 0, 64)
            .storeRef(opts.auctionConfig)
            .endCell();

        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: msg,
        });
    }

    async sendCancelAuction(provider: ContractProvider, via: Sender, opts: { value: bigint; queryId?: number }) {
        const msg = beginCell()
            .storeUint(0x371638ae, 32) // op::teleitem_cancel_auction
            .storeUint(opts.queryId || 0, 64)
            .endCell();

        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: msg,
        });
    }

    async sendTransfer(
        provider: ContractProvider,
        via: Sender,
        opts: {
            value: bigint;
            queryId?: number;
            newOwner: Address;
            responseDestination?: Address;
            customPayload?: Cell;
            forwardAmount?: bigint;
            forwardPayload?: Cell;
        }
    ) {
        const msg = beginCell()
            .storeUint(0x5fcc3d14, 32) // op::nft_cmd_transfer
            .storeUint(opts.queryId || 0, 64)
            .storeAddress(opts.newOwner)
            .storeAddress(opts.responseDestination || Address.parse('EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c'))
            .storeMaybeRef(opts.customPayload)
            .storeCoins(opts.forwardAmount || 0n)
            .storeMaybeRef(opts.forwardPayload)
            .endCell();

        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: msg,
        });
    }

    async sendTopup(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeStringTail('#topup').endCell(),
        });
    }

    async getNftData(provider: ContractProvider): Promise<{
        init: boolean;
        index: bigint;
        collectionAddress: Address;
        ownerAddress: Address;
        individualContent: Cell | null;
    }> {
        const result = await provider.get('get_nft_data', []);
        const init = result.stack.readNumber() !== 0;
        const index = result.stack.readBigNumber();
        const collectionAddress = result.stack.readAddress();
        const ownerAddress = result.stack.readAddress();
        const individualContent = result.stack.remaining > 0 ? result.stack.readCellOpt() : null;

        return {
            init,
            index,
            collectionAddress,
            ownerAddress,
            individualContent,
        };
    }

    async getFullDomain(provider: ContractProvider): Promise<string> {
        const result = await provider.get('get_full_domain', []);
        return result.stack.readString();
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
        const bidderAddress = result.stack.readAddressOpt();
        const bid = result.stack.readBigNumber();
        const bidTs = result.stack.readNumber();
        const minBid = result.stack.readBigNumber();
        const endTime = result.stack.readNumber();

        return {
            bidderAddress,
            bid,
            bidTs,
            minBid,
            endTime,
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
        const beneficiaryAddress = result.stack.readAddressOpt();
        const initialMinBid = result.stack.readBigNumber();
        const maxBid = result.stack.readBigNumber();
        const minBidStep = result.stack.readNumber();
        const minExtendTime = result.stack.readNumber();
        const duration = result.stack.readNumber();

        return {
            beneficiaryAddress,
            initialMinBid,
            maxBid,
            minBidStep,
            minExtendTime,
            duration,
        };
    }

    async getRoyaltyParams(provider: ContractProvider): Promise<{
        numerator: number;
        denominator: number;
        destination: Address;
    }> {
        const result = await provider.get('royalty_params', []);
        const numerator = result.stack.readNumber();
        const denominator = result.stack.readNumber();
        const destination = result.stack.readAddress();

        return {
            numerator,
            denominator,
            destination,
        };
    }

    async getStaticData(provider: ContractProvider): Promise<{ index: bigint; collectionAddress: Address }> {
        const result = await provider.get('get_static_data', []);
        return {
            index: result.stack.readBigNumber(),
            collectionAddress: result.stack.readAddress(),
        };
    }

    async dnsResolve(provider: ContractProvider, subdomain: string, category: number = 0): Promise<{ bits: number; result: Cell | null }> {
        const subdomainCell = beginCell().storeStringTail(subdomain).endCell();
        const result = await provider.get('dnsresolve', [
            { type: 'slice', cell: subdomainCell },
            { type: 'int', value: BigInt(category) },
        ]);
        const bits = result.stack.readNumber();
        const resultCell = result.stack.remaining > 0 ? result.stack.readCellOpt() : null;
        return { bits, result: resultCell };
    }
}

