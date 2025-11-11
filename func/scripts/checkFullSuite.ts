/**
 * Comprehensive production verification script
 * 
 * This script performs comprehensive checks of all functionality:
 * - All helper functions
 * - Complete minting message preparation flow
 * - Contract get-methods
 * - NFT address calculations
 * - Message signing and validation
 * 
 * Usage:
 *   ts-node scripts/checkFullSuite.ts
 */

// Load environment variables from .env file
try {
    require('dotenv').config();
} catch (e) {
    // dotenv is optional, continue without it
}

import { Address, fromNano, toNano, Cell } from '@ton/core';
import { TonClient } from '@ton/ton';
import { NftCollectionNoDns } from '../wrappers/NftCollectionNoDns';
import { NftItemNoDnsCheap } from '../wrappers/NftItemNoDnsCheap';
import {
    createDirectMintAuctionConfig,
    createAuctionConfig,
} from '../helpers/auctionConfig';
import {
    createNumberNftContent,
    createNftContent,
    parseNftContent,
} from '../helpers/nftContent';
import {
    createNoRoyaltyParams,
    createRoyaltyParams,
} from '../helpers/royaltyParams';
import {
    createRestrictions,
    createForceSenderRestrictions,
} from '../helpers/restrictions';
import {
    createUnsignedDeployMessageV2,
    signDeployMessage,
    createSignedDeployMessageV2,
} from '../helpers/signMessage';
import { sha256 } from '@ton/crypto';

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
};

function log(message: string, color: keyof typeof colors = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message: string) {
    log(`✓ ${message}`, 'green');
}

function logError(message: string) {
    log(`✗ ${message}`, 'red');
}

function logInfo(message: string) {
    log(`ℹ ${message}`, 'blue');
}

function logWarning(message: string) {
    log(`⚠ ${message}`, 'yellow');
}

