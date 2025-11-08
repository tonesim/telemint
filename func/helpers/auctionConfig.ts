import { Address, beginCell, Cell, toNano } from '@ton/core';

export type AuctionConfigParams = {
    beneficiaryAddress: Address;
    initialMinBid: bigint; // Минимальная ставка (цена минта)
    maxBid?: bigint; // Максимальная ставка (если = initialMinBid, аукцион сразу завершится)
    minBidStep?: number; // Минимальный шаг ставки в процентах (1-255)
    minExtendTime?: number; // Минимальное время продления аукциона в секундах
    duration?: number; // Длительность аукциона в секундах
};

/**
 * Создает auction config для прямого минта (без аукциона)
 * Аукцион сразу завершится после первой ставки
 */
export function createDirectMintAuctionConfig(params: {
    beneficiaryAddress: Address;
    mintPrice: bigint; // Цена минта
}): Cell {
    return createAuctionConfig({
        beneficiaryAddress: params.beneficiaryAddress,
        initialMinBid: params.mintPrice,
        maxBid: params.mintPrice, // Аукцион сразу завершится
        minBidStep: 1,
        minExtendTime: 0,
        duration: 0, // Аукцион сразу завершится
    });
}

/**
 * Создает auction config для обычного аукциона
 */
export function createAuctionConfig(params: AuctionConfigParams): Cell {
    const {
        beneficiaryAddress,
        initialMinBid,
        maxBid = 0n, // 0 = без лимита
        minBidStep = 5, // 5% по умолчанию
        minExtendTime = 300, // 5 минут по умолчанию
        duration = 86400, // 1 день по умолчанию
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

