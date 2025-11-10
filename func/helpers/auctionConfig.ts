import { Address, beginCell, Cell } from '@ton/core';

export type AuctionConfigParams = {
    beneficiaryAddress: Address;
    initialMinBid: bigint;
    maxBid?: bigint;
    minBidStep?: number;
    minExtendTime?: number;
    duration?: number;
};

export function createDirectMintAuctionConfig(params: {
    beneficiaryAddress: Address;
    mintPrice: bigint;
}): Cell {
    return createAuctionConfig({
        beneficiaryAddress: params.beneficiaryAddress,
        initialMinBid: params.mintPrice,
        maxBid: params.mintPrice,
        minBidStep: 1,
        minExtendTime: 0,
        duration: 0,
    });
}

export function createAuctionConfig(params: AuctionConfigParams): Cell {
    const {
        beneficiaryAddress,
        initialMinBid,
        maxBid = 0n,
        minBidStep = 5,
        minExtendTime = 300,
        duration = 86400,
    } = params;

    return beginCell()
        .storeAddress(beneficiaryAddress)
        .storeCoins(initialMinBid)
        .storeCoins(maxBid)
        .storeUint(minBidStep, 8)
        .storeUint(minExtendTime, 32)
        .storeUint(duration, 32)
        .endCell();
}

