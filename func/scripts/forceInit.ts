import 'dotenv/config';
import { Address, beginCell, storeMessage, external } from '@ton/core';
import { mnemonicToWalletKey } from '@ton/crypto';
import { compile } from '@ton/blueprint';
import { NftCollectionNoDns, NftCollectionNoDnsConfig } from '../wrappers/NftCollectionNoDns';
import { createNoRoyaltyParams } from '../helpers/royaltyParams';

async function forceInit() {
    const mnemonic = process.env.MNEMONIC;
    if (!mnemonic) {
        throw new Error('MNEMONIC required');
    }

    const collectionAddressStr = process.env.COLLECTION_ADDRESS;
    if (!collectionAddressStr) {
        throw new Error('COLLECTION_ADDRESS required');
    }
    
    const collectionAddress = Address.parse(collectionAddressStr);
    const apiKey = process.env.API_KEY!;
    const isMainnet = process.env.NETWORK !== 'testnet';
    const endpoint = isMainnet
        ? 'https://toncenter.com/api/v2/jsonRPC'
        : 'https://testnet.toncenter.com/api/v2/jsonRPC';

    const key = await mnemonicToWalletKey(mnemonic.split(' '));
    const publicKey = BigInt('0x' + key.publicKey.toString('hex'));
    const subwalletId = parseInt(process.env.SUBWALLET_ID || '0');

    console.log('\n=== Force Initialize Contract ===\n');
    console.log('Collection:', collectionAddress.toString());
    console.log('Subwallet ID:', subwalletId);
    console.log('');

    // Compile and create expected config
    const collectionCode = await compile('NftCollectionNoDns');
    const itemCode = await compile('NftItemNoDnsCheap');
    
    const config: NftCollectionNoDnsConfig = {
        touched: false,
        subwalletId,
        publicKey,
        collectionContent: beginCell().storeStringTail('telemint').endCell(),
        nftItemCode: itemCode,
        fullDomain: 'telemint.ton',
        royaltyParams: createNoRoyaltyParams(Address.parse('EQCgSOFgNrUF3ynr_-TppXlFPAcWSG3OlDHG2LvdgwHk2M1S')),
    };
    
    const collection = NftCollectionNoDns.createFromConfig(config, collectionCode);
    
    if (!collectionAddress.equals(collection.address)) {
        console.log('⚠️  WARNING: Computed address does not match!');
        console.log('   Expected:', collectionAddress.toString());
        console.log('   Computed:', collection.address.toString());
        console.log('   This means config or code is different!');
        console.log('');
    }

    // Create external message
    const externalMsg = external({
        to: collectionAddress,
        body: beginCell().endCell(),
    });

    const boc = beginCell()
        .store(storeMessage(externalMsg))
        .endCell()
        .toBoc()
        .toString('base64');

    console.log('Sending external message...');

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            id: 1,
            jsonrpc: '2.0',
            method: 'sendBocReturnHash',
            params: {
                boc,
            },
        }),
    });

    const result = await response.json() as any;

    if (result.error) {
        console.error('✗ Error:', result.error.message || JSON.stringify(result.error));
        console.log('');
        console.log('External message was rejected by the contract.');
        console.log('This is expected if contract is already initialized.');
        console.log('');
        return false;
    }

    console.log('✓ External message sent!');
    console.log('  Hash:', result.result?.hash || result.result);
    return true;
}

forceInit()
    .then((sent) => {
        if (sent) {
            console.log('');
            console.log('Wait 10 seconds and check: npm run verify');
        }
        process.exit(0);
    })
    .catch((error) => {
        console.error('Error:', error);
        process.exit(1);
    });

