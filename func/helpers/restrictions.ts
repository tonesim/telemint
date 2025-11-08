import { Address, beginCell, Cell } from '@ton/core';

export type RestrictionsParams = {
    forceSenderAddress?: Address; // Обязательный адрес отправителя
    rewriteSenderAddress?: Address; // Адрес, на который заменить отправителя
};

/**
 * Создает restrictions для deploy message v2
 * Позволяет ограничить, кто может минтить NFT
 * 
 * Структура в контракте:
 * int has_force_sender_address = cs~load_uint(1);
 * if (has_force_sender_address) { slice force_sender_address = cs~load_msg_addr(); }
 * int has_rewrite_sender_address = cs~load_uint(1);
 * if (has_rewrite_sender_address) { slice rewrite_sender_address = cs~load_msg_addr(); }
 */
export function createRestrictions(params: RestrictionsParams): Cell {
    const { forceSenderAddress, rewriteSenderAddress } = params;

    const cell = beginCell();
    
    // Флаг наличия force_sender_address
    if (forceSenderAddress) {
        cell.storeUint(1, 1).storeAddress(forceSenderAddress);
    } else {
        cell.storeUint(0, 1);
    }
    
    // Флаг наличия rewrite_sender_address
    if (rewriteSenderAddress) {
        cell.storeUint(1, 1).storeAddress(rewriteSenderAddress);
    } else {
        cell.storeUint(0, 1);
    }
    
    return cell.endCell();
}

/**
 * Создает restrictions, которые требуют, чтобы отправитель был определенным адресом
 */
export function createForceSenderRestrictions(senderAddress: Address): Cell {
    return createRestrictions({
        forceSenderAddress: senderAddress,
    });
}

