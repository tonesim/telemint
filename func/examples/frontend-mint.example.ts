/**
 * Frontend code example for sending mint transaction
 * 
 * This file shows how to send signed message
 * to contract for minting NFT number
 */

import { Address, Cell, fromNano, internal } from '@ton/core';
import { TonClient, WalletContractV4 } from '@ton/ton';
import { mnemonicToWalletKey } from '@ton/crypto';

// Configuration
const BACKEND_API_URL = 'https://your-backend.com/api';
const COLLECTION_ADDRESS = Address.parse('YOUR_COLLECTION_ADDRESS');
const TON_API_KEY = 'YOUR_TON_API_KEY'; // For mainnet/testnet

/**
 * Backend response types
 */
type PrepareMintResponse = {
    unsignedMessage: string; // base64 encoded Cell
    signature: string; // hex encoded signature
    signedMessage: string; // base64 encoded Cell
    tokenName: string;
    mintPrice: string;
    validTill: number;
};

/**
 * Step 1: Get signed message from backend
 */
async function prepareMint(userAddress: string): Promise<PrepareMintResponse> {
    const response = await fetch(`${BACKEND_API_URL}/mint/prepare`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userAddress }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to prepare mint');
    }

    return response.json();
}

/**
 * Step 2: Send transaction to blockchain
 */
async function sendMintTransaction(
    signedMessageBase64: string,
    mintPrice: string,
    walletContract: WalletContractV4,
    client: TonClient,
    secretKey: Buffer
): Promise<string> {
    // Parse signed message (from base64)
    const signedMessage = Cell.fromBase64(signedMessageBase64);

    // Open wallet
    const wallet = client.open(walletContract);

    // Send transaction through wallet
    const seqno = await wallet.getSeqno();
    
    // Create message to send
    await wallet.sendTransfer({
        secretKey: secretKey,
        seqno,
        messages: [internal({
            to: COLLECTION_ADDRESS,
            value: BigInt(mintPrice),
            body: signedMessage,
        })],
    });

    // Wait for transaction confirmation
    let currentSeqno = await wallet.getSeqno();
    while (currentSeqno === seqno) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        currentSeqno = await wallet.getSeqno();
    }

    // In real app here should get transaction hash
    // from last wallet transaction
    return 'tx_hash_here';
}

/**
 * Step 3: Confirm successful mint on backend
 */
async function confirmMint(tokenName: string, txHash: string): Promise<void> {
    await fetch(`${BACKEND_API_URL}/mint/confirm`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tokenName, txHash }),
    });
}

/**
 * Complete number minting flow
 */
export async function mintNumber(
    userMnemonic: string[],
    userAddress: string
): Promise<{ tokenName: string; txHash: string }> {
    // 1. Initialize client and wallet
    const client = new TonClient({
        endpoint: `https://toncenter.com/api/v2/jsonRPC?api_key=${TON_API_KEY}`,
    });

    const key = await mnemonicToWalletKey(userMnemonic);
    const walletContract = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 });
    const wallet = client.open(walletContract);

    // 2. Get signed message from backend
    console.log('Step 1: Preparing mint message...');
    const prepareResult = await prepareMint(userAddress);
    console.log(`Got number: ${prepareResult.tokenName}`);
    console.log(`Mint price: ${fromNano(prepareResult.mintPrice)} TON`);

    // 3. Check wallet balance
    const balance = await wallet.getBalance();
    if (balance < BigInt(prepareResult.mintPrice)) {
        throw new Error(`Insufficient balance. Need ${fromNano(prepareResult.mintPrice)} TON`);
    }

    // 4. Send transaction
    console.log('Step 2: Sending mint transaction...');
    const txHash = await sendMintTransaction(
        prepareResult.signedMessage,
        prepareResult.mintPrice,
        walletContract,
        client,
        key.secretKey
    );
    console.log(`Transaction sent: ${txHash}`);

    // 5. Confirm mint on backend
    console.log('Step 3: Confirming mint...');
    await confirmMint(prepareResult.tokenName, txHash);
    console.log('Mint confirmed!');

    return {
        tokenName: prepareResult.tokenName,
        txHash,
    };
}

/**
 * Usage example in React component:
 * 
 * import { useState } from 'react';
 * 
 * function MintButton() {
 *   const [loading, setLoading] = useState(false);
 *   const [result, setResult] = useState<string | null>(null);
 * 
 *   const handleMint = async () => {
 *     setLoading(true);
 *     try {
 *       const userMnemonic = getStoredMnemonic(); // Get from secure storage
 *       const userAddress = getWalletAddress(); // User wallet address
 *       
 *       const result = await mintNumber(userMnemonic, userAddress);
 *       setResult(`Successfully minted number ${result.tokenName}!`);
 *     } catch (error) {
 *       setResult(`Error: ${error.message}`);
 *     } finally {
 *       setLoading(false);
 *     }
 *   };
 * 
 *   return (
 *     <div>
 *       <button onClick={handleMint} disabled={loading}>
 *         {loading ? 'Minting...' : 'Get Number'}
 *       </button>
 *       {result && <p>{result}</p>}
 *     </div>
 *   );
 * }
 */

