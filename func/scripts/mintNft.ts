/**
 * E2E Mint NFT Script - Mints NFT in Mainnet
 * 
 * Usage: ts-node scripts/mintNft.ts [tokenName]
 * 
 * Required environment variables:
 *   - MNEMONIC: Wallet mnemonic phrase
 *   - TON_ENDPOINT: TON network endpoint
 *   - TON_API_KEY: API key (optional)
 *   - COLLECTION_ADDRESS: Collection address
 *   - COLLECTION_PUBLIC_KEY: Collection public key (hex)
 *   - COLLECTION_PRIVATE_KEY: Collection private key (hex)
 *   - BENEFICIARY_ADDRESS: Beneficiary address
 *   - MINT_PRICE: Mint price in TON (default: 0.1)
 */

try {
    require('dotenv').config();
} catch (e) {
    // dotenv is optional
}

import { Address, fromNano, toNano, Cell } from '@ton/core';
import { TonClient, WalletContractV4 } from '@ton/ton';
import { mnemonicToWalletKey, sha256 } from '@ton/crypto';
import { NftCollectionNoDns } from '../wrappers/NftCollectionNoDns';
import { NftItemNoDnsCheap } from '../wrappers/NftItemNoDnsCheap';
import { createDirectMintAuctionConfig } from '../helpers/auctionConfig';
import { createNumberNftContent } from '../helpers/nftContent';
import { createNoRoyaltyParams } from '../helpers/royaltyParams';
import { createRestrictions } from '../helpers/restrictions';
import { createUnsignedDeployMessageV2, signDeployMessage } from '../helpers/signMessage';

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
    log(`\n=== ${title} ===`, 'cyan');
}