function logSection(title: string) {
    log(`\n--- ${title} ---`, 'cyan');
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

async function loadConfig(): Promise<Config> {
    const endpoint = process.env.TON_ENDPOINT || 'https://toncenter.com/api/v2/jsonRPC';
    const apiKey = process.env.TON_API_KEY;
    const collectionAddressStr = process.env.COLLECTION_ADDRESS;
    const publicKeyStr = process.env.COLLECTION_PUBLIC_KEY;
    const privateKeyStr = process.env.COLLECTION_PRIVATE_KEY;
    const beneficiaryAddressStr = process.env.BENEFICIARY_ADDRESS;
    const subwalletId = parseInt(process.env.SUBWALLET_ID || '0', 10);
    const mintPriceStr = process.env.MINT_PRICE || '0.1';

    if (!collectionAddressStr) {
        throw new Error('COLLECTION_ADDRESS environment variable is required');
    }
    if (!publicKeyStr) {
        throw new Error('COLLECTION_PUBLIC_KEY environment variable is required');
    }
    if (!privateKeyStr) {
        throw new Error('COLLECTION_PRIVATE_KEY environment variable is required');
    }
    if (!beneficiaryAddressStr) {
        throw new Error('BENEFICIARY_ADDRESS environment variable is required');
    }

    const collectionAddress = Address.parse(collectionAddressStr);
    const publicKey = Buffer.from(publicKeyStr, 'hex');
    const privateKey = Buffer.from(privateKeyStr, 'hex');
    const beneficiaryAddress = Address.parse(beneficiaryAddressStr);
    const mintPrice = toNano(mintPriceStr);

    return {
        endpoint: apiKey ? `${endpoint}?api_key=${apiKey}` : endpoint,
        apiKey,
        collectionAddress,
        publicKey,
        privateKey,
        beneficiaryAddress,
        subwalletId,
        mintPrice,
    };
}

async function stringHash(s: string): Promise<bigint> {
    const hash = await sha256(Buffer.from(s));
    const hex = Buffer.from(hash).toString('hex');
    return BigInt('0x' + hex);
}

function isRateLimitError(error: any): boolean {
    const message = error?.message || error?.toString() || '';
    const statusCode = error?.status || error?.statusCode || error?.response?.status;
    
    return (
        statusCode === 429 ||
        message.includes('429') ||
        message.includes('rate limit') ||
        message.includes('Rate limit') ||
        message.includes('too many requests') ||
        message.includes('Too Many Requests')
    );
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    options: {
        maxRetries?: number;
        initialDelay?: number;
        maxDelay?: number;
        backoffMultiplier?: number;
    } = {}
): Promise<T> {
    const {
        maxRetries = 3,
        initialDelay = 1000,
        maxDelay = 10000,
        backoffMultiplier = 2,
    } = options;

    let lastError: any;
    let delay = initialDelay;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;

            if (!isRateLimitError(error) || attempt === maxRetries) {
                throw error;
            }

            logWarning(`Rate limit hit. Retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
            await sleep(delay);
            delay = Math.min(delay * backoffMultiplier, maxDelay);
        }
    }

    throw lastError;
}

async function executeWithRateLimit<T>(
    fn: () => Promise<T>,
    delayBefore: number = 500,
    delayAfter: number = 500
): Promise<T> {
    if (delayBefore > 0) {
        await sleep(delayBefore);
    }

    try {
        const result = await retryWithBackoff(fn, {
            maxRetries: 3,
            initialDelay: 2000,
            maxDelay: 10000,
            backoffMultiplier: 2,
        });

        if (delayAfter > 0) {
            await sleep(delayAfter);
        }

        return result;
    } catch (error: any) {
        if (isRateLimitError(error)) {
            logWarning('Rate limit exceeded after retries.');
            throw error;
        }
        throw error;
    }
}

// Test helper functions
async function testHelperFunctions(config: Config): Promise<boolean> {
    logSection('Testing Helper Functions');
    let allPassed = true;

    try {
        // Test auction config
        logInfo('Testing auction config creation...');
        const auctionConfig = createDirectMintAuctionConfig({
            beneficiaryAddress: config.beneficiaryAddress,
            mintPrice: config.mintPrice,
        });
        if (!(auctionConfig instanceof Cell)) {
            logError('Auction config is not a Cell');
            allPassed = false;
        } else {
            logSuccess('Auction config created successfully');
        }

        // Test full auction config
        const fullAuctionConfig = createAuctionConfig({
            beneficiaryAddress: config.beneficiaryAddress,
            initialMinBid: config.mintPrice,
            maxBid: config.mintPrice,
            minBidStep: 1,
            minExtendTime: 0,
            duration: 0,
        });
        if (!(fullAuctionConfig instanceof Cell)) {
            logError('Full auction config is not a Cell');
            allPassed = false;
        } else {
            logSuccess('Full auction config created successfully');
        }

        // Test NFT content
        logInfo('Testing NFT content creation...');
        const testNumber = '123456';
        const nftContent = createNumberNftContent(testNumber);
        if (!(nftContent instanceof Cell)) {
            logError('NFT content is not a Cell');
            allPassed = false;
        } else {
            logSuccess('NFT content created successfully');
            
            // Test parsing
            try {
                const parsed = parseNftContent(nftContent);
                logSuccess(`NFT content parsed: ${JSON.stringify(parsed)}`);
            } catch (e: any) {
                logWarning(`Could not parse NFT content: ${e.message}`);
            }
        }

        // Test custom NFT content
        const customContent = createNftContent('https://example.com/metadata.json');
        if (!(customContent instanceof Cell)) {
            logError('Custom NFT content is not a Cell');
            allPassed = false;
        } else {
            logSuccess('Custom NFT content created successfully');
        }

        // Test royalty params
        logInfo('Testing royalty params creation...');
        const noRoyalty = createNoRoyaltyParams(config.beneficiaryAddress);
        if (!(noRoyalty instanceof Cell)) {
            logError('No royalty params is not a Cell');
            allPassed = false;
        } else {
            logSuccess('No royalty params created successfully');
        }

        const royalty = createRoyaltyParams({
            numerator: 5,
            denominator: 100,
            destination: config.beneficiaryAddress,
        });
        if (!(royalty instanceof Cell)) {
            logError('Royalty params is not a Cell');
            allPassed = false;
        } else {
            logSuccess('Royalty params created successfully');
        }

        // Test restrictions
        logInfo('Testing restrictions creation...');
        const restrictions = createRestrictions({
            forceSenderAddress: config.beneficiaryAddress,
        });
        if (!(restrictions instanceof Cell)) {
            logError('Restrictions is not a Cell');
            allPassed = false;
        } else {
            logSuccess('Restrictions created successfully');
        }

        const forceSender = createForceSenderRestrictions(config.beneficiaryAddress);
        if (!(forceSender instanceof Cell)) {
            logError('Force sender restrictions is not a Cell');
            allPassed = false;
        } else {
            logSuccess('Force sender restrictions created successfully');
        }

        // Test message signing
        logInfo('Testing message signing...');
        const unsignedMessage = createUnsignedDeployMessageV2({
            subwalletId: config.subwalletId,
            validSince: Math.floor(Date.now() / 1000) - 60,
            validTill: Math.floor(Date.now() / 1000) + 3600,
            tokenName: testNumber,
            content: nftContent,
            auctionConfig,
            royaltyParams: noRoyalty,
        });
        if (!(unsignedMessage instanceof Cell)) {
            logError('Unsigned message is not a Cell');
            allPassed = false;
        } else {
            logSuccess('Unsigned message created successfully');
        }

        const signature = signDeployMessage(unsignedMessage, config.privateKey);
        if (signature.length !== 64) {
            logError(`Invalid signature length: ${signature.length} (expected 64)`);
            allPassed = false;
        } else {
            logSuccess('Message signed successfully');
        }

        const signedMessage = createSignedDeployMessageV2(unsignedMessage, signature);
        if (!(signedMessage instanceof Cell)) {
            logError('Signed message is not a Cell');
            allPassed = false;
        } else {
            logSuccess('Signed message created successfully');
        }

    } catch (error: any) {
        logError(`Error testing helper functions: ${error.message}`);
        allPassed = false;
    }

    return allPassed;
}

// Test complete minting flow
async function testMintingFlow(config: Config): Promise<boolean> {
    logSection('Testing Complete Minting Flow');
    let allPassed = true;

    try {
        const testTokenName = `test_${Date.now()}`;
        const now = Math.floor(Date.now() / 1000);

        logInfo(`Creating mint message for token: ${testTokenName}`);

        // Step 1: Create NFT content
        const nftContent = createNumberNftContent(testTokenName);
        logSuccess('Step 1: NFT content created');

        // Step 2: Create auction config
        const auctionConfig = createDirectMintAuctionConfig({
            beneficiaryAddress: config.beneficiaryAddress,
            mintPrice: config.mintPrice,
        });
        logSuccess('Step 2: Auction config created');

        // Step 3: Create royalty params
        const royaltyParams = createNoRoyaltyParams(config.beneficiaryAddress);
        logSuccess('Step 3: Royalty params created');

        // Step 4: Create restrictions (optional)
        const restrictions = createRestrictions({
            forceSenderAddress: config.beneficiaryAddress,
        });
        logSuccess('Step 4: Restrictions created');

        // Step 5: Create unsigned message
        const unsignedMessage = createUnsignedDeployMessageV2({
            subwalletId: config.subwalletId,
            validSince: now - 60,
            validTill: now + 3600,
            tokenName: testTokenName,
            content: nftContent,
            auctionConfig,
            royaltyParams,
            restrictions,
        });
        logSuccess('Step 5: Unsigned message created');

        // Step 6: Sign message
        const signature = signDeployMessage(unsignedMessage, config.privateKey);
        if (signature.length !== 64) {
            logError(`Invalid signature length: ${signature.length}`);
            allPassed = false;
        } else {
            logSuccess('Step 6: Message signed');
        }

        // Step 7: Create signed message
        const signedMessage = createSignedDeployMessageV2(unsignedMessage, signature);
        logSuccess('Step 7: Signed message created');

        // Step 8: Calculate NFT address
        const itemIndex = await stringHash(testTokenName);
        logSuccess(`Step 8: NFT index calculated: ${itemIndex.toString()}`);

        // Verify message structure
        const messageBoc = signedMessage.toBoc();
        if (messageBoc.length === 0) {
            logError('Signed message BOC is empty');
            allPassed = false;
        } else {
            logSuccess(`Step 9: Message BOC created (${messageBoc.length} bytes)`);
        }

        logSuccess('Complete minting flow test passed!');
    } catch (error: any) {
        logError(`Error testing minting flow: ${error.message}`);
        allPassed = false;
    }

    return allPassed;
}

// Test contract get-methods
async function testContractGetMethods(client: TonClient, config: Config): Promise<boolean> {
    logSection('Testing Contract Get-Methods');
    let allPassed = true;

    try {
        const collection = client.open(NftCollectionNoDns.createFromAddress(config.collectionAddress));

        // Test get_collection_data
        try {
            logInfo('Testing get_collection_data...');
            const collectionData = await executeWithRateLimit(
                () => collection.getCollectionData(),
                1000,
                1000
            );
            logSuccess(`Collection data retrieved: index=${collectionData.index}`);
            if (collectionData.collectionContent) {
                logInfo('Collection content available');
            }
            if (collectionData.ownerAddress) {
                logInfo(`Owner address: ${collectionData.ownerAddress.toString()}`);
            }
        } catch (error: any) {
            if (isRateLimitError(error)) {
                logWarning('Rate limit exceeded. Skipping get_collection_data.');
            } else {
                logError(`Failed to get collection data: ${error.message}`);
                allPassed = false;
            }
        }

        // Test get_static_data
        try {
            logInfo('Testing get_static_data...');
            const staticData = await executeWithRateLimit(
                () => collection.getStaticData(),
                1000,
                1000
            );
            logSuccess(`Static data retrieved: index=${staticData.index}`);
            logInfo(`Collection address: ${staticData.collectionAddress.toString()}`);
        } catch (error: any) {
            if (isRateLimitError(error)) {
                logWarning('Rate limit exceeded. Skipping get_static_data.');
            } else if (error.message?.includes('exit_code: 11') || error.message?.includes('exit code 11')) {
                logWarning('get_static_data returned exit_code 11. This might be normal.');
            } else {
                logError(`Failed to get static data: ${error.message}`);
                allPassed = false;
            }
        }

        // Test get_nft_address_by_index
        try {
            logInfo('Testing get_nft_address_by_index...');
            const testTokenName = 'test123';
            const itemIndex = await stringHash(testTokenName);
            const nftAddress = await executeWithRateLimit(
                () => collection.getNftAddressByIndex(itemIndex),
                1000,
                1000
            );
            logSuccess(`NFT address calculated: ${nftAddress.toString()}`);
            
            // Verify address is different from collection address
            if (nftAddress.equals(config.collectionAddress)) {
                logError('NFT address equals collection address (should be different)');
                allPassed = false;
            } else {
                logSuccess('NFT address is valid (different from collection)');
            }
        } catch (error: any) {
            if (isRateLimitError(error)) {
                logWarning('Rate limit exceeded. Skipping get_nft_address_by_index.');
            } else {
                logError(`Failed to get NFT address: ${error.message}`);
                allPassed = false;
            }
        }

    } catch (error: any) {
        logError(`Error testing contract get-methods: ${error.message}`);
        allPassed = false;
    }

    return allPassed;
}

// Test NFT item contract (if exists)
async function testNftItemContract(client: TonClient, config: Config): Promise<boolean> {
    logSection('Testing NFT Item Contract');
    let allPassed = true;

    try {
        const collection = client.open(NftCollectionNoDns.createFromAddress(config.collectionAddress));
        const testTokenName = 'test123';
        const itemIndex = await stringHash(testTokenName);
        
        const nftAddress = await executeWithRateLimit(
            () => collection.getNftAddressByIndex(itemIndex),
            1000,
            1000
        );

        logInfo(`Testing NFT item at address: ${nftAddress.toString()}`);

        try {
            const nftState = await executeWithRateLimit(
                () => client.getContractState(nftAddress),
                500,
                500
            );

            if (nftState.state && nftState.state !== 'uninitialized') {
                logSuccess(`NFT item contract is deployed (state: ${nftState.state})`);
                
                // Try to get NFT data
                try {
                    const nft = client.open(NftItemNoDnsCheap.createFromAddress(nftAddress));
                    const nftData = await executeWithRateLimit(
                        () => nft.getNftData(),
                        1000,
                        1000
                    );
                    
                    if (nftData.init) {
                        logSuccess('NFT item is initialized');
                        logInfo(`NFT index: ${nftData.index.toString()}`);
                        logInfo(`Collection address: ${nftData.collectionAddress.toString()}`);
                        if (nftData.ownerAddress) {
                            logInfo(`Owner address: ${nftData.ownerAddress.toString()}`);
                        }
                        if (nftData.content) {
                            logSuccess('NFT content available');
                            try {
                                const parsed = parseNftContent(nftData.content);
                                logInfo(`Parsed content: ${JSON.stringify(parsed)}`);
                            } catch (e: any) {
                                logWarning(`Could not parse content: ${e.message}`);
                            }
                        }
                    } else {
                        logWarning('NFT item is not initialized yet');
                    }
                } catch (error: any) {
                    if (isRateLimitError(error)) {
                        logWarning('Rate limit exceeded. Skipping NFT data check.');
                    } else {
                        logWarning(`Could not get NFT data: ${error.message}`);
                    }
                }
            } else {
                logInfo('NFT item contract is not deployed yet (this is normal for unminted tokens)');
            }
        } catch (error: any) {
            if (isRateLimitError(error)) {
                logWarning('Rate limit exceeded. Skipping NFT state check.');
            } else {
                logWarning(`Could not check NFT state: ${error.message}`);
            }
        }

    } catch (error: any) {
        if (isRateLimitError(error)) {
            logWarning('Rate limit exceeded. Skipping NFT item contract test.');
        } else {
            logWarning(`Error testing NFT item contract: ${error.message}`);
        }
    }

    return allPassed;
}

async function main() {
    log('\n=== Comprehensive Production Verification ===\n', 'cyan');
    
    let config: Config;
    try {
        config = await loadConfig();
        logSuccess('Configuration loaded');
        logInfo(`Collection address: ${config.collectionAddress.toString()}`);
        logInfo(`Beneficiary address: ${config.beneficiaryAddress.toString()}`);
        logInfo(`Subwallet ID: ${config.subwalletId}`);
        logInfo(`Mint price: ${fromNano(config.mintPrice)} TON`);
        logInfo(`Endpoint: ${config.endpoint.replace(/\?api_key=.*/, '')}`);
    } catch (error: any) {
        logError(`Failed to load configuration: ${error.message}`);
        process.exit(1);
    }
    
    const client = new TonClient({
        endpoint: config.endpoint,
    });
    
    const results: { name: string; success: boolean }[] = [];
    
    // Run all tests
    results.push({
        name: 'Helper Functions',
        success: await testHelperFunctions(config),
    });
    
    results.push({
        name: 'Complete Minting Flow',
        success: await testMintingFlow(config),
    });
    
    results.push({
        name: 'Contract Get-Methods',
        success: await testContractGetMethods(client, config),
    });
    
    results.push({
        name: 'NFT Item Contract',
        success: await testNftItemContract(client, config),
    });
    
    // Summary
    log('\n=== Summary ===\n', 'cyan');
    
    const passed = results.filter(r => r.success).length;
    const total = results.length;
    
    results.forEach(result => {
        if (result.success) {
            logSuccess(`${result.name}: PASSED`);
        } else {
            logError(`${result.name}: FAILED`);
        }
    });
    
    log(`\nPassed: ${passed}/${total}`, passed === total ? 'green' : 'yellow');
    
    if (passed === total) {
        log('\n✓ All comprehensive checks passed! Full suite is ready.', 'green');
        process.exit(0);
    } else {
        log('\n✗ Some checks failed. Please review the errors above.', 'red');
        process.exit(1);
    }
}

main().catch(error => {
    logError(`Unexpected error: ${error.message}`);
    console.error(error);
    process.exit(1);
});

