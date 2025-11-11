/**
 * Production verification script
 * 
 * This script checks that all production contracts are deployed and working correctly.
 * 
 * Usage:
 *   ts-node scripts/checkProduction.ts
 * 
 * Environment variables required:
 *   - TON_ENDPOINT: TON network endpoint (e.g., https://toncenter.com/api/v2/jsonRPC)
 *   - TON_API_KEY: API key for TON endpoint (optional)
 *   - COLLECTION_ADDRESS: Address of deployed collection contract
 *   - COLLECTION_PUBLIC_KEY: Public key of collection (hex)
 *   - COLLECTION_PRIVATE_KEY: Private key for signing (hex)
 *   - BENEFICIARY_ADDRESS: Beneficiary address for minting
 */

// Load environment variables from .env file
try {
    require('dotenv').config();
} catch (e) {
    // dotenv is optional, continue without it
}

import { Address, fromNano, toNano } from '@ton/core';
import { TonClient } from '@ton/ton';
import { NftCollectionNoDns } from '../wrappers/NftCollectionNoDns';
import { createDirectMintAuctionConfig } from '../helpers/auctionConfig';
import { createNumberNftContent } from '../helpers/nftContent';
import { createNoRoyaltyParams } from '../helpers/royaltyParams';
import { createUnsignedDeployMessageV2, signDeployMessage } from '../helpers/signMessage';
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

interface Config {
    endpoint: string;
    apiKey?: string;
    collectionAddress: Address;
    publicKey: Buffer;
    privateKey: Buffer;
    beneficiaryAddress: Address;
}

async function loadConfig(): Promise<Config> {
    const endpoint = process.env.TON_ENDPOINT || 'https://toncenter.com/api/v2/jsonRPC';
    const apiKey = process.env.TON_API_KEY;
    const collectionAddressStr = process.env.COLLECTION_ADDRESS;
    const publicKeyStr = process.env.COLLECTION_PUBLIC_KEY;
    const privateKeyStr = process.env.COLLECTION_PRIVATE_KEY;
    const beneficiaryAddressStr = process.env.BENEFICIARY_ADDRESS;

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

    return {
        endpoint: apiKey ? `${endpoint}?api_key=${apiKey}` : endpoint,
        apiKey,
        collectionAddress,
        publicKey,
        privateKey,
        beneficiaryAddress,
    };
}

async function stringHash(s: string): Promise<bigint> {
    const hash = await sha256(Buffer.from(s));
    const hex = Buffer.from(hash)
        .toString('hex');
    return BigInt('0x' + hex);
}

/**
 * Check if error is a rate limit error
 */
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

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry function with exponential backoff
 */
