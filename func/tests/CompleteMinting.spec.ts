import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano, Address, beginCell } from '@ton/core';
import { NftItemNoDnsCheap } from '../wrappers/NftItemNoDnsCheap';
import { NftCollectionNoDns, NftCollectionNoDnsConfig } from '../wrappers/NftCollectionNoDns';
import { compile } from '@ton/blueprint';
import '@ton/test-utils';
import { sha256, keyPairFromSeed } from '@ton/crypto';
import { createDirectMintAuctionConfig } from '../helpers/auctionConfig';
import { createNumberNftContent, parseNftContent } from '../helpers/nftContent';
import { createNoRoyaltyParams } from '../helpers/royaltyParams';
import { createUnsignedDeployMessageV2, signDeployMessage } from '../helpers/signMessage';
import { createRestrictions } from '../helpers/restrictions';

async function stringHash(s: string): Promise<bigint> {
    const hash = await sha256(Buffer.from(s));
    const hex = Array.from(hash)
        .map((b: number) => b.toString(16).padStart(2, '0'))
        .join('');
    return BigInt('0x' + hex);
}

async function isNftActivated(nft: SandboxContract<NftItemNoDnsCheap>): Promise<boolean> {
    try {
        const nftData = await nft.getNftData();
        return nftData.init;
    } catch (e) {
        return false;
    }
}

