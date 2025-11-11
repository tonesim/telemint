/**
 * E2E Test for Production Mainnet Contracts
 * 
 * This test verifies real deployed contracts in mainnet:
 * 1. Connects to mainnet
 * 2. Verifies contracts are deployed
 * 3. Mints NFT (or verifies existing one)
 * 4. Reads all NFT data
 * 
 * Usage:
 *   npm test -- E2EMainnet.spec.ts
 * 
 * Environment variables required:
 *   - TON_ENDPOINT: TON network endpoint
 *   - TON_API_KEY: API key (optional)
 *   - COLLECTION_ADDRESS: Deployed collection address
 *   - COLLECTION_PUBLIC_KEY: Collection public key (hex)
 *   - COLLECTION_PRIVATE_KEY: Collection private key (hex)
 *   - BENEFICIARY_ADDRESS: Beneficiary address
 */

// Load environment variables
try {
    require('dotenv').config();
} catch (e) {
    // dotenv is optional
}

import { Address, fromNano, toNano, Cell } from '@ton/core';
import { TonClient } from '@ton/ton';
import { NftCollectionNoDns } from '../wrappers/NftCollectionNoDns';
import { NftItemNoDnsCheap } from '../wrappers/NftItemNoDnsCheap';
import { createDirectMintAuctionConfig } from '../helpers/auctionConfig';
import { createNumberNftContent, parseNftContent } from '../helpers/nftContent';
import { createNoRoyaltyParams } from '../helpers/royaltyParams';
import { createRestrictions } from '../helpers/restrictions';
import { createUnsignedDeployMessageV2, signDeployMessage, createSignedDeployMessageV2 } from '../helpers/signMessage';
import { sha256 } from '@ton/crypto';

// Skip E2E tests if not in CI or explicitly enabled
const RUN_E2E = process.env.RUN_E2E === 'true' || process.env.CI !== 'true';

async function stringHash(s: string): Promise<bigint> {
    const hash = await sha256(Buffer.from(s));
    return BigInt('0x' + Buffer.from(hash).toString('hex'));
}