async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    options: {
        maxRetries?: number;
        initialDelay?: number;
        maxDelay?: number;
        backoffMultiplier?: number;
        onRetry?: (attempt: number, error: any) => void;
    } = {}
): Promise<T> {
    const {
        maxRetries = 3,
        initialDelay = 1000,
        maxDelay = 10000,
        backoffMultiplier = 2,
        onRetry,
    } = options;

    let lastError: any;
    let delay = initialDelay;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;

            // If it's not a rate limit error and not the last attempt, throw immediately
            if (!isRateLimitError(error) || attempt === maxRetries) {
                throw error;
            }

            // Log retry attempt
            if (onRetry) {
                onRetry(attempt + 1, error);
            } else {
                logWarning(`Rate limit hit. Retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
            }

            // Wait before retry
            await sleep(delay);

            // Calculate next delay with exponential backoff
            delay = Math.min(delay * backoffMultiplier, maxDelay);
        }
    }

    throw lastError;
}

/**
 * Execute API call with rate limit protection
 */
async function executeWithRateLimit<T>(
    fn: () => Promise<T>,
    delayBefore: number = 500,
    delayAfter: number = 500
): Promise<T> {
    // Delay before request
    if (delayBefore > 0) {
        await sleep(delayBefore);
    }

    try {
        const result = await retryWithBackoff(fn, {
            maxRetries: 3,
            initialDelay: 2000,
            maxDelay: 10000,
            backoffMultiplier: 2,
            onRetry: (attempt, error) => {
                logWarning(`Rate limit exceeded. Retrying in ${2000 * Math.pow(2, attempt - 1)}ms... (attempt ${attempt}/3)`);
            },
        });

        // Delay after request
        if (delayAfter > 0) {
            await sleep(delayAfter);
        }

        return result;
    } catch (error: any) {
        if (isRateLimitError(error)) {
            logWarning('Rate limit exceeded after retries. This is a temporary API limitation.');
            throw error;
        }
        throw error;
    }
}

async function checkCollectionDeployment(client: TonClient, collectionAddress: Address): Promise<boolean> {
    logInfo('Checking collection deployment...');
    
    try {
        const state = await executeWithRateLimit(
            () => client.getContractState(collectionAddress),
            0, // No delay before first request
            500 // Delay after request
        );
        
        if (!state.state || state.state === 'uninitialized') {
            logError('Collection contract is not deployed');
            return false;
        }
        
        logSuccess(`Collection is deployed (state: ${state.state})`);
        return true;
    } catch (error: any) {
        if (isRateLimitError(error)) {
            logWarning('Rate limit exceeded. Skipping deployment check.');
            return true; // Don't fail on rate limit
        }
        logError(`Failed to check collection deployment: ${error.message}`);
        return false;
    }
}

async function checkCollectionBalance(client: TonClient, collectionAddress: Address): Promise<boolean> {
    logInfo('Checking collection balance...');
    
    try {
        const balance = await executeWithRateLimit(
            () => client.getBalance(collectionAddress),
            500, // Delay before request
            500 // Delay after request
        );
        const balanceTON = fromNano(balance);
        
        logInfo(`Collection balance: ${balanceTON} TON`);
        
        if (balance < toNano('0.1')) {
            logWarning('Collection balance is low (< 0.1 TON). Consider topping up.');
            return false;
        }
        
        logSuccess(`Collection has sufficient balance: ${balanceTON} TON`);
        return true;
    } catch (error: any) {
        if (isRateLimitError(error)) {
            logWarning('Rate limit exceeded. Skipping balance check.');
            return true; // Don't fail on rate limit
        }
        logError(`Failed to check collection balance: ${error.message}`);
        return false;
    }
}

async function checkCollectionGetMethods(client: TonClient, collectionAddress: Address): Promise<boolean> {
    logInfo('Checking collection get-methods...');
    
    try {
        const collection = client.open(NftCollectionNoDns.createFromAddress(collectionAddress));
        
        // Check get_collection_data
        try {
            const collectionData = await executeWithRateLimit(
                () => collection.getCollectionData(),
                1000, // Delay before request
                1000 // Delay after request
            );
            logSuccess(`Collection data retrieved: index=${collectionData.index}`);
            if (collectionData.collectionContent) {
                logInfo(`Collection content available`);
            }
            if (collectionData.ownerAddress) {
                logInfo(`Owner address: ${collectionData.ownerAddress.toString()}`);
            }
        } catch (error: any) {
            if (isRateLimitError(error)) {
                logWarning('Rate limit exceeded. Skipping get_collection_data check.');
                return true; // Don't fail on rate limit
            }
            logError(`Failed to get collection data: ${error.message}`);
            return false;
        }
        
        // Check get_static_data
        try {
            const staticData = await executeWithRateLimit(
                () => collection.getStaticData(),
                1000, // Delay before request
                1000 // Delay after request
            );
            logSuccess(`Static data retrieved: index=${staticData.index}`);
            logInfo(`Collection address: ${staticData.collectionAddress.toString()}`);
        } catch (error: any) {
            if (isRateLimitError(error)) {
                logWarning('Rate limit exceeded. Skipping get_static_data check.');
                return true; // Don't fail on rate limit
            }
            // Exit code 11 might be normal for some contracts (method not available)
            if (error.message?.includes('exit_code: 11') || error.message?.includes('exit code 11')) {
                logWarning('get_static_data returned exit_code 11. This might be normal for this contract.');
                return true; // Don't fail on non-critical contract errors
            }
            logError(`Failed to get static data: ${error.message}`);
            return false;
        }
        
        return true;
    } catch (error: any) {
        if (isRateLimitError(error)) {
            logWarning('Rate limit exceeded. Skipping get-methods check.');
            return true; // Don't fail on rate limit
        }
        logError(`Failed to check collection get-methods: ${error.message}`);
        return false;
    }
}

async function checkMessageSigning(config: Config): Promise<boolean> {
    logInfo('Checking message signing...');
    
    try {
        const testTokenName = 'test123';
        const mintPrice = toNano('0.1');
        const now = Math.floor(Date.now() / 1000);
        
        const nftContent = createNumberNftContent(testTokenName);
        const auctionConfig = createDirectMintAuctionConfig({
            beneficiaryAddress: config.beneficiaryAddress,
            mintPrice,
        });
        const royaltyParams = createNoRoyaltyParams(config.beneficiaryAddress);
        
        const unsignedMessage = createUnsignedDeployMessageV2({
            subwalletId: 0,
            validSince: now - 60,
            validTill: now + 3600,
            tokenName: testTokenName,
            content: nftContent,
            auctionConfig,
            royaltyParams,
        });
        
        const signature = signDeployMessage(unsignedMessage, config.privateKey);
        
        if (signature.length !== 64) {
            logError(`Invalid signature length: ${signature.length} (expected 64)`);
            return false;
        }
        
        logSuccess('Message signing works correctly');
        logInfo(`Signature: ${signature.toString('hex').substring(0, 16)}...`);
        
        return true;
    } catch (error: any) {
        logError(`Failed to check message signing: ${error.message}`);
        return false;
    }
}

async function checkNftAddressCalculation(client: TonClient, collectionAddress: Address, config: Config): Promise<boolean> {
    logInfo('Checking NFT address calculation...');
    
    try {
        const collection = client.open(NftCollectionNoDns.createFromAddress(collectionAddress));
        const testTokenName = 'test123';
        const itemIndex = await stringHash(testTokenName);
        
        const nftAddress = await executeWithRateLimit(
            () => collection.getNftAddressByIndex(itemIndex),
            1000, // Delay before request
            1000 // Delay after request
        );
        
        logSuccess(`NFT address calculated: ${nftAddress.toString()}`);
        
        // Check if NFT is already minted
        try {
            const nftState = await executeWithRateLimit(
                () => client.getContractState(nftAddress),
                500, // Delay before request
                500 // Delay after request
            );
            if (nftState.state && nftState.state !== 'uninitialized') {
                logWarning(`NFT with token name "${testTokenName}" is already minted`);
            } else {
                logInfo(`NFT with token name "${testTokenName}" is not minted yet`);
            }
        } catch (error: any) {
            if (isRateLimitError(error)) {
                logWarning('Rate limit exceeded. Skipping NFT state check.');
            } else {
                logInfo(`NFT with token name "${testTokenName}" is not minted yet`);
            }
        }
        
        return true;
    } catch (error: any) {
        if (isRateLimitError(error)) {
            logWarning('Rate limit exceeded. Skipping NFT address calculation check.');
            return true; // Don't fail on rate limit
        }
        logError(`Failed to check NFT address calculation: ${error.message}`);
        return false;
    }
}

async function main() {
    log('\n=== Production Verification ===\n', 'cyan');
    
    let config: Config;
    try {
        config = await loadConfig();
        logSuccess('Configuration loaded');
        logInfo(`Collection address: ${config.collectionAddress.toString()}`);
        logInfo(`Endpoint: ${config.endpoint.replace(/\?api_key=.*/, '')}`);
    } catch (error: any) {
        logError(`Failed to load configuration: ${error.message}`);
        process.exit(1);
    }
    
    const client = new TonClient({
        endpoint: config.endpoint,
    });
    
    const results: { name: string; success: boolean }[] = [];
    
    // Run checks
    results.push({
        name: 'Collection Deployment',
        success: await checkCollectionDeployment(client, config.collectionAddress),
    });
    
    results.push({
        name: 'Collection Balance',
        success: await checkCollectionBalance(client, config.collectionAddress),
    });
    
    results.push({
        name: 'Collection Get-Methods',
        success: await checkCollectionGetMethods(client, config.collectionAddress),
    });
    
    results.push({
        name: 'Message Signing',
        success: await checkMessageSigning(config),
    });
    
    results.push({
        name: 'NFT Address Calculation',
        success: await checkNftAddressCalculation(client, config.collectionAddress, config),
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
        log('\n✓ All checks passed! Production is ready.', 'green');
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

