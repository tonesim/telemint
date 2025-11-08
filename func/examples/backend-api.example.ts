/**
 * Пример бэкенд API для генерации подписанных сообщений для минта номеров
 * 
 * Этот файл показывает, как реализовать бэкенд эндпоинт для генерации
 * подписанных сообщений для минта NFT номеров из пула
 */

import { Address, Cell, toNano } from '@ton/core';
import { sign } from '@ton/crypto';
import { createDirectMintAuctionConfig } from '../helpers/auctionConfig';
import { createNumberNftContent } from '../helpers/nftContent';
import { createNoRoyaltyParams } from '../helpers/royaltyParams';
import { createRestrictions } from '../helpers/restrictions';
import { createUnsignedDeployMessageV2, signDeployMessage, createSignedDeployMessageV2 } from '../helpers/signMessage';

// Конфигурация контракта (должна храниться в безопасном месте)
const CONTRACT_CONFIG = {
    subwalletId: 0, // Subwallet ID коллекции
    privateKey: Buffer.from('YOUR_PRIVATE_KEY_HERE', 'hex'), // Приватный ключ для подписи
    publicKey: Buffer.from('YOUR_PUBLIC_KEY_HERE', 'hex'), // Публичный ключ (соответствует privateKey)
    collectionAddress: Address.parse('YOUR_COLLECTION_ADDRESS'), // Адрес коллекции
    beneficiaryAddress: Address.parse('YOUR_BENEFICIARY_ADDRESS'), // Адрес получателя средств
    mintPrice: toNano('0.1'), // Цена минта в TON
    signatureValidityWindow: 3600, // Окно валидности подписи в секундах (1 час)
};

// Пул доступных номеров (в реальном приложении это должна быть БД)
const AVAILABLE_NUMBERS = new Set<string>();
const MINTED_NUMBERS = new Set<string>();

/**
 * Генерирует доступный номер из пула
 */
function getAvailableNumber(): string | null {
    // В реальном приложении здесь должна быть логика выбора номера из БД
    // с проверкой, что номер не был заминтирован
    for (const number of AVAILABLE_NUMBERS) {
        if (!MINTED_NUMBERS.has(number)) {
            return number;
        }
    }
    return null;
}

/**
 * Помечает номер как заминтированный
 */
function markNumberAsMinted(number: string) {
    MINTED_NUMBERS.add(number);
}

/**
 * API эндпоинт: Генерация подписанного сообщения для минта
 * 
 * POST /api/mint/prepare
 * Body: { userAddress: string }
 * 
 * Response: {
 *   unsignedMessage: string, // hex encoded Cell
 *   signature: string, // hex encoded signature
 *   signedMessage: string, // hex encoded signed message
 *   tokenName: string, // номер
 *   mintPrice: string, // цена в nanoTON
 *   validTill: number, // timestamp до которого валидна подпись
 * }
 */
export async function prepareMintMessage(userAddress: string) {
    // 1. Проверяем, есть ли доступные номера
    const number = getAvailableNumber();
    if (!number) {
        throw new Error('No available numbers in pool');
    }

    // 2. Создаем NFT контент
    const nftContent = createNumberNftContent(number);

    // 3. Создаем auction config для прямого минта
    const auctionConfig = createDirectMintAuctionConfig({
        beneficiaryAddress: CONTRACT_CONFIG.beneficiaryAddress,
        mintPrice: CONTRACT_CONFIG.mintPrice,
    });

    // 4. Создаем royalty params (без роялти)
    const royaltyParams = createNoRoyaltyParams(CONTRACT_CONFIG.beneficiaryAddress);

    // 5. Опционально: создаем restrictions, чтобы только этот пользователь мог минтить
    const restrictions = createRestrictions({
        forceSenderAddress: Address.parse(userAddress),
    });

    // 6. Создаем unsigned deploy message
    const now = Math.floor(Date.now() / 1000);
    const unsignedMessage = createUnsignedDeployMessageV2({
        subwalletId: CONTRACT_CONFIG.subwalletId,
        validSince: now - 60, // Начало валидности (1 минута назад для запаса)
        validTill: now + CONTRACT_CONFIG.signatureValidityWindow,
        tokenName: number,
        content: nftContent,
        auctionConfig,
        royaltyParams,
        restrictions,
    });

    // 7. Подписываем сообщение
    const signature = signDeployMessage(unsignedMessage, CONTRACT_CONFIG.privateKey);

    // 8. Создаем полное подписанное сообщение
    const signedMessage = createSignedDeployMessageV2(unsignedMessage, signature);

    // 9. Помечаем номер как зарезервированный (в реальном приложении)
    // markNumberAsMinted(number); // Раскомментируйте после успешного минта

    return {
        unsignedMessage: unsignedMessage.toBoc().toString('base64'),
        signature: signature.toString('hex'),
        signedMessage: signedMessage.toBoc().toString('base64'),
        tokenName: number,
        mintPrice: CONTRACT_CONFIG.mintPrice.toString(),
        validTill: now + CONTRACT_CONFIG.signatureValidityWindow,
    };
}

/**
 * API эндпоинт: Подтверждение успешного минта
 * 
 * POST /api/mint/confirm
 * Body: { tokenName: string, txHash: string }
 * 
 * Помечает номер как заминтированный после успешной транзакции
 */
export async function confirmMint(tokenName: string, txHash: string) {
    // В реальном приложении здесь должна быть проверка транзакции в блокчейне
    // и только после подтверждения помечать номер как заминтированный
    
    markNumberAsMinted(tokenName);
    
    return {
        success: true,
        tokenName,
        txHash,
    };
}

/**
 * Пример использования с Express.js:
 * 
 * import express from 'express';
 * const app = express();
 * 
 * app.post('/api/mint/prepare', async (req, res) => {
 *   try {
 *     const { userAddress } = req.body;
 *     const result = await prepareMintMessage(userAddress);
 *     res.json(result);
 *   } catch (error) {
 *     res.status(400).json({ error: error.message });
 *   }
 * });
 * 
 * app.post('/api/mint/confirm', async (req, res) => {
 *   try {
 *     const { tokenName, txHash } = req.body;
 *     const result = await confirmMint(tokenName, txHash);
 *     res.json(result);
 *   } catch (error) {
 *     res.status(400).json({ error: error.message });
 *   }
 * });
 */

