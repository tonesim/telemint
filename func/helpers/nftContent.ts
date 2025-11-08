import { beginCell, Cell, Slice } from '@ton/core';

export type NftContentParams = {
    name?: string;
    description?: string;
    image?: string;
    [key: string]: any; // Дополнительные поля
};

/**
 * Создает NFT контент в формате on-chain (JSON в Cell)
 */
export function createNftContent(params: NftContentParams): Cell {
    const content = {
        name: params.name || '',
        description: params.description || '',
        image: params.image || '',
        ...params,
    };

    // Сериализуем JSON в Cell
    const jsonString = JSON.stringify(content);
    return beginCell()
        .storeUint(0, 8) // off-chain content tag
        .storeStringTail(jsonString)
        .endCell();
}

export function createNumberNftContent(number: string, metadata?: Record<string, any>): Cell {
    return createNftContent({
        name: `Number ${number}`,
        description: `Telegram number ${number}`,
        number,
        ...metadata,
    });
}

export function parseNftContent(cell: Cell): NftContentParams {
    const slice = cell.beginParse();

    // Читаем tag (первый байт)
    const tag = slice.loadUint(8);

    // Если tag = 0, это off-chain content (JSON строка)
    if (tag === 0) {
        // Читаем строку (JSON)
        const jsonString = slice.loadStringTail();

        try {
            return JSON.parse(jsonString);
        } catch (e) {
            throw new Error(`Failed to parse NFT content JSON: ${e}`);
        }
    } else {
        // Для других типов контента (on-chain) нужна другая логика
        throw new Error(`Unsupported NFT content tag: ${tag}`);
    }
}

