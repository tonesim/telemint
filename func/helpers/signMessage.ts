import { beginCell, Cell } from '@ton/core';
import { sign } from '@ton/crypto';

export type UnsignedDeployMessageV2 = {
    subwalletId: number;
    validSince: number; // Unix timestamp
    validTill: number; // Unix timestamp
    tokenName: string; // Number from pool
    content: Cell; // NFT content
    auctionConfig: Cell;
    royaltyParams?: Cell;
    restrictions?: Cell;
};

/**
 * Creates unsigned deploy message v2 (for NftCollectionNoDns)
 */
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

/**
 * Signs unsigned deploy message
 */
export function signDeployMessage(
    unsignedMessage: Cell,
    privateKey: Buffer
): Buffer {
    const hash = unsignedMessage.hash();
    return sign(hash, privateKey);
}

/**
 * Creates complete signed message for sending to contract
 */
export function createSignedDeployMessageV2(
    unsignedMessage: Cell,
    signature: Buffer
): Cell {
    return beginCell()
        .storeUint(0x4637289b, 32) // op::telemint_msg_deploy_v2
        .storeBuffer(signature)
        .storeRef(unsignedMessage)
        .endCell();
}

