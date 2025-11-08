import { Address, beginCell, Cell, toNano } from '@ton/core';

export type AuctionConfigParams = {
    beneficiaryAddress: Address;
    initialMinBid: bigint; // Minimum bid (mint price)
    maxBid?: bigint; // Maximum bid (if = initialMinBid, auction completes immediately)
    minBidStep?: number; // Minimum bid step in percent (1-255)
    minExtendTime?: number; // Minimum auction extension time in seconds
    duration?: number; // Auction duration in seconds
};

/**
 * Creates auction config for direct mint (without auction)
 * Auction completes immediately after first bid
 */
export function createDirectMintAuctionConfig(params: {
    beneficiaryAddress: Address;
    mintPrice: bigint; // Mint price
}): Cell {
    return createAuctionConfig({
        beneficiaryAddress: params.beneficiaryAddress,
        initialMinBid: params.mintPrice,
        maxBid: params.mintPrice, // Auction completes immediately
        minBidStep: 1,
        minExtendTime: 0,
        duration: 0, // Auction completes immediately
    });
}

/**
 * Creates auction config for regular auction
 */
export function createAuctionConfig(params: AuctionConfigParams): Cell {
    const {
        beneficiaryAddress,
        initialMinBid,
        maxBid = 0n, // 0 = no limit
        minBidStep = 5, // 5% by default
        minExtendTime = 300, // 5 minutes by default
        duration = 86400, // 1 day by default
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

