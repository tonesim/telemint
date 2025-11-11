import 'dotenv/config';
import { mnemonicToWalletKey } from '@ton/crypto';

async function generateEnv() {
    const mnemonic = process.env.MNEMONIC;
    if (!mnemonic) {
        throw new Error('MNEMONIC environment variable is required');
    }

    const key = await mnemonicToWalletKey(mnemonic.split(' '));
    
    const privateKeyHex = key.secretKey.toString('hex');
    const publicKeyHex = key.publicKey.toString('hex');
    
    const collectionAddress = process.env.COLLECTION_ADDRESS || 'EQCeTZFtmvZIruJBIi4E0H1oh9w2zrcLDMVd_6bwVah2mPN4';
    const beneficiaryAddress = process.env.BENEFICIARY_ADDRESS || 'EQCgSOFgNrUF3ynr_-TppXlFPAcWSG3OlDHG2LvdgwHk2M1S';
    const subwalletId = process.env.SUBWALLET_ID || '0';
    const mintPrice = process.env.MINT_PRICE || '0.1';
    const signatureValidityWindow = process.env.SIGNATURE_VALIDITY_WINDOW || '3600';

    console.log('\n=== TELEMINT Environment Variables ===\n');
    console.log(`TELEMINT_COLLECTION_ADDRESS=${collectionAddress}`);
    console.log(`TELEMINT_COLLECTION_PRIVATE_KEY=${privateKeyHex}`);
    console.log(`TELEMINT_COLLECTION_PUBLIC_KEY=${publicKeyHex}`);
    console.log(`TELEMINT_COLLECTION_SUBWALLET_ID=${subwalletId}`);
    console.log(`TELEMINT_BENEFICIARY_ADDRESS=${beneficiaryAddress}`);
    console.log(`TELEMINT_MINT_PRICE=${mintPrice}`);
    console.log(`TELEMINT_SIGNATURE_VALIDITY_WINDOW=${signatureValidityWindow}`);
    console.log('\n=== Copy these to your .env file ===\n');
}

generateEnv()
    .then(() => {
        process.exit(0);
    })
    .catch((error) => {
        console.error('Error:', error);
        process.exit(1);
    });