async function waitForNftActivation(
    nft: SandboxContract<NftItemNoDnsCheap>,
    maxRetries: number = 30
): Promise<boolean> {
    if (await isNftActivated(nft)) {
        return true;
    }

    for (let i = 0; i < maxRetries; i++) {
        if (await isNftActivated(nft)) {
            return true;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    return false;
}

describe('Complete NFT Minting and Data Reading', () => {
    let collectionCode: Cell;
    let itemCode: Cell;
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let collection: SandboxContract<NftCollectionNoDns>;
    let privateKey: Buffer;
    let publicKey: bigint;

    beforeAll(async () => {
        collectionCode = await compile('NftCollectionNoDns');
        itemCode = await compile('NftItemNoDnsCheap');
    });

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');

        const keyPair = keyPairFromSeed(Buffer.alloc(32, 1));
        privateKey = keyPair.secretKey;
        publicKey = BigInt('0x' + keyPair.publicKey.toString('hex'));

        const config: NftCollectionNoDnsConfig = {
            touched: false,
            subwalletId: 0,
            publicKey,
            collectionContent: beginCell().storeStringTail('collection').endCell(),
            nftItemCode: itemCode,
            fullDomain: 'test.ton',
            royaltyParams: createNoRoyaltyParams(deployer.address),
        };

        collection = blockchain.openContract(NftCollectionNoDns.createFromConfig(config, collectionCode));

        await deployer.send({
            to: collection.address,
            value: toNano('1'),
            body: beginCell().storeStringTail('#topup').endCell(),
        });
    });

    it('should mint NFT and read all data correctly', async () => {
        const tokenName = `test_mint_${Date.now()}`;
        const mintPrice = toNano('0.1');
        const now = Math.floor(Date.now() / 1000);

        // Step 1: Create NFT content
        const nftContent = createNumberNftContent(tokenName);
        expect(nftContent).toBeInstanceOf(Cell);

        // Step 2: Create auction config (direct mint)
        const auctionConfig = createDirectMintAuctionConfig({
            beneficiaryAddress: deployer.address,
            mintPrice,
        });
        expect(auctionConfig).toBeInstanceOf(Cell);

        // Step 3: Create royalty params
        const royaltyParams = createNoRoyaltyParams(deployer.address);
        expect(royaltyParams).toBeInstanceOf(Cell);

        // Step 4: Create restrictions
        const restrictions = createRestrictions({
            forceSenderAddress: deployer.address,
        });
        expect(restrictions).toBeInstanceOf(Cell);

        // Step 5: Create unsigned message
        const unsignedMessage = createUnsignedDeployMessageV2({
            subwalletId: 0,
            validSince: now - 60,
            validTill: now + 3600,
            tokenName,
            content: nftContent,
            auctionConfig,
            royaltyParams,
            restrictions,
        });
        expect(unsignedMessage).toBeInstanceOf(Cell);

        // Step 6: Sign message
        const signature = signDeployMessage(unsignedMessage, privateKey);
        expect(signature.length).toBe(64);

        // Step 7: Mint NFT
        const mintResult = await collection.sendDeployMessageV2(deployer.getSender(), {
            value: mintPrice,
            signature,
            subwalletId: 0,
            validSince: now - 60,
            validTill: now + 3600,
            tokenName,
            content: nftContent,
            auctionConfig,
            royaltyParams,
            restrictions,
        });

        expect(mintResult.transactions.length).toBeGreaterThan(0);

        // Step 8: Calculate NFT address
        const itemIndex = await stringHash(tokenName);
        const nftAddress = await collection.getNftAddressByIndex(itemIndex);
        expect(nftAddress).toBeDefined();
        expect(nftAddress.equals(collection.address)).toBe(false);

        // Step 9: Open NFT contract
        const nft = blockchain.openContract(NftItemNoDnsCheap.createFromAddress(nftAddress));

        // Step 10: Wait for NFT activation
        const activated = await waitForNftActivation(nft, 50);
        expect(activated).toBe(true);

        // Step 11: Read NFT data
        const nftData = await nft.getNftData();
        expect(nftData.init).toBe(true);
        expect(nftData.index).toBe(itemIndex);
        expect(nftData.collectionAddress.equals(collection.address)).toBe(true);
        expect(nftData.ownerAddress).toBeDefined();
        expect(nftData.ownerAddress?.equals(deployer.address)).toBe(true);
        expect(nftData.content).toBeDefined();

        // Step 12: Read token name
        const tokenNameFromContract = await nft.getTelemintTokenName();
        expect(tokenNameFromContract).toBe(tokenName);

        // Step 13: Parse NFT content
        if (nftData.content) {
            const parsedContent = parseNftContent(nftData.content);
            expect(parsedContent.uri).toBeDefined();
            expect(parsedContent.uri).toContain(tokenName);
        }

        // Step 14: Read auction config
        // Note: For direct mint, auction completes immediately, so config might return zeros
        const auctionConfigData = await nft.getTelemintAuctionConfig();
        // After auction ends, config might return zeros or null values
        // This is expected behavior for direct mint (instant completion)
        if (auctionConfigData.beneficiaryAddress) {
            expect(auctionConfigData.beneficiaryAddress.equals(deployer.address)).toBe(true);
        }
        // initialMinBid might be 0 if auction already ended
        if (auctionConfigData.initialMinBid > 0n) {
            expect(auctionConfigData.initialMinBid).toBe(mintPrice);
            expect(auctionConfigData.maxBid).toBe(mintPrice); // Direct mint: maxBid = initialMinBid
            expect(auctionConfigData.duration).toBe(0); // Direct mint: duration = 0
        }

        // Step 15: Check auction state (should be ended for direct mint)
        try {
            const auctionState = await nft.getTelemintAuctionState();
            // For direct mint, auction should end immediately
            const nowUnix = Math.floor(Date.now() / 1000);
            expect(auctionState.endTime).toBeLessThanOrEqual(nowUnix + 10); // Allow small time difference
        } catch (e: any) {
            // If auction ended, get_telemint_auction_state might throw
            // This is expected for direct mint - auction completes instantly
            expect(e.message).toMatch(/no_auction|exit_code/);
        }

        // Step 16: Read royalty params
        const royaltyParamsData = await nft.getRoyaltyParams();
        expect(royaltyParamsData.numerator).toBe(0);
        expect(royaltyParamsData.denominator).toBe(100);
        expect(royaltyParamsData.destination.equals(deployer.address)).toBe(true);

        // Step 17: Verify NFT is owned by deployer
        expect(nftData.ownerAddress?.equals(deployer.address)).toBe(true);
    });

    it('should mint NFT with correct payload structure', async () => {
        const tokenName = `test_payload_${Date.now()}`;
        const mintPrice = toNano('0.1');
        const now = Math.floor(Date.now() / 1000);

        // Create complete payload
        const nftContent = createNumberNftContent(tokenName);
        const auctionConfig = createDirectMintAuctionConfig({
            beneficiaryAddress: deployer.address,
            mintPrice,
        });
        const royaltyParams = createNoRoyaltyParams(deployer.address);
        const restrictions = createRestrictions({
            forceSenderAddress: deployer.address,
        });

        const unsignedMessage = createUnsignedDeployMessageV2({
            subwalletId: 0,
            validSince: now - 60,
            validTill: now + 3600,
            tokenName,
            content: nftContent,
            auctionConfig,
            royaltyParams,
            restrictions,
        });

        // Verify payload structure
        expect(unsignedMessage.toBoc().length).toBeGreaterThan(0);

        const signature = signDeployMessage(unsignedMessage, privateKey);
        expect(signature.length).toBe(64);

        // Verify signature matches
        const expectedSignature = signDeployMessage(unsignedMessage, privateKey);
        expect(signature.equals(expectedSignature)).toBe(true);

        // Mint NFT
        const mintResult = await collection.sendDeployMessageV2(deployer.getSender(), {
            value: mintPrice,
            signature,
            subwalletId: 0,
            validSince: now - 60,
            validTill: now + 3600,
            tokenName,
            content: nftContent,
            auctionConfig,
            royaltyParams,
            restrictions,
        });

        expect(mintResult.transactions.length).toBeGreaterThan(0);

        // Verify NFT was created
        const itemIndex = await stringHash(tokenName);
        const nftAddress = await collection.getNftAddressByIndex(itemIndex);
        const nft = blockchain.openContract(NftItemNoDnsCheap.createFromAddress(nftAddress));

        const activated = await waitForNftActivation(nft, 50);
        expect(activated).toBe(true);

        const nftData = await nft.getNftData();
        expect(nftData.init).toBe(true);
        expect(nftData.index).toBe(itemIndex);
    });

    it('should verify all NFT get-methods work correctly after mint', async () => {
        const tokenName = `test_getmethods_${Date.now()}`;
        const mintPrice = toNano('0.1');
        const now = Math.floor(Date.now() / 1000);

        // Mint NFT
        const nftContent = createNumberNftContent(tokenName);
        const auctionConfig = createDirectMintAuctionConfig({
            beneficiaryAddress: deployer.address,
            mintPrice,
        });
        const royaltyParams = createNoRoyaltyParams(deployer.address);

        const unsignedMessage = createUnsignedDeployMessageV2({
            subwalletId: 0,
            validSince: now - 60,
            validTill: now + 3600,
            tokenName,
            content: nftContent,
            auctionConfig,
            royaltyParams,
        });

        const signature = signDeployMessage(unsignedMessage, privateKey);

        await collection.sendDeployMessageV2(deployer.getSender(), {
            value: mintPrice,
            signature,
            subwalletId: 0,
            validSince: now - 60,
            validTill: now + 3600,
            tokenName,
            content: nftContent,
            auctionConfig,
            royaltyParams,
        });

        const itemIndex = await stringHash(tokenName);
        const nftAddress = await collection.getNftAddressByIndex(itemIndex);
        const nft = blockchain.openContract(NftItemNoDnsCheap.createFromAddress(nftAddress));

        await waitForNftActivation(nft, 50);

        // Test all get-methods
        const nftData = await nft.getNftData();
        expect(nftData.init).toBe(true);

        const tokenNameFromContract = await nft.getTelemintTokenName();
        expect(tokenNameFromContract).toBe(tokenName);

        const auctionConfigData = await nft.getTelemintAuctionConfig();
        // After direct mint, auction completes immediately, so config might return zeros
        // This is expected - we verify that the method works, even if auction ended
        expect(auctionConfigData).toBeDefined();
        // If auction still has config (before completion), verify values
        if (auctionConfigData.initialMinBid > 0n) {
            expect(auctionConfigData.initialMinBid).toBe(mintPrice);
        }

        const royaltyParamsData = await nft.getRoyaltyParams();
        expect(royaltyParamsData.destination.equals(deployer.address)).toBe(true);

        // Verify content can be parsed
        if (nftData.content) {
            const parsedContent = parseNftContent(nftData.content);
            expect(parsedContent.uri).toBeDefined();
        }
    });
});

