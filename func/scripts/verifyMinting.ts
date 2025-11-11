/**
 * Complete NFT Minting Verification Script
 * 
 * This script verifies the complete NFT minting process:
 * 1. Creates correct minting payload
 * 2. Validates payload structure
 * 3. Checks that NFT can be minted (calculates address)
 * 4. If NFT exists, verifies all data can be read
 * 
 * Usage:
 *   ts-node scripts/verifyMinting.ts [tokenName]
 * 
 * If tokenName is provided, checks existing NFT. Otherwise, prepares new mint payload.
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
} from '../helpers/auctionConfig';
import {
    createNumberNftContent,
    parseNftContent,
} from '../helpers/nftContent';
import {
    createNoRoyaltyParams,
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
    magenta: '\x1b[35m',
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
    log(`\n=== ${title} ===`, 'cyan');
}

function logSubSection(title: string) {
    log(`\n--- ${title} ---`, 'magenta');
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

interface MintPayload {
    tokenName: string;
    nftContent: Cell;
    auctionConfig: Cell;
    royaltyParams: Cell;
    restrictions: Cell;
    unsignedMessage: Cell;
    signature: Buffer;
    signedMessage: Cell;
    nftAddress: Address;
    itemIndex: bigint;
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

// Create complete minting payload
async function createMintingPayload(
    tokenName: string,
    config: Config,
    client: TonClient
): Promise<MintPayload> {
    logSubSection('Creating Minting Payload');
    
    const now = Math.floor(Date.now() / 1000);
    
    // Step 1: Create NFT content
    logInfo('Step 1: Creating NFT content...');
    const nftContent = createNumberNftContent(tokenName);
    logSuccess(`NFT content created (${nftContent.toBoc().length} bytes)`);
    
    // Parse and verify content
    try {
        const parsedContent = parseNftContent(nftContent);
        logInfo(`  Content URI: ${parsedContent.uri || 'N/A'}`);
    } catch (e) {
        logWarning(`  Could not parse content: ${e}`);
    }
    
    // Step 2: Create auction config
    logInfo('Step 2: Creating auction config...');
    const auctionConfig = createDirectMintAuctionConfig({
        beneficiaryAddress: config.beneficiaryAddress,
        mintPrice: config.mintPrice,
    });
    logSuccess(`Auction config created (${auctionConfig.toBoc().length} bytes)`);
    logInfo(`  Initial min bid: ${fromNano(config.mintPrice)} TON`);
    logInfo(`  Max bid: ${fromNano(config.mintPrice)} TON (instant completion)`);
    
    // Step 3: Create royalty params
    logInfo('Step 3: Creating royalty params...');
    const royaltyParams = createNoRoyaltyParams(config.beneficiaryAddress);
    logSuccess(`Royalty params created (${royaltyParams.toBoc().length} bytes)`);
    
    // Step 4: Create restrictions
    logInfo('Step 4: Creating restrictions...');
    const restrictions = createRestrictions({
        forceSenderAddress: config.beneficiaryAddress,
    });
    logSuccess(`Restrictions created (${restrictions.toBoc().length} bytes)`);
    logInfo(`  Force sender: ${config.beneficiaryAddress.toString()}`);
    
    // Step 5: Create unsigned message
    logInfo('Step 5: Creating unsigned deploy message...');
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
    logSuccess(`Unsigned message created (${unsignedMessage.toBoc().length} bytes)`);
    logInfo(`  Subwallet ID: ${config.subwalletId}`);
    logInfo(`  Valid since: ${new Date((now - 60) * 1000).toISOString()}`);
    logInfo(`  Valid till: ${new Date((now + 3600) * 1000).toISOString()}`);
    
    // Step 6: Sign message
    logInfo('Step 6: Signing message...');
    const signature = signDeployMessage(unsignedMessage, config.privateKey);
    if (signature.length !== 64) {
        throw new Error(`Invalid signature length: ${signature.length} (expected 64)`);
    }
    logSuccess(`Message signed`);
    logInfo(`  Signature: ${signature.toString('hex').substring(0, 32)}...`);
    
    // Step 7: Create signed message
    logInfo('Step 7: Creating signed deploy message...');
    const signedMessage = createSignedDeployMessageV2(unsignedMessage, signature);
    const messageBoc = signedMessage.toBoc();
    logSuccess(`Signed message created (${messageBoc.length} bytes)`);
    
    // Step 8: Calculate NFT address
    logInfo('Step 8: Calculating NFT address...');
    const collection = client.open(NftCollectionNoDns.createFromAddress(config.collectionAddress));
    const itemIndex = await stringHash(tokenName);
    const nftAddress = await executeWithRateLimit(
        () => collection.getNftAddressByIndex(itemIndex),
        1000,
        1000
    );
    logSuccess(`NFT address calculated`);
    logInfo(`  Address: ${nftAddress.toString()}`);
    logInfo(`  Index: ${itemIndex.toString()}`);
    
    return {
        tokenName,
        nftContent,
        auctionConfig,
        royaltyParams,
        restrictions,
        unsignedMessage,
        signature,
        signedMessage,
        nftAddress,
        itemIndex,
    };
}

// Validate minting payload
function validateMintingPayload(payload: MintPayload, config: Config): boolean {
    logSubSection('Validating Minting Payload');
    let allValid = true;
    
    // Validate signature
    logInfo('Validating signature...');
    if (payload.signature.length !== 64) {
        logError(`Invalid signature length: ${payload.signature.length}`);
        allValid = false;
    } else {
        logSuccess('Signature length is correct (64 bytes)');
    }
    
    // Verify signature matches message
    try {
        const expectedSignature = signDeployMessage(payload.unsignedMessage, config.privateKey);
        if (!expectedSignature.equals(payload.signature)) {
            logError('Signature does not match unsigned message');
            allValid = false;
        } else {
            logSuccess('Signature matches unsigned message');
        }
    } catch (e: any) {
        logError(`Error verifying signature: ${e.message}`);
        allValid = false;
    }
    
    // Validate message structure
    logInfo('Validating message structure...');
    const messageBoc = payload.signedMessage.toBoc();
    if (messageBoc.length === 0) {
        logError('Signed message BOC is empty');
        allValid = false;
    } else {
        logSuccess(`Message BOC is valid (${messageBoc.length} bytes)`);
    }
    
    // Validate NFT address
    logInfo('Validating NFT address...');
    if (payload.nftAddress.equals(config.collectionAddress)) {
        logError('NFT address equals collection address (should be different)');
        allValid = false;
    } else {
        logSuccess('NFT address is valid (different from collection)');
    }
    
    return allValid;
}

// Verify NFT exists and can read all data
async function verifyNftData(
    client: TonClient,
    payload: MintPayload,
    config: Config
): Promise<boolean> {
    logSubSection('Verifying NFT Data');
    let allPassed = true;
    
    try {
        // Check if NFT is deployed
        logInfo('Checking if NFT is deployed...');
        const nftState = await executeWithRateLimit(
            () => client.getContractState(payload.nftAddress),
            500,
            500
        );
        
        if (!nftState.state || nftState.state === 'uninitialized') {
            logWarning('NFT item contract is not deployed yet');
            logInfo('This means the NFT has not been minted yet');
            logInfo('To mint, send the signed message to the collection contract');
            logInfo(`  To: ${config.collectionAddress.toString()}`);
            logInfo(`  Value: ${fromNano(config.mintPrice)} TON`);
            logInfo(`  Body: ${payload.signedMessage.toBoc().toString('base64')}`);
            return true; // Not an error, just not minted yet
        }
        
        logSuccess(`NFT item is deployed (state: ${nftState.state})`);
        
        // Open NFT contract
        const nft = client.open(NftItemNoDnsCheap.createFromAddress(payload.nftAddress));
        
        // Get NFT data
        logInfo('Reading NFT data...');
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
            
            // Verify collection address matches
            if (!nftData.collectionAddress.equals(config.collectionAddress)) {
                logError(`Collection address mismatch: expected ${config.collectionAddress.toString()}, got ${nftData.collectionAddress.toString()}`);
                allPassed = false;
            } else {
                logSuccess('Collection address matches');
            }
            
            // Verify index matches
            if (nftData.index !== payload.itemIndex) {
                logError(`Index mismatch: expected ${payload.itemIndex.toString()}, got ${nftData.index.toString()}`);
                allPassed = false;
            } else {
                logSuccess('Index matches');
            }
            
            if (nftData.ownerAddress) {
                logInfo(`  Owner: ${nftData.ownerAddress.toString()}`);
            } else {
                logInfo(`  Owner: None (auction active)`);
            }
            
            // Read token name
            logInfo('Reading token name...');
            try {
                const tokenName = await executeWithRateLimit(
                    () => nft.getTelemintTokenName(),
                    1000,
                    1000
                );
                logSuccess(`Token name: ${tokenName}`);
                
                if (tokenName !== payload.tokenName) {
                    logError(`Token name mismatch: expected ${payload.tokenName}, got ${tokenName}`);
                    allPassed = false;
                } else {
                    logSuccess('Token name matches');
                }
            } catch (error: any) {
                if (isRateLimitError(error)) {
                    logWarning('Rate limit exceeded. Skipping token name check.');
                } else {
                    logError(`Failed to get token name: ${error.message}`);
                    allPassed = false;
                }
            }
            
            // Read NFT content
            if (nftData.content) {
                logInfo('Reading NFT content...');
                try {
                    const parsedContent = parseNftContent(nftData.content);
                    logSuccess(`Content URI: ${parsedContent.uri || 'N/A'}`);
                } catch (e: any) {
                    logWarning(`Could not parse content: ${e.message}`);
                }
            }
            
            // Read auction config
            logInfo('Reading auction config...');
            try {
                const auctionConfig = await executeWithRateLimit(
                    () => nft.getTelemintAuctionConfig(),
                    1000,
                    1000
                );
                
                logSuccess('Auction config retrieved');
                logInfo(`  Beneficiary: ${auctionConfig.beneficiaryAddress?.toString() || 'None'}`);
                logInfo(`  Initial min bid: ${fromNano(auctionConfig.initialMinBid)} TON`);
                logInfo(`  Max bid: ${auctionConfig.maxBid === 0n ? 'unlimited' : fromNano(auctionConfig.maxBid) + ' TON'}`);
                
                // Verify beneficiary matches
                if (auctionConfig.beneficiaryAddress && !auctionConfig.beneficiaryAddress.equals(config.beneficiaryAddress)) {
                    logWarning(`Beneficiary mismatch: expected ${config.beneficiaryAddress.toString()}, got ${auctionConfig.beneficiaryAddress.toString()}`);
                } else {
                    logSuccess('Beneficiary address matches');
                }
            } catch (error: any) {
                if (isRateLimitError(error)) {
                    logWarning('Rate limit exceeded. Skipping auction config check.');
                } else {
                    logWarning(`Could not get auction config: ${error.message}`);
                }
            }
            
            // Read auction state
            logInfo('Reading auction state...');
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
                } else {
                    logInfo(`  Current bidder: None`);
                }
                logInfo(`  Min bid: ${fromNano(auctionState.minBid)} TON`);
                logInfo(`  End time: ${new Date(auctionState.endTime * 1000).toISOString()}`);
            } catch (error: any) {
                if (isRateLimitError(error)) {
                    logWarning('Rate limit exceeded. Skipping auction state check.');
                } else if (error.message?.includes('no_auction') || error.message?.includes('exit_code')) {
                    logInfo('No active auction (NFT might be already sold)');
                } else {
                    logWarning(`Could not get auction state: ${error.message}`);
                }
            }
            
            // Read royalty params
            logInfo('Reading royalty params...');
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
                
                // Verify destination matches
                if (!royaltyParams.destination.equals(config.beneficiaryAddress)) {
                    logWarning(`Royalty destination mismatch: expected ${config.beneficiaryAddress.toString()}, got ${royaltyParams.destination.toString()}`);
                } else {
                    logSuccess('Royalty destination matches');
                }
            } catch (error: any) {
                if (isRateLimitError(error)) {
                    logWarning('Rate limit exceeded. Skipping royalty params check.');
                } else {
                    logError(`Failed to get royalty params: ${error.message}`);
                    allPassed = false;
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
            logWarning('Rate limit exceeded. Skipping NFT verification.');
            return true;
        }
        logError(`Error verifying NFT data: ${error.message}`);
        return false;
    }
}

async function main() {
    log('\n=== Complete NFT Minting Verification ===\n', 'cyan');
    
    const tokenName = process.argv[2] || `test_mint_${Date.now()}`;
    
    let config: Config;
    try {
        config = await loadConfig();
        logSuccess('Configuration loaded');
        logInfo(`Collection address: ${config.collectionAddress.toString()}`);
        logInfo(`Token name: ${tokenName}`);
    } catch (error: any) {
        logError(`Failed to load configuration: ${error.message}`);
        process.exit(1);
    }
    
    const client = new TonClient({
        endpoint: config.endpoint,
    });
    
    const results: { name: string; success: boolean }[] = [];
    
    // Create minting payload
    logSection('1. Creating Minting Payload');
    let payload: MintPayload;
    try {
        payload = await createMintingPayload(tokenName, config, client);
        results.push({ name: 'Payload Creation', success: true });
    } catch (error: any) {
        logError(`Failed to create payload: ${error.message}`);
        results.push({ name: 'Payload Creation', success: false });
        process.exit(1);
    }
    
    // Validate payload
    logSection('2. Validating Payload');
    const isValid = validateMintingPayload(payload, config);
    results.push({ name: 'Payload Validation', success: isValid });
    
    if (!isValid) {
        logError('Payload validation failed. Cannot proceed.');
        process.exit(1);
    }
    
    // Verify NFT data
    logSection('3. Verifying NFT Data');
    const dataValid = await verifyNftData(client, payload, config);
    results.push({ name: 'NFT Data Verification', success: dataValid });
    
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
    
    // Minting instructions
    log('\n=== Minting Instructions ===\n', 'cyan');
    log('To mint this NFT, send a transaction with:', 'blue');
    log(`  To: ${config.collectionAddress.toString()}`, 'blue');
    log(`  Value: ${fromNano(config.mintPrice)} TON`, 'blue');
    log(`  Body (base64):`, 'blue');
    log(`  ${payload.signedMessage.toBoc().toString('base64')}`, 'yellow');
    log(`\nOr use the signed message hex:`, 'blue');
    log(`  ${payload.signedMessage.toBoc().toString('hex')}`, 'yellow');
    
    if (passed === total) {
        log('\n✓ All checks passed! Minting payload is ready.', 'green');
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

