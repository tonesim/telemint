# Telemint - Mint Numbers from Pool

Смарт-контракты для минта номеров из пула на блокчейне TON.

## Описание

Этот проект содержит упрощенную версию Telemint контрактов, оптимизированную для минта номеров из предопределенного пула. Используются контракты без DNS для экономии газа.

## Структура проекта

- `func/contracts/` - исходный код смарт-контрактов:
  - `nft-collection-no-dns.fc` - коллекция NFT без DNS
  - `nft-item-no-dns-cheap.fc` - дешевый NFT item (0.03 TON вместо 1 TON)
  - `imports/` - общие зависимости (common.fc, stdlib.fc)
- `func/wrappers/` - TypeScript обертки для контрактов:
  - `NftCollectionNoDns.ts` - обертка для коллекции
  - `NftItemNoDnsCheap.ts` - обертка для NFT item
- `func/helpers/` - helper функции для работы с контрактами:
  - `auctionConfig.ts` - создание конфигурации аукциона
  - `signMessage.ts` - создание и подпись сообщений
  - `nftContent.ts` - создание NFT контента
  - `royaltyParams.ts` - создание параметров роялти
  - `restrictions.ts` - создание ограничений на отправителя
- `func/examples/` - примеры использования:
  - `backend-api.example.ts` - пример бэкенд API
  - `frontend-mint.example.ts` - пример фронтенд кода
- `func/tests/` - тесты для контрактов (см. [документацию по тестам](./docs/tests.md))
- `docs/` - документация проекта:
  - [MINT_FLOW.md](./docs/MINT_FLOW.md) - подробное описание флоу минта
  - [tests.md](./docs/tests.md) - документация по тестам

## Используемые контракты

- **NftCollectionNoDns** - коллекция NFT без DNS. Используется для создания и управления NFT номерами.
- **NftItemNoDnsCheap** - дешевый NFT item без DNS. Требует только 0.03 TON для хранения (вместо 1 TON в стандартной версии).

**Важно:** Контракт активируется только после получения первого сообщения от коллекции (при минте). После активации можно получать данные через get-методы:

```typescript
const nftData = await nft.getNftData();
if (nftData.init && nftData.content) {
    const parsedContent = parseNftContent(nftData.content);
    // Используем parsedContent
}
```

Подробнее об активации контрактов см. в [MINT_FLOW.md](./docs/MINT_FLOW.md#активация-nft-item-контракта).

## Флоу минта

1. Пользователь заходит на бэкенд и нажимает "Получить номер"
2. Бэкенд генерирует доступный номер из пула
3. Бэкенд формирует пейлоад и подписывает сообщение
4. Пользователь получает подписанное сообщение
5. Пользователь отправляет транзакцию в блокчейн
6. Контракт минтит NFT и отправляет пользователю

Подробное описание флоу см. в [docs/MINT_FLOW.md](./docs/MINT_FLOW.md).

## Быстрый старт

### Установка зависимостей

```bash
cd func
npm install
```

### Сборка контрактов

```bash
npm run build
```

### Тестирование

```bash
npm test
```

Подробнее о тестах см. [документацию по тестам](./docs/tests.md).

### Примеры использования

Примеры кода находятся в `func/examples/`:
- `backend-api.example.ts` - как создать бэкенд API для генерации подписанных сообщений
- `frontend-mint.example.ts` - как отправить транзакцию минта с фронтенда

Подробное описание флоу см. в [docs/MINT_FLOW.md](./docs/MINT_FLOW.md).

## Документация

- [Флоу минта](./docs/MINT_FLOW.md) - подробное описание процесса минта номеров из пула
- [Тесты](./docs/tests.md) - описание тестов и покрытия функциональности

## Helper функции

Все helper функции экспортируются из `func/helpers/index.ts`:

```typescript
import {
    createDirectMintAuctionConfig,
    createNumberNftContent,
    createUnsignedDeployMessageV2,
    signDeployMessage,
    createSignedDeployMessageV2,
} from './helpers';
```

Подробнее см. документацию в файлах helper функций и [MINT_FLOW.md](./docs/MINT_FLOW.md#использование-helper-функций).

## Лицензия

См. [LICENSE](./LICENSE)