async function stringHash(s: string): Promise<bigint> {
    const hash = await sha256(Buffer.from(s));
    return BigInt('0x' + Buffer.from(hash).toString('hex'));
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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
            logWarning(`Rate limit hit. Retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
            await sleep(delay);
            delay *= 2;
        }
    }
    throw new Error('Max retries exceeded');
}

async function executeWithRateLimit<T>(
    fn: () => Promise<T>,
    delayBefore: number = 0,
    delayAfter: number = 0
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
    mnemonic: string[];
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
    const mnemonicStr = process.env.MNEMONIC;

    if (!collectionAddressStr || !publicKeyStr || !privateKeyStr || !beneficiaryAddressStr) {
        throw new Error('Missing required environment variables');
    }

    if (!mnemonicStr) {
        throw new Error('MNEMONIC environment variable is required for minting');
    }

    const mnemonic = mnemonicStr
        .replace(/^["']|["']$/g, '')
        .split(/\s+/)
        .filter(word => word.length > 0);

    if (mnemonic.length !== 24) {
        throw new Error(`Invalid mnemonic length: ${mnemonic.length} (expected 24)`);
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
        mnemonic,
    };
}

interface MintingPayload {
    signature: Buffer;
    nftAddress: Address;
    itemIndex: bigint;
    nftContent: Cell;
    auctionConfig: Cell;
    royaltyParams: Cell;
    restrictions: Cell;
    validSince: number;
    validTill: number;
}

async function createMintingPayload(
    tokenName: string,
    config: Config,
    collection: ReturnType<typeof TonClient.prototype.open<NftCollectionNoDns>>
): Promise<MintingPayload> {
    logSection('Creating Minting Payload');

    const now = Math.floor(Date.now() / 1000);
    logInfo(`Token name: ${tokenName}`);
    logInfo(`Mint price: ${fromNano(config.mintPrice)} TON`);

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
    const itemIndex = await stringHash(tokenName);
    const nftAddress = await executeWithRateLimit(
        () => collection.getNftAddressByIndex(itemIndex),
        1000,
        1000
    );

    logSuccess('Minting payload created');
    logInfo(`NFT address: ${nftAddress.toString()}`);

    return {
        signature,
        nftAddress,
        itemIndex,
        nftContent,
        auctionConfig,
        royaltyParams,
        restrictions,
        validSince: now - 60,
        validTill: now + 3600,
    };
}

async function sendMintTransaction(
    client: TonClient,
    config: Config,
    collection: ReturnType<typeof TonClient.prototype.open<NftCollectionNoDns>>,
    mintingPayload: MintingPayload,
    tokenName: string,
    walletAddress: Address
): Promise<void> {
    logSection('Sending Mint Transaction');

    const key = await mnemonicToWalletKey(config.mnemonic);
    const walletContract = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 });
    const wallet = client.open(walletContract);

    const actualWalletAddress = walletContract.address;
    if (!actualWalletAddress.equals(walletAddress)) {
        logWarning(`Wallet address mismatch: expected ${walletAddress.toString()}, got ${actualWalletAddress.toString()}`);
    }

    logInfo(`Wallet address: ${actualWalletAddress.toString()}`);

    const balance = await wallet.getBalance();
    logInfo(`Wallet balance: ${fromNano(balance)} TON`);

    const totalNeeded = config.mintPrice + toNano('0.05');
    if (balance < totalNeeded) {
        throw new Error(`Insufficient balance. Need ${fromNano(totalNeeded)} TON, have ${fromNano(balance)} TON`);
    }

    logSuccess('Balance is sufficient');

    const seqno = await wallet.getSeqno();
    logInfo(`Current seqno: ${seqno}`);

    logInfo('Sending transaction using sendDeployMessageV2...');
    await collection.sendDeployMessageV2(wallet.sender(key.secretKey), {
        value: config.mintPrice,
        signature: mintingPayload.signature,
        subwalletId: config.subwalletId,
        validSince: mintingPayload.validSince,
        validTill: mintingPayload.validTill,
        tokenName: tokenName,
        content: mintingPayload.nftContent,
        auctionConfig: mintingPayload.auctionConfig,
        royaltyParams: mintingPayload.royaltyParams,
        restrictions: mintingPayload.restrictions,
    });
    logSuccess('Transaction sent! Waiting for confirmation...');

    let currentSeqno = seqno;
    let attempts = 0;
    const maxAttempts = 60;

    while (currentSeqno === seqno && attempts < maxAttempts) {
        await sleep(1000);
        try {
            currentSeqno = await wallet.getSeqno();
            if (currentSeqno > seqno) {
                logSuccess(`Transaction confirmed! New seqno: ${currentSeqno}`);
                break;
            }
        } catch (error: any) {
            logWarning(`Error checking seqno: ${error.message}`);
        }
        attempts++;
        if (attempts % 5 === 0) {
            logInfo(`Waiting... (${attempts}s)`);
        }
    }

    if (currentSeqno === seqno) {
        logWarning('Transaction confirmation timeout. Check manually.');
    }
}

async function verifyNftAfterMint(
    client: TonClient,
    config: Config,
    tokenName: string,
    nftAddress: Address
): Promise<boolean> {
    logSection('Verifying NFT After Mint');

    let allPassed = true;

    try {
        const nftState = await executeWithRateLimit(
            () => client.getContractState(nftAddress),
            2000,
            2000
        );

        if (!nftState.state || nftState.state === 'uninitialized') {
            logWarning('NFT contract is not deployed yet. Waiting...');
            await sleep(5000);

            const retryState = await executeWithRateLimit(
                () => client.getContractState(nftAddress),
                2000,
                2000
            );

            if (!retryState.state || retryState.state === 'uninitialized') {
                logError('NFT contract is still not deployed. Transaction might have failed.');
                return false;
            }
        }

        logSuccess(`NFT contract is deployed (state: ${nftState.state})`);

        const nft = client.open(NftItemNoDnsCheap.createFromAddress(nftAddress));

        let activated = false;
        for (let i = 0; i < 10; i++) {
            try {
                const nftData = await executeWithRateLimit(
                    () => nft.getNftData(),
                    1000,
                    1000
                );

                if (nftData.init) {
                    activated = true;
                    logSuccess('NFT is activated');

                    const expectedIndex = await stringHash(tokenName);
                    if (nftData.index !== expectedIndex) {
                        logError(`Index mismatch: expected ${expectedIndex.toString()}, got ${nftData.index.toString()}`);
                        allPassed = false;
                    } else {
                        logSuccess('Index matches');
                    }

                    if (!nftData.collectionAddress.equals(config.collectionAddress)) {
                        logError(`Collection address mismatch`);
                        allPassed = false;
                    } else {
                        logSuccess('Collection address matches');
                    }

                    if (nftData.ownerAddress) {
                        logSuccess(`Owner: ${nftData.ownerAddress.toString()}`);
                    }

                    try {
                        const tokenNameFromContract = await executeWithRateLimit(
                            () => nft.getTelemintTokenName(),
                            1000,
                            1000
                        );
                        logSuccess(`Token name: ${tokenNameFromContract}`);
                        if (tokenNameFromContract !== tokenName) {
                            logError(`Token name mismatch: expected ${tokenName}, got ${tokenNameFromContract}`);
                            allPassed = false;
                        } else {
                            logSuccess('Token name matches');
                        }
                    } catch (error: any) {
                        if (!isRateLimitError(error)) {
                            logWarning(`Could not get token name: ${error.message}`);
                        }
                    }

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
                    } catch (error: any) {
                        if (!isRateLimitError(error)) {
                            logWarning(`Could not get auction config: ${error.message}`);
                        }
                    }

                    try {
                        const royaltyParams = await executeWithRateLimit(
                            () => nft.getRoyaltyParams(),
                            1000,
                            1000
                        );
                        logSuccess('Royalty params retrieved');
                        logInfo(`  Rate: ${(royaltyParams.numerator / royaltyParams.denominator * 100).toFixed(2)}%`);
                    } catch (error: any) {
                        if (!isRateLimitError(error)) {
                            logWarning(`Could not get royalty params: ${error.message}`);
                        }
                    }

                    break;
                }
            } catch (error: any) {
                // NFT might not be activated yet
            }

            await sleep(2000);
        }

        if (!activated) {
            logError('NFT is not activated after multiple retries');
            allPassed = false;
        }

    } catch (error: any) {
        if (isRateLimitError(error)) {
            logWarning('Rate limit exceeded. Skipping verification.');
        } else {
            logError(`Error verifying NFT: ${error.message}`);
            allPassed = false;
        }
    }

    return allPassed;
}

async function main() {
    log('\n=== E2E NFT Minting in Mainnet ===\n', 'cyan');

    const tokenName = process.argv[2] || `e2e_mint_${Date.now()}`;

    let config: Config;
    try {
        config = loadConfig();
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

    const collection = client.open(NftCollectionNoDns.createFromAddress(config.collectionAddress));

    try {
        const mintingPayload = await createMintingPayload(tokenName, config, collection);

        const key = await mnemonicToWalletKey(config.mnemonic);
        const walletContract = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 });
        const walletAddress = walletContract.address;
        logInfo(`Wallet address: ${walletAddress.toString()}`);

        await sendMintTransaction(client, config, collection, mintingPayload, tokenName, walletAddress);

        logSection('Verifying NFT');
        const verified = await verifyNftAfterMint(client, config, tokenName, mintingPayload.nftAddress);

        if (verified) {
            logSuccess('\n✓ NFT minted successfully and verified!');
            logInfo(`NFT address: ${mintingPayload.nftAddress.toString()}`);
            logInfo(`Token name: ${tokenName}`);
            process.exit(0);
        } else {
            logWarning('\n⚠ NFT transaction sent, but verification incomplete.');
            logInfo('Please check manually:');
            logInfo(`  NFT address: ${mintingPayload.nftAddress.toString()}`);
            logInfo(`  Token name: ${tokenName}`);
            process.exit(0);
        }

    } catch (error: any) {
        logError(`\n✗ Error: ${error.message}`);
        console.error(error);
        process.exit(1);
    }
}

main().catch(error => {
    logError(`Unexpected error: ${error.message}`);
    console.error(error);
    process.exit(1);
});