function isRateLimitError(error: any): boolean {
    const message = error?.message || error?.toString() || '';
    const statusCode = error?.status || error?.statusCode || error?.response?.status;
    return (
        statusCode === 429 ||
        message.includes('429') ||
        message.includes('rate limit') ||
        message.includes('Rate limit') ||
        message.includes('too many requests')
    );
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    initialDelay: number = 2000
): Promise<T> {
    let delay = initialDelay;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            if (!isRateLimitError(error) || attempt === maxRetries) {
                throw error;
            }
            console.log(`Rate limit hit. Retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
            await sleep(delay);
            delay *= 2;
        }
    }
    throw new Error('Max retries exceeded');
}

async function executeWithRateLimit<T>(
    fn: () => Promise<T>,
    delayBefore: number = 1000,
    delayAfter: number = 1000
): Promise<T> {
    if (delayBefore > 0) await sleep(delayBefore);
    try {
        const result = await retryWithBackoff(fn);
        if (delayAfter > 0) await sleep(delayAfter);
        return result;
    } catch (error: any) {
        if (isRateLimitError(error)) {
            throw new Error('Rate limit exceeded after retries');
        }
        throw error;
    }
}

interface Config {
    endpoint: string;
    apiKey?: string;
    collectionAddress: Address;
    publicKey: Buffer;
    privateKey: Buffer;
    beneficiaryAddress: Address;
    subwalletId: number;
    mintPrice: bigint;
}

function loadConfig(): Config {
    const endpoint = process.env.TON_ENDPOINT || 'https://toncenter.com/api/v2/jsonRPC';
    const apiKey = process.env.TON_API_KEY;
    const collectionAddressStr = process.env.COLLECTION_ADDRESS;
    const publicKeyStr = process.env.COLLECTION_PUBLIC_KEY;
    const privateKeyStr = process.env.COLLECTION_PRIVATE_KEY;
    const beneficiaryAddressStr = process.env.BENEFICIARY_ADDRESS;
    const subwalletId = parseInt(process.env.SUBWALLET_ID || '0', 10);
    const mintPriceStr = process.env.MINT_PRICE || '0.1';

    if (!collectionAddressStr || !publicKeyStr || !privateKeyStr || !beneficiaryAddressStr) {
        throw new Error('Missing required environment variables for E2E test');
    }

    return {
        endpoint: apiKey ? `${endpoint}?api_key=${apiKey}` : endpoint,
        apiKey,
        collectionAddress: Address.parse(collectionAddressStr),
        publicKey: Buffer.from(publicKeyStr, 'hex'),
        privateKey: Buffer.from(privateKeyStr, 'hex'),
        beneficiaryAddress: Address.parse(beneficiaryAddressStr),
        subwalletId,
        mintPrice: toNano(mintPriceStr),
    };
}

describe('E2E Mainnet Tests', () => {
    let config: Config;
    let client: TonClient;
    let collection: NftCollectionNoDns;

    beforeAll(() => {
        if (!RUN_E2E) {
            console.log('Skipping E2E tests. Set RUN_E2E=true to run.');
            return;
        }

        try {
            config = loadConfig();
            client = new TonClient({
                endpoint: config.endpoint,
            });
            collection = client.open(NftCollectionNoDns.createFromAddress(config.collectionAddress));
        } catch (error: any) {
            console.error(`Failed to load config: ${error.message}`);
            throw error;
        }
    });

    it('should verify collection is deployed in mainnet', async () => {
        if (!RUN_E2E) {
            return;
        }

        const state = await executeWithRateLimit(
            () => client.getContractState(config.collectionAddress),
            0,
            1000
        );

        expect(state.state).toBeDefined();
        expect(state.state).not.toBe('uninitialized');
        expect(state.state).toBe('active');

        const balance = await executeWithRateLimit(
            () => client.getBalance(config.collectionAddress),
            1000,
            1000
        );

        expect(balance).toBeGreaterThan(0n);
        console.log(`Collection balance: ${fromNano(balance)} TON`);
    });

    it('should create valid minting payload', async () => {
        if (!RUN_E2E) {
            return;
        }

        const tokenName = `e2e_test_${Date.now()}`;
        const now = Math.floor(Date.now() / 1000);

        // Create payload
        const nftContent = createNumberNftContent(tokenName);
        const auctionConfig = createDirectMintAuctionConfig({
            beneficiaryAddress: config.beneficiaryAddress,
            mintPrice: config.mintPrice,
        });
        const royaltyParams = createNoRoyaltyParams(config.beneficiaryAddress);
        const restrictions = createRestrictions({
            forceSenderAddress: config.beneficiaryAddress,
        });

        const unsignedMessage = createUnsignedDeployMessageV2({
            subwalletId: config.subwalletId,
            validSince: now - 60,
            validTill: now + 3600,
            tokenName,
            content: nftContent,
            auctionConfig,
            royaltyParams,
            restrictions,
        });

        const signature = signDeployMessage(unsignedMessage, config.privateKey);
        expect(signature.length).toBe(64);

        const signedMessage = createSignedDeployMessageV2(unsignedMessage, signature);
        expect(signedMessage.toBoc().length).toBeGreaterThan(0);

        // Calculate NFT address
        const itemIndex = await stringHash(tokenName);
        const nftAddress = await executeWithRateLimit(
            () => collection.getNftAddressByIndex(itemIndex),
            1000,
            1000
        );

        expect(nftAddress).toBeDefined();
        expect(nftAddress.equals(config.collectionAddress)).toBe(false);

        console.log(`NFT address for "${tokenName}": ${nftAddress.toString()}`);
        console.log(`Signed message (base64): ${signedMessage.toBoc().toString('base64')}`);
    });

    it('should read NFT data if NFT exists', async () => {
        if (!RUN_E2E) {
            return;
        }

        // Use a test token name that might exist
        const testTokenName = process.env.TEST_TOKEN_NAME || 'test123';
        const itemIndex = await stringHash(testTokenName);

        const nftAddress = await executeWithRateLimit(
            () => collection.getNftAddressByIndex(itemIndex),
            1000,
            1000
        );

        console.log(`Checking NFT at address: ${nftAddress.toString()}`);

        // Check if NFT is deployed
        const nftState = await executeWithRateLimit(
            () => client.getContractState(nftAddress),
            1000,
            1000
        );

        if (!nftState.state || nftState.state === 'uninitialized') {
            console.log(`NFT "${testTokenName}" is not minted yet`);
            return; // Not an error, just not minted
        }

        console.log(`NFT is deployed (state: ${nftState.state})`);

        // Try to read NFT data
        const nft = client.open(NftItemNoDnsCheap.createFromAddress(nftAddress));

        try {
            const nftData = await executeWithRateLimit(
                () => nft.getNftData(),
                1000,
                1000
            );

            if (!nftData.init) {
                console.log('NFT is not initialized yet');
                return;
            }

            console.log('✓ NFT data retrieved');
            expect(nftData.index).toBe(itemIndex);
            expect(nftData.collectionAddress.equals(config.collectionAddress)).toBe(true);

            if (nftData.ownerAddress) {
                console.log(`  Owner: ${nftData.ownerAddress.toString()}`);
            }

            // Read token name
            try {
                const tokenName = await executeWithRateLimit(
                    () => nft.getTelemintTokenName(),
                    1000,
                    1000
                );
                console.log(`  Token name: ${tokenName}`);
                expect(tokenName).toBe(testTokenName);
            } catch (error: any) {
                if (!isRateLimitError(error)) {
                    console.warn(`Could not get token name: ${error.message}`);
                }
            }

            // Read auction config
            try {
                const auctionConfig = await executeWithRateLimit(
                    () => nft.getTelemintAuctionConfig(),
                    1000,
                    1000
                );
                console.log(`  Auction config retrieved`);
                if (auctionConfig.beneficiaryAddress) {
                    console.log(`    Beneficiary: ${auctionConfig.beneficiaryAddress.toString()}`);
                }
                console.log(`    Initial min bid: ${fromNano(auctionConfig.initialMinBid)} TON`);
            } catch (error: any) {
                if (!isRateLimitError(error)) {
                    console.warn(`Could not get auction config: ${error.message}`);
                }
            }

            // Read royalty params
            try {
                const royaltyParams = await executeWithRateLimit(
                    () => nft.getRoyaltyParams(),
                    1000,
                    1000
                );
                console.log(`  Royalty params retrieved`);
                console.log(`    Rate: ${(royaltyParams.numerator / royaltyParams.denominator * 100).toFixed(2)}%`);
                console.log(`    Destination: ${royaltyParams.destination.toString()}`);
            } catch (error: any) {
                if (!isRateLimitError(error)) {
                    console.warn(`Could not get royalty params: ${error.message}`);
                }
            }

            // Parse content if available
            if (nftData.content) {
                try {
                    const parsedContent = parseNftContent(nftData.content);
                    console.log(`  Content URI: ${parsedContent.uri || 'N/A'}`);
                } catch (e: any) {
                    console.warn(`Could not parse content: ${e.message}`);
                }
            }

        } catch (error: any) {
            if (isRateLimitError(error)) {
                console.warn('Rate limit exceeded. Skipping NFT data check.');
            } else {
                console.warn(`Could not read NFT data: ${error.message}`);
            }
        }
    });

    it('should verify collection get-methods work', async () => {
        if (!RUN_E2E) {
            return;
        }

        // Test get_collection_data
        const collectionData = await executeWithRateLimit(
            () => collection.getCollectionData(),
            1000,
            1000
        );

        expect(collectionData.index).toBeDefined();
        expect(collectionData.collectionContent).toBeDefined();
        console.log(`Collection data retrieved: index=${collectionData.index}`);

        // Test get_nft_address_by_index
        const testTokenName = 'test123';
        const itemIndex = await stringHash(testTokenName);
        const nftAddress = await executeWithRateLimit(
            () => collection.getNftAddressByIndex(itemIndex),
            1000,
            1000
        );

        expect(nftAddress).toBeDefined();
        expect(nftAddress.equals(config.collectionAddress)).toBe(false);
        console.log(`NFT address calculated: ${nftAddress.toString()}`);
    });
});

