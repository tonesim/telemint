import { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = {
    lang: 'func',
    targets: [
        'contracts/imports/stdlib.fc',
        'contracts/imports/common.fc',
        'contracts/nft-item-no-dns-cheap-delayed.fc',
    ],
};

