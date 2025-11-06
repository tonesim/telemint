import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano } from '@ton/core';

export type NftCollectionConfig = {
    touched: boolean;
    subwalletId: number;
    publicKey: bigint;
    collectionContent: Cell;
    nftItemCode: Cell;
    fullDomain: string;
    royaltyParams: Cell;
};

export function nftCollectionConfigToCell(config: NftCollectionConfig): Cell {
    return beginCell()
        .storeInt(config.touched ? -1 : 0, 1)
        .storeUint(config.subwalletId, 32)
        .storeUint(config.publicKey, 256)
        .storeRef(config.collectionContent)
        .storeRef(config.nftItemCode)
        .storeRef(
            beginCell()
                .storeUint(config.fullDomain.length, 8)
                .storeStringTail(config.fullDomain)
                .endCell()
        )
        .storeRef(config.royaltyParams)
        .endCell();
}

export class NftCollection implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new NftCollection(address);
    }

    static createFromConfig(config: NftCollectionConfig, code: Cell, workchain = 0) {
        const data = nftCollectionConfigToCell(config);
        const init = { code, data };
        return new NftCollection(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.external(beginCell().endCell());
    }

    async sendDeployMessage(
        provider: ContractProvider,
        via: Sender,
        opts: {
            value: bigint;
            signature: Buffer;
            subwalletId: number;
            validSince: number;
            validTill: number;
            tokenName: string;
            content: Cell;
            auctionConfig: Cell;
            royaltyParams?: Cell;
        }
    ) {
        const unsignedDeploy = beginCell()
            .storeUint(opts.subwalletId, 32)
            .storeUint(opts.validSince, 32)
            .storeUint(opts.validTill, 32)
            .storeUint(opts.tokenName.length, 8)
            .storeStringTail(opts.tokenName)
            .storeRef(opts.content)
            .storeRef(opts.auctionConfig)
            .storeMaybeRef(opts.royaltyParams)
            .endCell();

        const msg = beginCell()
            .storeUint(0x4637289a, 32) // op::telemint_msg_deploy
            .storeBuffer(opts.signature)
            .storeRef(unsignedDeploy)
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

    async getCollectionData(provider: ContractProvider): Promise<{ index: number; collectionContent: Cell; ownerAddress: Address }> {
        const result = await provider.get('get_collection_data', []);
        return {
            index: result.stack.readNumber(),
            collectionContent: result.stack.readCell(),
            ownerAddress: result.stack.readAddress(),
        };
    }

    async getStaticData(provider: ContractProvider): Promise<{ index: bigint; collectionAddress: Address }> {
        const result = await provider.get('get_static_data', []);
        return {
            index: result.stack.readBigNumber(),
            collectionAddress: result.stack.readAddress(),
        };
    }

    async getFullDomain(provider: ContractProvider): Promise<string> {
        const result = await provider.get('get_full_domain', []);
        return result.stack.readString();
    }

    async getNftAddressByIndex(provider: ContractProvider, index: bigint): Promise<Address> {
        const result = await provider.get('get_nft_address_by_index', [
            { type: 'int', value: index },
        ]);
        return result.stack.readAddress();
    }

    async getNftContent(provider: ContractProvider, index: bigint, individualNftContent: Cell): Promise<Cell> {
        const result = await provider.get('get_nft_content', [
            { type: 'int', value: index },
            { type: 'cell', cell: individualNftContent },
        ]);
        return result.stack.readCell();
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

