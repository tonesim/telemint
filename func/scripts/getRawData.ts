import 'dotenv/config';
import { Address } from '@ton/core';

async function getRawData() {
    const collectionAddressStr = process.env.COLLECTION_ADDRESS;
    if (!collectionAddressStr) {
        throw new Error('COLLECTION_ADDRESS environment variable is required');
    }
    
    const collectionAddress = Address.parse(collectionAddressStr);
    
    const isMainnet = process.env.NETWORK !== 'testnet';
    const apiKey = process.env.API_KEY;
    
    if (!apiKey) {
        throw new Error('API_KEY environment variable is required');
    }
    
    const endpoint = process.env.TON_ENDPOINT || (
        isMainnet
            ? 'https://toncenter.com/api/v2/jsonRPC'
            : 'https://testnet.toncenter.com/api/v2/jsonRPC'
    );
    
    console.log('\n=== Getting Raw Contract Data ===\n');
    console.log('Collection Address:', collectionAddress.toString());
    console.log('');
    
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                id: 1,
                jsonrpc: '2.0',
                method: 'getAddressInformation',
                params: {
                    address: collectionAddress.toString(),
                },
            }),
        });
        
        const result = await response.json() as any;
        
        if (result.error) {
            throw new Error(result.error.message || JSON.stringify(result.error));
        }
        
        const info = result.result;
        
        console.log('State:', info.state);
        console.log('Balance:', info.balance);
        console.log('Code:', info.code ? 'Present (' + info.code.length + ' chars)' : 'NULL');
        console.log('Data:', info.data ? 'Present (' + info.data.length + ' chars)' : 'NULL');
        console.log('');
        
        if (info.data) {
            console.log('Data (first 200 chars):', info.data.substring(0, 200));
        }
        
    } catch (error: any) {
        console.error('Error:', error.message);
    }
}

getRawData()
    .catch((error) => {
        console.error('Error:', error);
        process.exit(1);
    });

