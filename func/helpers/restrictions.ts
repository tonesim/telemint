import { Address, beginCell, Cell } from '@ton/core';

export type RestrictionsParams = {
    forceSenderAddress?: Address;
    rewriteSenderAddress?: Address;
};

export function createRestrictions(params: RestrictionsParams): Cell {
    const { forceSenderAddress, rewriteSenderAddress } = params;
    const cell = beginCell();
    
    if (forceSenderAddress) {
        cell.storeUint(1, 1).storeAddress(forceSenderAddress);
    } else {
        cell.storeUint(0, 1);
    }
    
    if (rewriteSenderAddress) {
        cell.storeUint(1, 1).storeAddress(rewriteSenderAddress);
    } else {
        cell.storeUint(0, 1);
    }
    
    return cell.endCell();
}

export function createForceSenderRestrictions(senderAddress: Address): Cell {
    return createRestrictions({
        forceSenderAddress: senderAddress,
    });
}

