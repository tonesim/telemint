# Как проверить что всё хорошо после деплоя

## Быстрая проверка (1 команда)

```bash
cd func
npm run verify
```

Эта команда проверяет:
1. ✅ Контракт задеплоен и активен
2. ✅ Контракт имеет достаточный баланс
3. ✅ Все get-методы работают
4. ✅ (Опционально) Тестовый минтинг работает

---

## Успешный результат выглядит так:

```
=== Verifying Deployment ===

Network: mainnet
Collection Address: EQBDIcLkPanrY_yxBihYYCucy0NNyzgDntrwY7IDMVZNmmFN

1. Checking if collection is deployed...
✓ Collection is deployed and active

2. Checking collection balance...
✓ Collection balance: 0.5000 TON

3. Checking collection get-methods...
✓ All collection get-methods work correctly

4. Skipping test mint (set TEST_MINT=true to enable)

=== Verification Summary ===

✓ All checks passed! Deployment is verified.
```

---

## Что проверять вручную

### 1. Проверить контракт на explorer

Откройте: https://tonscan.org/address/YOUR_COLLECTION_ADDRESS

Убедитесь:
- ✅ Contract is active
- ✅ Balance > 0
- ✅ Есть транзакции

### 2. Проверить get-методы работают

```bash
npm run verify
```

### 3. Проверить минтинг работает

```bash
npm run init-and-mint
```

Должен создаться NFT:
```
✓ NFT minted successfully!
  Token Name: test-123456
  NFT Address: EQ...
```

### 4. Проверить созданный NFT

```bash
npm run check-nft <NFT_ADDRESS>
```

Должно показать:
```
✓ NFT is initialized!
  Token Name: test-123456
  Owner: EQ...
```

---

## Что делать если проверка не проходит

### Ошибка "Contract not initialized (exit_code: -13)"

**Причина:** Контракт требует инициализации через external message

**Решение:**
1. Используйте MyTonWallet (wallet.ton.org) для отправки первой транзакции
2. Отправьте 0.001-0.01 TON на адрес контракта
3. Подождите 10-20 секунд
4. Запустите `npm run verify` снова

### Ошибка "Collection get-methods failed (exit_code: 11)"

**Причина:** Неправильный формат `fullDomain` (пустая строка)

**Решение:** Контракт нужно передеплоить с правильным `fullDomain`

### Ошибка "Contract not found or has zero balance"

**Причина:** Контракт не задеплоен или транзакция не подтверждена

**Решение:**
1. Проверьте explorer
2. Подождите дольше (mainnet может быть медленным)
3. Передеплойте: `npm run deploy`

---

## Детальная диагностика

```bash
npm run check-state     # Проверить состояние контракта (active/uninitialized)
npm run check-wallet    # Проверить баланс кошелька
npm run get-raw-data    # Посмотреть raw данные контракта
```

---

## Текущий статус вашего контракта

**Адрес:** `EQBDIcLkPanrY_yxBihYYCucy0NNyzgDntrwY7IDMVZNmmFN`
**Статус:** Active (задеплоен с правильными данными)
**Проблема:** Требует инициализации через external message

**Следующий шаг:** Отправьте транзакцию через MyTonWallet (wallet.ton.org) на адрес контракта для инициализации.

После инициализации все проверки должны пройти успешно! ✅

