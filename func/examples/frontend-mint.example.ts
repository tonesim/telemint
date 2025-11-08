/**
 * Пример фронтенд кода для отправки транзакции минта
 * 
 * Этот файл показывает, как отправить подписанное сообщение
 * в контракт для минта NFT номера
 */

import { Address, Cell, fromNano, internal } from '@ton/core';
import { TonClient, WalletContractV4 } from '@ton/ton';
import { mnemonicToWalletKey } from '@ton/crypto';

// Конфигурация
const BACKEND_API_URL = 'https://your-backend.com/api';
const COLLECTION_ADDRESS = Address.parse('YOUR_COLLECTION_ADDRESS');
const TON_API_KEY = 'YOUR_TON_API_KEY'; // Для mainnet/testnet

/**
 * Типы ответов от бэкенда
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
 * Шаг 1: Получение подписанного сообщения от бэкенда
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
 * Шаг 2: Отправка транзакции в блокчейн
 */
async function sendMintTransaction(
    signedMessageBase64: string,
    mintPrice: string,
    walletContract: WalletContractV4,
    client: TonClient,
    secretKey: Buffer
): Promise<string> {
    // Парсим подписанное сообщение (из base64)
    const signedMessage = Cell.fromBase64(signedMessageBase64);

    // Открываем кошелек
    const wallet = client.open(walletContract);

    // Отправляем транзакцию через кошелек
    const seqno = await wallet.getSeqno();
    
    // Создаем сообщение для отправки
    await wallet.sendTransfer({
        secretKey: secretKey,
        seqno,
        messages: [internal({
            to: COLLECTION_ADDRESS,
            value: BigInt(mintPrice),
            body: signedMessage,
        })],
    });

    // Ждем подтверждения транзакции
    let currentSeqno = await wallet.getSeqno();
    while (currentSeqno === seqno) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        currentSeqno = await wallet.getSeqno();
    }

    // В реальном приложении здесь нужно получить hash транзакции
    // из последней транзакции кошелька
    return 'tx_hash_here';
}

/**
 * Шаг 3: Подтверждение успешного минта на бэкенде
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
 * Полный флоу минта номера
 */
export async function mintNumber(
    userMnemonic: string[],
    userAddress: string
): Promise<{ tokenName: string; txHash: string }> {
    // 1. Инициализация клиента и кошелька
    const client = new TonClient({
        endpoint: `https://toncenter.com/api/v2/jsonRPC?api_key=${TON_API_KEY}`,
    });

    const key = await mnemonicToWalletKey(userMnemonic);
    const walletContract = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 });
    const wallet = client.open(walletContract);

    // 2. Получаем подписанное сообщение от бэкенда
    console.log('Step 1: Preparing mint message...');
    const prepareResult = await prepareMint(userAddress);
    console.log(`Got number: ${prepareResult.tokenName}`);
    console.log(`Mint price: ${fromNano(prepareResult.mintPrice)} TON`);

    // 3. Проверяем баланс кошелька
    const balance = await wallet.getBalance();
    if (balance < BigInt(prepareResult.mintPrice)) {
        throw new Error(`Insufficient balance. Need ${fromNano(prepareResult.mintPrice)} TON`);
    }

    // 4. Отправляем транзакцию
    console.log('Step 2: Sending mint transaction...');
    const txHash = await sendMintTransaction(
        prepareResult.signedMessage,
        prepareResult.mintPrice,
        walletContract,
        client,
        key.secretKey
    );
    console.log(`Transaction sent: ${txHash}`);

    // 5. Подтверждаем минт на бэкенде
    console.log('Step 3: Confirming mint...');
    await confirmMint(prepareResult.tokenName, txHash);
    console.log('Mint confirmed!');

    return {
        tokenName: prepareResult.tokenName,
        txHash,
    };
}

/**
 * Пример использования в React компоненте:
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
 *       const userMnemonic = getStoredMnemonic(); // Получить из безопасного хранилища
 *       const userAddress = getWalletAddress(); // Адрес кошелька пользователя
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

