/**
 * Backend API example for generating signed messages for number minting
 * 
 * This file shows how to implement a backend endpoint for generating
 * signed messages for minting NFT numbers from a pool
 */

import { Address, Cell, toNano } from '@ton/core';
import { sign } from '@ton/crypto';
import { createDirectMintAuctionConfig } from '../helpers/auctionConfig';
import { createNumberNftContent } from '../helpers/nftContent';
import { createNoRoyaltyParams } from '../helpers/royaltyParams';
import { createRestrictions } from '../helpers/restrictions';
import { createUnsignedDeployMessageV2, signDeployMessage, createSignedDeployMessageV2 } from '../helpers/signMessage';

// Contract configuration (should be stored securely)
const CONTRACT_CONFIG = {
    subwalletId: 0, // Collection subwallet ID
    privateKey: Buffer.from('YOUR_PRIVATE_KEY_HERE', 'hex'), // Private key for signing
    publicKey: Buffer.from('YOUR_PUBLIC_KEY_HERE', 'hex'), // Public key (corresponds to privateKey)
    collectionAddress: Address.parse('YOUR_COLLECTION_ADDRESS'), // Collection address
    beneficiaryAddress: Address.parse('YOUR_BENEFICIARY_ADDRESS'), // Beneficiary address
    mintPrice: toNano('0.1'), // Mint price in TON
    signatureValidityWindow: 3600, // Signature validity window in seconds (1 hour)
};

// Pool of available numbers (in real app this should be a DB)
const AVAILABLE_NUMBERS = new Set<string>();
const MINTED_NUMBERS = new Set<string>();

/**
 * Generates available number from pool
 */
function getAvailableNumber(): string | null {
    // In real app this should have logic to select number from DB
    // with check that number hasn't been minted
    for (const number of AVAILABLE_NUMBERS) {
        if (!MINTED_NUMBERS.has(number)) {
            return number;
        }
    }
    return null;
}

/**
 * Marks number as minted
 */
function markNumberAsMinted(number: string) {
    MINTED_NUMBERS.add(number);
}

/**
 * API endpoint: Generate signed message for minting
 * 
 * POST /api/mint/prepare
 * Body: { userAddress: string }
 * 
 * Response: {
 *   unsignedMessage: string, // hex encoded Cell
 *   signature: string, // hex encoded signature
 *   signedMessage: string, // hex encoded signed message
 *   tokenName: string, // number
 *   mintPrice: string, // price in nanoTON
 *   validTill: number, // timestamp until which signature is valid
 * }
 */
export async function prepareMintMessage(userAddress: string) {
    // 1. Check if there are available numbers
    const number = getAvailableNumber();
    if (!number) {
        throw new Error('No available numbers in pool');
    }

    // 2. Create NFT content
    const nftContent = createNumberNftContent(number);

    // 3. Create auction config for direct mint
    const auctionConfig = createDirectMintAuctionConfig({
        beneficiaryAddress: CONTRACT_CONFIG.beneficiaryAddress,
        mintPrice: CONTRACT_CONFIG.mintPrice,
    });

    // 4. Create royalty params (no royalty)
    const royaltyParams = createNoRoyaltyParams(CONTRACT_CONFIG.beneficiaryAddress);

    // 5. Optionally: create restrictions so only this user can mint
    const restrictions = createRestrictions({
        forceSenderAddress: Address.parse(userAddress),
    });

    // 6. Create unsigned deploy message
    const now = Math.floor(Date.now() / 1000);
    const unsignedMessage = createUnsignedDeployMessageV2({
        subwalletId: CONTRACT_CONFIG.subwalletId,
        validSince: now - 60, // Validity start (1 minute ago for buffer)
        validTill: now + CONTRACT_CONFIG.signatureValidityWindow,
        tokenName: number,
        content: nftContent,
        auctionConfig,
        royaltyParams,
        restrictions,
    });

    // 7. Sign message
    const signature = signDeployMessage(unsignedMessage, CONTRACT_CONFIG.privateKey);

    // 8. Create complete signed message
    const signedMessage = createSignedDeployMessageV2(unsignedMessage, signature);

    // 9. Mark number as reserved (in real app)
    // markNumberAsMinted(number); // Uncomment after successful mint

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
 * API endpoint: Confirm successful mint
 * 
 * POST /api/mint/confirm
 * Body: { tokenName: string, txHash: string }
 * 
 * Marks number as minted after successful transaction
 */
export async function confirmMint(tokenName: string, txHash: string) {
    // In real app this should check transaction in blockchain
    // and only mark number as minted after confirmation
    
    markNumberAsMinted(tokenName);
    
    return {
        success: true,
        tokenName,
        txHash,
    };
}

/**
 * Usage example with Express.js:
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

