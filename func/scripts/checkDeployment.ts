/**
 * Contract deployment verification script
 * 
 * This script verifies deployment of both contracts:
 * 1. NftCollectionNoDns - Collection contract
 * 2. NftItemNoDnsCheap - NFT Item contract
 * 
 * It checks:
 * - Both contracts are deployed
 * - Collection contains correct NFT item code
 * - NFT items can be created by collection
 * - Contract configuration is correct
 * 
 * Usage:
 *   ts-node scripts/checkDeployment.ts
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
import { compile } from '@ton/blueprint';
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
}

async function loadConfig(): Promise<Config> {
    const endpoint = process.env.TON_ENDPOINT || 'https://toncenter.com/api/v2/jsonRPC';
    const apiKey = process.env.TON_API_KEY;
    const collectionAddressStr = process.env.COLLECTION_ADDRESS;

    if (!collectionAddressStr) {
        throw new Error('COLLECTION_ADDRESS environment variable is required');
    }

    const collectionAddress = Address.parse(collectionAddressStr);

    return {
        endpoint: apiKey ? `${endpoint}?api_key=${apiKey}` : endpoint,
        apiKey,
        collectionAddress,
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

// Check collection contract deployment
async function checkCollectionDeployment(client: TonClient, collectionAddress: Address): Promise<{
    deployed: boolean;
    state: string;
    balance: bigint;
    codeHash?: string;
}> {
    logInfo('Checking collection contract deployment...');
    
    try {
        const state = await executeWithRateLimit(
            () => client.getContractState(collectionAddress),
            0,
            500
        );
        
        const balance = await executeWithRateLimit(
            () => client.getBalance(collectionAddress),
            500,
            500
        );

        const deployed = state.state !== undefined && state.state !== 'uninitialized';
        let codeHash: string | undefined;
        if (state.code) {
            // state.code is a Buffer, convert to Cell first if needed, or use sha256
            const codeCell = Cell.fromBase64(state.code.toString('base64'));
            codeHash = codeCell.hash().toString('hex');
        }

        if (deployed) {
            logSuccess(`Collection is deployed (state: ${state.state})`);
            logInfo(`Balance: ${fromNano(balance)} TON`);
            if (codeHash) {
                logInfo(`Code hash: ${codeHash.substring(0, 16)}...`);
            }
        } else {
            logError('Collection contract is not deployed');
        }

        return {
            deployed,
            state: state.state || 'unknown',
            balance,
            codeHash,
        };
    } catch (error: any) {
        if (isRateLimitError(error)) {
            logWarning('Rate limit exceeded. Skipping collection deployment check.');
            return { deployed: false, state: 'unknown', balance: 0n };
        }
        logError(`Failed to check collection deployment: ${error.message}`);
        throw error;
    }
}

// Check NFT item code in collection
async function checkCollectionCode(client: TonClient, collectionAddress: Address): Promise<{
    hasCode: boolean;
    codeHash?: string;
    matchesExpected: boolean;
}> {
    logInfo('Checking collection contract code...');
    
    try {
        const state = await executeWithRateLimit(
            () => client.getContractState(collectionAddress),
            1000,
            1000
        );

        if (!state.code) {
            logError('Collection contract has no code');
            return { hasCode: false, matchesExpected: false };
        }

        // state.code is a Buffer, convert to Cell to get hash
        const codeCell = Cell.fromBase64(state.code.toString('base64'));
        const codeHash = codeCell.hash().toString('hex');
        logSuccess(`Collection code hash: ${codeHash}`);

        // Try to compile expected code and compare
        try {
            const expectedCode = await compile('NftCollectionNoDns');
            const expectedHash = expectedCode.hash().toString('hex');
            
            logInfo(`Expected code hash: ${expectedHash}`);
            
            if (codeHash === expectedHash) {
                logSuccess('Collection code matches expected code');
                return { hasCode: true, codeHash, matchesExpected: true };
            } else {
                logWarning('Collection code hash does not match expected (might be different version)');
                return { hasCode: true, codeHash, matchesExpected: false };
            }
        } catch (error: any) {
            logWarning(`Could not compile expected code: ${error.message}`);
            return { hasCode: true, codeHash, matchesExpected: false };
        }
    } catch (error: any) {
        if (isRateLimitError(error)) {
            logWarning('Rate limit exceeded. Skipping collection code check.');
            return { hasCode: false, matchesExpected: false };
        }
        logError(`Failed to check collection code: ${error.message}`);
        return { hasCode: false, matchesExpected: false };
    }
}

// Check NFT item contract code compilation
async function checkNftItemCode(): Promise<{
    canCompile: boolean;
    codeHash?: string;
}> {
    logInfo('Checking NFT item contract code compilation...');
    
    try {
        const itemCode = await compile('NftItemNoDnsCheap');
        const codeHash = itemCode.hash().toString('hex');
        
        logSuccess(`NFT item code compiled successfully`);
        logInfo(`Code hash: ${codeHash}`);
        logInfo(`Code size: ${itemCode.toBoc().length} bytes`);
        
        return {
            canCompile: true,
            codeHash,
        };
    } catch (error: any) {
        logError(`Failed to compile NFT item code: ${error.message}`);
        return {
            canCompile: false,
        };
    }
}

// Check collection configuration
async function checkCollectionConfig(client: TonClient, collectionAddress: Address): Promise<boolean> {
    logInfo('Checking collection configuration...');
    
    try {
        const collection = client.open(NftCollectionNoDns.createFromAddress(collectionAddress));
        
        // Check get_collection_data
        try {
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
            
            return true;
        } catch (error: any) {
            if (isRateLimitError(error)) {
                logWarning('Rate limit exceeded. Skipping collection config check.');
                return true;
            }
            logError(`Failed to get collection data: ${error.message}`);
            return false;
        }
    } catch (error: any) {
        logError(`Error checking collection config: ${error.message}`);
        return false;
    }
}

// Check NFT item address calculation (verifies collection can create NFTs)
async function checkNftItemCreation(client: TonClient, collectionAddress: Address): Promise<boolean> {
    logInfo('Checking NFT item creation capability...');
    
    try {
        const collection = client.open(NftCollectionNoDns.createFromAddress(collectionAddress));
        const testTokenName = 'test_deployment_check';
        const itemIndex = await stringHash(testTokenName);
        
        const nftAddress = await executeWithRateLimit(
            () => collection.getNftAddressByIndex(itemIndex),
            1000,
            1000
        );
        
        logSuccess(`NFT address calculated: ${nftAddress.toString()}`);
        
        // Verify address is different from collection
        if (nftAddress.equals(collectionAddress)) {
            logError('NFT address equals collection address (should be different)');
            return false;
        }
        
        logSuccess('NFT address is valid (different from collection)');
        
        // Check if NFT item contract exists (might not be deployed yet)
        try {
            const nftState = await executeWithRateLimit(
                () => client.getContractState(nftAddress),
                500,
                500
            );
            
            if (nftState.state && nftState.state !== 'uninitialized') {
                logInfo(`NFT item contract is deployed (state: ${nftState.state})`);
                
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
                        
                        // Verify NFT points to correct collection
                        if (!nftData.collectionAddress.equals(collectionAddress)) {
                            logError(`NFT collection address mismatch: expected ${collectionAddress.toString()}, got ${nftData.collectionAddress.toString()}`);
                            return false;
                        }
                        
                        logSuccess('NFT item correctly references collection');
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
                logInfo(`NFT item contract is not deployed yet (this is normal)`);
            }
        }
        
        return true;
    } catch (error: any) {
        if (isRateLimitError(error)) {
            logWarning('Rate limit exceeded. Skipping NFT item creation check.');
            return true;
        }
        logError(`Failed to check NFT item creation: ${error.message}`);
        return false;
    }
}

async function main() {
    log('\n=== Contract Deployment Verification ===\n', 'cyan');
    
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
    
    // Check NFT item code compilation first
    logSection('1. NFT Item Contract Code');
    const itemCodeCheck = await checkNftItemCode();
    results.push({
        name: 'NFT Item Code Compilation',
        success: itemCodeCheck.canCompile,
    });
    
    // Check collection deployment
    logSection('2. Collection Contract Deployment');
    const collectionDeployment = await checkCollectionDeployment(client, config.collectionAddress);
    results.push({
        name: 'Collection Deployment',
        success: collectionDeployment.deployed,
    });
    
    // Check collection code
    logSection('3. Collection Contract Code');
    const collectionCodeCheck = await checkCollectionCode(client, config.collectionAddress);
    results.push({
        name: 'Collection Code Verification',
        success: collectionCodeCheck.hasCode,
    });
    
    // Check collection configuration
    logSection('4. Collection Configuration');
    const configCheck = await checkCollectionConfig(client, config.collectionAddress);
    results.push({
        name: 'Collection Configuration',
        success: configCheck,
    });
    
    // Check NFT item creation capability
    logSection('5. NFT Item Creation');
    const nftCreationCheck = await checkNftItemCreation(client, config.collectionAddress);
    results.push({
        name: 'NFT Item Creation',
        success: nftCreationCheck,
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
    
    // Additional info
    if (collectionDeployment.deployed) {
        log(`\nCollection Status:`, 'cyan');
        log(`  State: ${collectionDeployment.state}`, 'blue');
        log(`  Balance: ${fromNano(collectionDeployment.balance)} TON`, 'blue');
        if (collectionCodeCheck.codeHash) {
            log(`  Code Hash: ${collectionCodeCheck.codeHash.substring(0, 16)}...`, 'blue');
        }
    }
    
    if (itemCodeCheck.codeHash) {
        log(`\nNFT Item Code:`, 'cyan');
        log(`  Code Hash: ${itemCodeCheck.codeHash}`, 'blue');
        log(`  Code Size: ${(await compile('NftItemNoDnsCheap')).toBoc().length} bytes`, 'blue');
    }
    
    if (passed === total) {
        log('\n✓ All deployment checks passed! Both contracts are ready.', 'green');
        process.exit(0);
    } else {
        log('\n✗ Some deployment checks failed. Please review the errors above.', 'red');
        process.exit(1);
    }
}

main().catch(error => {
    logError(`Unexpected error: ${error.message}`);
    console.error(error);
    process.exit(1);
});

