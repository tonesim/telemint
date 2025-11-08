import { Address, beginCell, Cell } from '@ton/core';

export type RestrictionsParams = {
    forceSenderAddress?: Address; // Required sender address
    rewriteSenderAddress?: Address; // Address to replace sender with
};

/**
 * Creates restrictions for deploy message v2
 * Allows restricting who can mint NFT
 * 
 * Structure in contract:
 * int has_force_sender_address = cs~load_uint(1);
 * if (has_force_sender_address) { slice force_sender_address = cs~load_msg_addr(); }
 * int has_rewrite_sender_address = cs~load_uint(1);
 * if (has_rewrite_sender_address) { slice rewrite_sender_address = cs~load_msg_addr(); }
 */
export function createRestrictions(params: RestrictionsParams): Cell {
    const { forceSenderAddress, rewriteSenderAddress } = params;

    const cell = beginCell();
    
    // Flag for force_sender_address presence
    if (forceSenderAddress) {
        cell.storeUint(1, 1).storeAddress(forceSenderAddress);
    } else {
        cell.storeUint(0, 1);
    }
    
    // Flag for rewrite_sender_address presence
    if (rewriteSenderAddress) {
        cell.storeUint(1, 1).storeAddress(rewriteSenderAddress);
    } else {
        cell.storeUint(0, 1);
    }
    
    return cell.endCell();
}

/**
 * Creates restrictions that require sender to be a specific address
 */
export function createForceSenderRestrictions(senderAddress: Address): Cell {
    return createRestrictions({
        forceSenderAddress: senderAddress,
    });
}

