import { beginCell, Cell } from '@ton/core';
import { sign } from '@ton/crypto';

export type UnsignedDeployMessageV2 = {
    subwalletId: number;
    validSince: number;
    validTill: number;
    tokenName: string;
    content: Cell;
    auctionConfig: Cell;
    royaltyParams?: Cell;
    restrictions?: Cell;
};

export function createUnsignedDeployMessageV2(params: UnsignedDeployMessageV2): Cell {
    const {
        subwalletId,
        validSince,
        validTill,
        tokenName,
        content,
        auctionConfig,
        royaltyParams,
        restrictions,
    } = params;

    return beginCell()
        .storeUint(subwalletId, 32)
        .storeUint(validSince, 32)
        .storeUint(validTill, 32)
        .storeUint(tokenName.length, 8)
        .storeStringTail(tokenName)
        .storeRef(content)
        .storeRef(auctionConfig)
        .storeMaybeRef(royaltyParams)
        .storeMaybeRef(restrictions)
        .endCell();
}

export function signDeployMessage(
    unsignedMessage: Cell,
    privateKey: Buffer
): Buffer {
    const hash = unsignedMessage.hash();
    return sign(hash, privateKey);
}

export function createSignedDeployMessageV2(
    unsignedMessage: Cell,
    signature: Buffer
): Cell {
    return beginCell()
        .storeUint(0x4637289b, 32)
        .storeBuffer(signature)
        .storeRef(unsignedMessage)
        .endCell();
}

