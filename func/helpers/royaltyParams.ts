import { Address, beginCell, Cell } from '@ton/core';

export type RoyaltyParams = {
    numerator: number;
    denominator: number;
    destination: Address;
};

export function createRoyaltyParams(params: RoyaltyParams): Cell {
    const { numerator, denominator, destination } = params;

    if (numerator < 0 || numerator > 65535) {
        throw new Error('Numerator must be between 0 and 65535');
    }
    if (denominator < 0 || denominator > 65535) {
        throw new Error('Denominator must be between 0 and 65535');
    }

    return beginCell()
        .storeUint(numerator, 16)
        .storeUint(denominator, 16)
        .storeAddress(destination)
        .endCell();
}

export function createNoRoyaltyParams(destination: Address): Cell {
    return createRoyaltyParams({
        numerator: 0,
        denominator: 100,
        destination,
    });
}

