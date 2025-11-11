/**
 * NFT Minting and Auction verification script
 * 
 * This script verifies:
 * 1. Minting message preparation and signing
 * 2. Auction configuration (direct mint vs regular auction)
 * 3. NFT item auction state and config
 * 4. Complete minting flow validation
 * 
 * Usage:
 *   ts-node scripts/checkMintAndAuction.ts [tokenName]
 * 
 * If tokenName is provided, checks existing NFT. Otherwise, prepares mint message.
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
    parseNftContent,
} from '../helpers/nftContent';
import {
    createNoRoyaltyParams,
    createRoyaltyParams,
} from '../helpers/royaltyParams';
import {
    createRestrictions,
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

    if (!collectionAddressStr || !publicKeyStr || !privateKeyStr || !beneficiaryAddressStr) {
        throw new Error('Missing required environment variables');
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
    initialDelay: number = 1000
): Promise<T> {
    let delay = initialDelay;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            if (!isRateLimitError(error) || attempt === maxRetries) {
                throw error;
            }
            await sleep(delay);
            delay *= 2;
        }
    }
    throw new Error('Max retries exceeded');
}

async function executeWithRateLimit<T>(
    fn: () => Promise<T>,
    delayBefore: number = 500,
    delayAfter: number = 500
): Promise<T> {
    if (delayBefore > 0) await sleep(delayBefore);
    try {
        const result = await retryWithBackoff(fn);
        if (delayAfter > 0) await sleep(delayAfter);
        return result;
    } catch (error: any) {
        if (isRateLimitError(error)) {
            logWarning('Rate limit exceeded after retries.');
        }
        throw error;
    }
}

// Test minting message preparation
async function testMintingMessagePreparation(config: Config): Promise<boolean> {
    logSection('1. Minting Message Preparation');
    let allPassed = true;

    try {
        const testTokenName = `test_mint_${Date.now()}`;
        const now = Math.floor(Date.now() / 1000);

        logInfo(`Preparing mint message for token: ${testTokenName}`);

        // Step 1: Create NFT content
        const nftContent = createNumberNftContent(testTokenName);
        logSuccess('NFT content created');

        // Step 2: Create direct mint auction config
        const auctionConfig = createDirectMintAuctionConfig({
            beneficiaryAddress: config.beneficiaryAddress,
            mintPrice: config.mintPrice,
        });
        logSuccess('Direct mint auction config created');
        logInfo(`  Initial min bid: ${fromNano(config.mintPrice)} TON`);
        logInfo(`  Max bid: ${fromNano(config.mintPrice)} TON (same as min = instant completion)`);
        logInfo(`  Duration: 0 (instant)`);

        // Step 3: Create royalty params
        const royaltyParams = createNoRoyaltyParams(config.beneficiaryAddress);
        logSuccess('Royalty params created');

        // Step 4: Create restrictions
        const restrictions = createRestrictions({
            forceSenderAddress: config.beneficiaryAddress,
        });
        logSuccess('Restrictions created');

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
        logSuccess('Unsigned message created');

        // Step 6: Sign message
        const signature = signDeployMessage(unsignedMessage, config.privateKey);
        if (signature.length !== 64) {
            logError(`Invalid signature length: ${signature.length}`);
            allPassed = false;
        } else {
            logSuccess('Message signed');
            logInfo(`  Signature: ${signature.toString('hex').substring(0, 16)}...`);
        }

        // Step 7: Create signed message
        const signedMessage = createSignedDeployMessageV2(unsignedMessage, signature);
        const messageBoc = signedMessage.toBoc();
        logSuccess('Signed message created');
        logInfo(`  Message BOC size: ${messageBoc.length} bytes`);

        // Step 8: Calculate NFT address
        const itemIndex = await stringHash(testTokenName);
        logSuccess(`NFT index calculated: ${itemIndex.toString()}`);

        return allPassed;
    } catch (error: any) {
        logError(`Error preparing mint message: ${error.message}`);
        return false;
    }
}

// Test auction configuration
async function testAuctionConfiguration(config: Config): Promise<boolean> {
    logSection('2. Auction Configuration');
    let allPassed = true;

    try {
        // Test direct mint config
        logInfo('Testing direct mint auction config...');
        const directMintConfig = createDirectMintAuctionConfig({
            beneficiaryAddress: config.beneficiaryAddress,
            mintPrice: config.mintPrice,
        });
        logSuccess('Direct mint config created');
        logInfo('  This config creates instant auction completion (maxBid = initialMinBid)');

        // Test regular auction config
        logInfo('Testing regular auction config...');
        const regularAuctionConfig = createAuctionConfig({
            beneficiaryAddress: config.beneficiaryAddress,
            initialMinBid: config.mintPrice,
            maxBid: 0n, // No limit
            minBidStep: 5,
            minExtendTime: 300,
            duration: 3600, // 1 hour
        });
        logSuccess('Regular auction config created');
        logInfo(`  Initial min bid: ${fromNano(config.mintPrice)} TON`);
        logInfo(`  Max bid: unlimited (0)`);
        logInfo(`  Min bid step: 5%`);
        logInfo(`  Min extend time: 300 seconds`);
        logInfo(`  Duration: 3600 seconds (1 hour)`);

        return allPassed;
    } catch (error: any) {
        logError(`Error testing auction configuration: ${error.message}`);
        return false;
    }
}

// Check existing NFT auction state
async function checkNftAuctionState(
    client: TonClient,
    collectionAddress: Address,
    tokenName: string,
    config: Config
): Promise<boolean> {
    logSection(`3. NFT Auction State (${tokenName})`);
    let allPassed = true;

    try {
        const collection = client.open(NftCollectionNoDns.createFromAddress(collectionAddress));
        const itemIndex = await stringHash(tokenName);

        // Get NFT address
        const nftAddress = await executeWithRateLimit(
            () => collection.getNftAddressByIndex(itemIndex),
            1000,
            1000
        );
        logInfo(`NFT address: ${nftAddress.toString()}`);

        // Check if NFT is deployed
        const nftState = await executeWithRateLimit(
            () => client.getContractState(nftAddress),
            500,
            500
        );

        if (!nftState.state || nftState.state === 'uninitialized') {
            logWarning('NFT item contract is not deployed yet');
            logInfo('This is normal for unminted tokens');
            return true;
        }

        logSuccess(`NFT item is deployed (state: ${nftState.state})`);

        // Get NFT data
        const nft = client.open(NftItemNoDnsCheap.createFromAddress(nftAddress));
        
        try {
            const nftData = await executeWithRateLimit(
                () => nft.getNftData(),
                1000,
                1000
            );

            if (!nftData.init) {
                logWarning('NFT item is not initialized yet');
                return true;
            }

            logSuccess('NFT data retrieved');
            logInfo(`  Index: ${nftData.index.toString()}`);
            logInfo(`  Collection: ${nftData.collectionAddress.toString()}`);
            if (nftData.ownerAddress) {
                logInfo(`  Owner: ${nftData.ownerAddress.toString()}`);
            } else {
                logInfo(`  Owner: None (auction active)`);
            }

            // Get token name
            try {
                const tokenNameFromContract = await executeWithRateLimit(
                    () => nft.getTelemintTokenName(),
                    1000,
                    1000
                );
                logSuccess(`Token name: ${tokenNameFromContract}`);
                if (tokenNameFromContract !== tokenName) {
                    logWarning(`Token name mismatch: expected ${tokenName}, got ${tokenNameFromContract}`);
                }
            } catch (error: any) {
                if (isRateLimitError(error)) {
                    logWarning('Rate limit exceeded. Skipping token name check.');
                } else {
                    logWarning(`Could not get token name: ${error.message}`);
                }
            }

            // Get auction config
            try {
                const auctionConfig = await executeWithRateLimit(
                    () => nft.getTelemintAuctionConfig(),
                    1000,
                    1000
                );

                logSuccess('Auction config retrieved');
                if (auctionConfig.beneficiaryAddress) {
                    logInfo(`  Beneficiary: ${auctionConfig.beneficiaryAddress.toString()}`);
                }
                logInfo(`  Initial min bid: ${fromNano(auctionConfig.initialMinBid)} TON`);
                logInfo(`  Max bid: ${auctionConfig.maxBid === 0n ? 'unlimited' : fromNano(auctionConfig.maxBid) + ' TON'}`);
                logInfo(`  Min bid step: ${auctionConfig.minBidStep}%`);
                logInfo(`  Min extend time: ${auctionConfig.minExtendTime} seconds`);
                logInfo(`  Duration: ${auctionConfig.duration} seconds`);

                // Check if it's direct mint config
                if (auctionConfig.initialMinBid === auctionConfig.maxBid && auctionConfig.duration === 0) {
                    logInfo('  Type: Direct mint (instant completion)');
                } else {
                    logInfo('  Type: Regular auction');
                }
            } catch (error: any) {
                if (isRateLimitError(error)) {
                    logWarning('Rate limit exceeded. Skipping auction config check.');
                } else {
                    logWarning(`Could not get auction config: ${error.message}`);
                    logInfo('NFT might not have an active auction');
                }
            }

            // Get auction state
            try {
                const auctionState = await executeWithRateLimit(
                    () => nft.getTelemintAuctionState(),
                    1000,
                    1000
                );

                logSuccess('Auction state retrieved');
                if (auctionState.bidderAddress) {
                    logInfo(`  Current bidder: ${auctionState.bidderAddress.toString()}`);
                    logInfo(`  Current bid: ${fromNano(auctionState.bid)} TON`);
                    logInfo(`  Bid timestamp: ${new Date(auctionState.bidTs * 1000).toISOString()}`);
                } else {
                    logInfo(`  Current bidder: None`);
                }
                logInfo(`  Min bid: ${fromNano(auctionState.minBid)} TON`);
                logInfo(`  End time: ${new Date(auctionState.endTime * 1000).toISOString()}`);

                const now = Math.floor(Date.now() / 1000);
                if (auctionState.endTime > now) {
                    const remaining = auctionState.endTime - now;
                    logInfo(`  Time remaining: ${Math.floor(remaining / 60)} minutes`);
                } else {
                    logWarning('  Auction has ended');
                }
            } catch (error: any) {
                if (isRateLimitError(error)) {
                    logWarning('Rate limit exceeded. Skipping auction state check.');
                } else if (error.message?.includes('no_auction') || error.message?.includes('exit_code')) {
                    logInfo('No active auction (NFT might be already sold or not minted with auction)');
                } else {
                    logWarning(`Could not get auction state: ${error.message}`);
                }
            }

            // Get royalty params
            try {
                const royaltyParams = await executeWithRateLimit(
                    () => nft.getRoyaltyParams(),
                    1000,
                    1000
                );
                logSuccess('Royalty params retrieved');
                logInfo(`  Numerator: ${royaltyParams.numerator}`);
                logInfo(`  Denominator: ${royaltyParams.denominator}`);
                logInfo(`  Rate: ${(royaltyParams.numerator / royaltyParams.denominator * 100).toFixed(2)}%`);
                logInfo(`  Destination: ${royaltyParams.destination.toString()}`);
            } catch (error: any) {
                if (isRateLimitError(error)) {
                    logWarning('Rate limit exceeded. Skipping royalty params check.');
                } else {
                    logWarning(`Could not get royalty params: ${error.message}`);
                }
            }

        } catch (error: any) {
            if (isRateLimitError(error)) {
                logWarning('Rate limit exceeded. Skipping NFT data check.');
            } else {
                logError(`Failed to get NFT data: ${error.message}`);
                allPassed = false;
            }
        }

        return allPassed;
    } catch (error: any) {
        if (isRateLimitError(error)) {
            logWarning('Rate limit exceeded. Skipping NFT auction check.');
            return true;
        }
        logError(`Error checking NFT auction state: ${error.message}`);
        return false;
    }
}

async function main() {
    log('\n=== NFT Minting and Auction Verification ===\n', 'cyan');
    
    const tokenName = process.argv[2]; // Optional token name to check
    
    let config: Config;
    try {
        config = await loadConfig();
        logSuccess('Configuration loaded');
        logInfo(`Collection address: ${config.collectionAddress.toString()}`);
        logInfo(`Beneficiary address: ${config.beneficiaryAddress.toString()}`);
        logInfo(`Mint price: ${fromNano(config.mintPrice)} TON`);
    } catch (error: any) {
        logError(`Failed to load configuration: ${error.message}`);
        process.exit(1);
    }
    
    const client = new TonClient({
        endpoint: config.endpoint,
    });
    
    const results: { name: string; success: boolean }[] = [];
    
    // Test minting message preparation
    results.push({
        name: 'Minting Message Preparation',
        success: await testMintingMessagePreparation(config),
    });
    
    // Test auction configuration
    results.push({
        name: 'Auction Configuration',
        success: await testAuctionConfiguration(config),
    });
    
    // Check existing NFT if token name provided
    if (tokenName) {
        results.push({
            name: `NFT Auction State (${tokenName})`,
            success: await checkNftAuctionState(client, config.collectionAddress, tokenName, config),
        });
    } else {
        logSection('3. NFT Auction State');
        logInfo('No token name provided. Skipping NFT auction state check.');
        logInfo('Usage: ts-node scripts/checkMintAndAuction.ts <tokenName>');
    }
    
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
        log('\n✓ All minting and auction checks passed!', 'green');
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

