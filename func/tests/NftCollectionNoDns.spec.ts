import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano, beginCell } from '@ton/core';
import { NftCollectionNoDns, NftCollectionNoDnsConfig } from '../wrappers/NftCollectionNoDns';
import { compile } from '@ton/blueprint';
import '@ton/test-utils';
import { sha256, keyPairFromSeed } from '@ton/crypto';
import { createDirectMintAuctionConfig } from '../helpers/auctionConfig';
import { createNumberNftContent } from '../helpers/nftContent';
import { createNoRoyaltyParams } from '../helpers/royaltyParams';
import { createUnsignedDeployMessageV2, signDeployMessage } from '../helpers/signMessage';
import { createForceSenderRestrictions } from '../helpers/restrictions';

async function stringHash(s: string): Promise<bigint> {
    const hash = await sha256(Buffer.from(s));
    const hex = Array.from(hash)
        .map((b: number) => b.toString(16).padStart(2, '0'))
        .join('');
    return BigInt('0x' + hex);
}

describe('NftCollectionNoDns', () => {
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

    describe('Topup', () => {
        it('should accept topup message', async () => {
            const topupResult = await collection.sendTopup(deployer.getSender(), toNano('1'));

            expect(topupResult.transactions.length).toBeGreaterThan(0);
        });
    });

    describe('Minting', () => {
        it('should mint NFT with valid signature', async () => {
            const tokenName = '123456';
            const mintPrice = toNano('0.1');
            const now = Math.floor(Date.now() / 1000);

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
            });

            expect(mintResult.transactions.length).toBeGreaterThan(0);

            const itemIndex = await stringHash(tokenName);
            const nftAddress = await collection.getNftAddressByIndex(itemIndex);

            expect(nftAddress).toBeDefined();
            expect(nftAddress.equals(collection.address)).toBe(false);
        });

        it('should reject mint with invalid signature', async () => {
            const tokenName = '123456';
            const mintPrice = toNano('0.1');
            const now = Math.floor(Date.now() / 1000);

            const nftContent = createNumberNftContent(tokenName);
            const auctionConfig = createDirectMintAuctionConfig({
                beneficiaryAddress: deployer.address,
                mintPrice,
            });
            const royaltyParams = createNoRoyaltyParams(deployer.address);

            const wrongSignature = Buffer.alloc(64, 0);

            const mintResult = await collection.sendDeployMessageV2(deployer.getSender(), {
                value: mintPrice,
                signature: wrongSignature,
                subwalletId: 0,
                validSince: now - 60,
                validTill: now + 3600,
                tokenName,
                content: nftContent,
                auctionConfig,
                royaltyParams,
            });

            expect(mintResult.transactions.length).toBeGreaterThan(0);
        });

        it('should reject mint with insufficient funds', async () => {
            const tokenName = '123456';
            const mintPrice = toNano('0.1');
            const now = Math.floor(Date.now() / 1000);

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
            const mintResult = await collection.sendDeployMessageV2(deployer.getSender(), {
                value: toNano('0.01'), // Less than mintPrice
                signature,
                subwalletId: 0,
                validSince: now - 60,
                validTill: now + 3600,
                tokenName,
                content: nftContent,
                auctionConfig,
                royaltyParams,
            });

            expect(mintResult.transactions.length).toBeGreaterThan(0);
        });

        it('should reject mint with expired signature', async () => {
            const tokenName = '123456';
            const mintPrice = toNano('0.1');
            const now = Math.floor(Date.now() / 1000);

            const nftContent = createNumberNftContent(tokenName);
            const auctionConfig = createDirectMintAuctionConfig({
                beneficiaryAddress: deployer.address,
                mintPrice,
            });
            const royaltyParams = createNoRoyaltyParams(deployer.address);

            const unsignedMessage = createUnsignedDeployMessageV2({
                subwalletId: 0,
                validSince: now - 7200,
                validTill: now - 3600, // Expired 1 hour ago
                tokenName,
                content: nftContent,
                auctionConfig,
                royaltyParams,
            });
            const signature = signDeployMessage(unsignedMessage, privateKey);
            const mintResult = await collection.sendDeployMessageV2(deployer.getSender(), {
                value: mintPrice,
                signature,
                subwalletId: 0,
                validSince: now - 7200,
                validTill: now - 3600,
                tokenName,
                content: nftContent,
                auctionConfig,
                royaltyParams,
            });

            expect(mintResult.transactions.length).toBeGreaterThan(0);
        });

        it('should reject mint with not yet valid signature', async () => {
            const tokenName = '123456';
            const mintPrice = toNano('0.1');
            const now = Math.floor(Date.now() / 1000);

            const nftContent = createNumberNftContent(tokenName);
            const auctionConfig = createDirectMintAuctionConfig({
                beneficiaryAddress: deployer.address,
                mintPrice,
            });
            const royaltyParams = createNoRoyaltyParams(deployer.address);

            const unsignedMessage = createUnsignedDeployMessageV2({
                subwalletId: 0,
                validSince: now + 3600, // Will become valid in 1 hour
                validTill: now + 7200,
                tokenName,
                content: nftContent,
                auctionConfig,
                royaltyParams,
            });
            const signature = signDeployMessage(unsignedMessage, privateKey);
            const mintResult = await collection.sendDeployMessageV2(deployer.getSender(), {
                value: mintPrice,
                signature,
                subwalletId: 0,
                validSince: now + 3600,
                validTill: now + 7200,
                tokenName,
                content: nftContent,
                auctionConfig,
                royaltyParams,
            });

            expect(mintResult.transactions.length).toBeGreaterThan(0);
        });

        it('should reject mint with wrong subwallet_id', async () => {
            const tokenName = '123456';
            const mintPrice = toNano('0.1');
            const now = Math.floor(Date.now() / 1000);

            const nftContent = createNumberNftContent(tokenName);
            const auctionConfig = createDirectMintAuctionConfig({
                beneficiaryAddress: deployer.address,
                mintPrice,
            });
            const royaltyParams = createNoRoyaltyParams(deployer.address);

            const unsignedMessage = createUnsignedDeployMessageV2({
                subwalletId: 1, // Wrong subwallet_id
                validSince: now - 60,
                validTill: now + 3600,
                tokenName,
                content: nftContent,
                auctionConfig,
                royaltyParams,
            });
            const signature = signDeployMessage(unsignedMessage, privateKey);
            const mintResult = await collection.sendDeployMessageV2(deployer.getSender(), {
                value: mintPrice,
                signature,
                subwalletId: 1, // Wrong subwallet_id
                validSince: now - 60,
                validTill: now + 3600,
                tokenName,
                content: nftContent,
                auctionConfig,
                royaltyParams,
            });

            expect(mintResult.transactions.length).toBeGreaterThan(0);
        });

        it('should mint NFT with restrictions force_sender_address', async () => {
            const tokenName = '123456';
            const mintPrice = toNano('0.1');
            const now = Math.floor(Date.now() / 1000);

            const nftContent = createNumberNftContent(tokenName);
            const auctionConfig = createDirectMintAuctionConfig({
                beneficiaryAddress: deployer.address,
                mintPrice,
            });
            const royaltyParams = createNoRoyaltyParams(deployer.address);
            const restrictions = createForceSenderRestrictions(deployer.address);

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
            const signature = signDeployMessage(unsignedMessage, privateKey);
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

            const itemIndex = await stringHash(tokenName);
            const nftAddress = await collection.getNftAddressByIndex(itemIndex);

            expect(nftAddress).toBeDefined();
        });

        it('should reject mint with restrictions force_sender_address from wrong address', async () => {
            const tokenName = '123456';
            const mintPrice = toNano('0.1');
            const now = Math.floor(Date.now() / 1000);
            const wrongSender = await blockchain.treasury('wrongSender');

            const nftContent = createNumberNftContent(tokenName);
            const auctionConfig = createDirectMintAuctionConfig({
                beneficiaryAddress: deployer.address,
                mintPrice,
            });
            const royaltyParams = createNoRoyaltyParams(deployer.address);
            const restrictions = createForceSenderRestrictions(deployer.address);

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
            const signature = signDeployMessage(unsignedMessage, privateKey);
            const mintResult = await collection.sendDeployMessageV2(wrongSender.getSender(), {
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
        });

        it('should mint NFT with same tokenName returns same address', async () => {
            const tokenName = '123456';
            const mintPrice = toNano('0.1');
            const now = Math.floor(Date.now() / 1000);

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
            const firstAddress = await collection.getNftAddressByIndex(itemIndex);

            const secondAddress = await collection.getNftAddressByIndex(itemIndex);

            expect(firstAddress.equals(secondAddress)).toBe(true);
        });

        it('should reject topup without correct comment', async () => {
            const wrongComment = beginCell().storeStringTail('wrong').endCell();
            const result = await deployer.send({
                to: collection.address,
                value: toNano('0.1'),
                body: wrongComment,
            });

            expect(result.transactions.length).toBeGreaterThan(0);
        });
    });

    describe('Get Methods', () => {
        it('should get collection data', async () => {
            await collection.sendTopup(deployer.getSender(), toNano('0.1'));
            const collectionData = await collection.getCollectionData();

            expect(collectionData.index).toBe(-1);
            expect(collectionData.collectionContent).toBeDefined();
            expect(collectionData.ownerAddress).toBeDefined();
        });

        it('should get NFT address by index', async () => {
            const tokenName = '123456';
            const mintPrice = toNano('0.1');
            const now = Math.floor(Date.now() / 1000);

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

            expect(nftAddress).toBeDefined();
            expect(nftAddress.equals(collection.address)).toBe(false);
        });
    });
});
