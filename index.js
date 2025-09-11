const axios = require('axios');
const CryptoJS = require('crypto-js');

// ==========================
// ГЛОБАЛЬНОЕ СОСТОЯНИЕ
// ==========================
let globalState = {
  balance: 100,           // демо-баланс
  realBalance: null,      // реальный баланс (получаем с BingX)
  positions: {},
  history: [],
  stats: {
    totalTrades: 0,
    profitableTrades: 0,
    losingTrades: 0,
    winRate: 0,
    totalProfit: 0,
    maxDrawdown: 0,
    peakBalance: 100,
    maxLeverageUsed: 1
  },
  marketMemory: {
    lastTrades: {},
    consecutiveTrades: {},
    volatilityHistory: {},
    fearSentimentHistory: []
  },
  isRunning: true,
  takerFee: 0.0005,
  maxRiskPerTrade: 0.01,  // 1% от депозита — СТАБИЛЬНЫЙ РЕЖИМ
  maxLeverage: 3,         // 3x плечо — СТАБИЛЬНЫЙ РЕЖИМ
  watchlist: [
    { symbol: 'BTC', name: 'bitcoin' },
    { symbol: 'ETH', name: 'ethereum' },
    { symbol: 'BNB', name: 'binancecoin' },
    { symbol: 'SOL', name: 'solana' },
    { symbol: 'XRP', name: 'ripple' },
    { symbol: 'DOGE', name: 'dogecoin' },
    { symbol: 'ADA', name: 'cardano' },
    { symbol: 'DOT', name: 'polkadot' },
    { symbol: 'LINK', name: 'chainlink' }
  ],
  isRealMode: false,      // false = демо, true = реальный
  tradeMode: 'stable',    // 'stable' или 'scalping'
  testMode: false         // временно увеличивает риск для теста
};

globalState.watchlist.forEach(coin => {
  globalState.positions[coin.name] = null;
  globalState.marketMemory.lastTrades[coin.name] = [];
  globalState.marketMemory.consecutiveTrades[coin.name] = 0;
  globalState.marketMemory.volatilityHistory[coin.name] = [];
});

// ==========================
// КОНФИГУРАЦИЯ BINGX API
// ==========================
const BINGX_API_KEY = process.env.BINGX_API_KEY;
const BINGX_SECRET_KEY = process.env.BINGX_SECRET_KEY;
const BINGX_FUTURES_URL = 'https://open-api.bingx.com';

// ==========================
// ФУНКЦИЯ: Подпись запроса для BingX
// ==========================
function signBingXRequest(params) {
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');
  return CryptoJS.HmacSHA256(sortedParams, BINGX_SECRET_KEY).toString(CryptoJS.enc.Hex);
}

// ==========================
// ФУНКЦИЯ: Получение реального баланса с BingX Futures — С ДЕТАЛЬНЫМ ЛОГИРОВАНИЕМ
// ==========================
async function getBingXRealBalance() {
  try {
    console.log('🔍 [БАЛАНС] Начинаю запрос реального баланса...');
    
    if (!BINGX_API_KEY || !BINGX_SECRET_KEY) {
      console.error('❌ [БАЛАНС] API-ключи не заданы в переменных окружения');
      return null;
    }

    const timestamp = Date.now();
    const params = { timestamp };
    const signature = signBingXRequest(params);
    const url = `${BINGX_FUTURES_URL}/openApi/swap/v2/user/balance?${new URLSearchParams(params)}&signature=${signature}`;

    console.log('🌐 [БАЛАНС] Отправляю запрос к:', url);

    const response = await axios.get(url, {
      headers: { 'X-BX-APIKEY': BINGX_API_KEY },
      timeout: 10000
    });

    console.log('✅ [БАЛАНС] Получен ответ от BingX:', response.data);

    if (response.data.code === 0 && response.data.data) {
      const assets = response.data.data.assets || response.data.data;
      const assetsArray = Array.isArray(assets) ? assets : Object.values(assets);
      const usdtAsset = assetsArray.find(asset => asset.asset === 'USDT');
      
      if (usdtAsset && usdtAsset.walletBalance) {
        const balance = parseFloat(usdtAsset.walletBalance);
        console.log(`💰 [БАЛАНС] Успешно получен реальный баланс: $${balance.toFixed(2)}`);
        return balance;
      } else {
        console.error('❌ [БАЛАНС] Не найден баланс USDT в ответе');
      }
    } else {
      console.error('❌ [БАЛАНС] Ошибка в ответе от BingX:', response.data.msg || 'Неизвестная ошибка');
    }
    return null;
  } catch (error) {
    console.error('❌ [БАЛАНС] КРИТИЧЕСКАЯ ОШИБКА получения реального баланса:', error.message);
    return null;
  }
}

// ==========================
// ФУНКЦИЯ: Принудительное обновление реального баланса
// ==========================
async function forceUpdateRealBalance() {
  console.log('🔄 [БАЛАНС] Принудительное обновление реального баланса...');
  const balance = await getBingXRealBalance();
  if (balance !== null) {
    globalState.realBalance = balance;
    console.log(`✅ [БАЛАНС] Баланс обновлён: $${balance.toFixed(2)}`);
  }
  return balance;
}

// ==========================
// ФУНКЦИЯ: Пополнение баланса (для демо)
// ==========================
function deposit(amount) {
  if (amount <= 0) return false;
  globalState.balance += amount;
  console.log(`✅ Баланс пополнен на $${amount}. Текущий баланс: $${globalState.balance.toFixed(2)}`);
  return true;
}

// ==========================
// ФУНКЦИЯ: Переключение режима (ДЕМО ↔ РЕАЛЬНЫЙ)
// ==========================
function toggleMode() {
  globalState.isRealMode = !globalState.isRealMode;
  console.log(`🔄 Режим переключён на: ${globalState.isRealMode ? 'РЕАЛЬНЫЙ' : 'ДЕМО'}`);
  
  // При переключении на реальный режим — обновляем баланс
  if (globalState.isRealMode) {
    forceUpdateRealBalance();
  }
  
  return globalState.isRealMode;
}

// ==========================
// ФУНКЦИЯ: Переключение торгового режима (stable ↔ scalping)
// ==========================
function toggleTradeMode() {
  globalState.tradeMode = globalState.tradeMode === 'stable' ? 'scalping' : 'stable';
  
  if (globalState.tradeMode === 'stable') {
    globalState.maxRiskPerTrade = 0.01;
    globalState.maxLeverage = 3;
    console.log('📉 Переключён на СТАБИЛЬНЫЙ режим: риск 1%, плечо 3x');
  } else {
    globalState.maxRiskPerTrade = 0.02;
    globalState.maxLeverage = 5;
    console.log('⚡ Переключён на СКАЛЬПИНГ: риск 2%, плечо 5x (ВЫСОКИЙ РИСК!)');
  }
  
  return globalState.tradeMode;
}

// ==========================
// ФУНКЦИЯ: Включение тестового режима (временно увеличивает риск)
// ==========================
function toggleTestMode() {
  globalState.testMode = !globalState.testMode;
  
  if (globalState.testMode) {
    globalState.maxRiskPerTrade = 0.05;
    globalState.maxLeverage = 10;
    console.log('🧪 ВКЛЮЧЁН ТЕСТОВЫЙ РЕЖИМ: риск 5%, плечо 10x (ЭКСТРЕМАЛЬНЫЙ РИСК!)');
  } else {
    // Возвращаем настройки в зависимости от tradeMode
    if (globalState.tradeMode === 'stable') {
      globalState.maxRiskPerTrade = 0.01;
      globalState.maxLeverage = 3;
    } else {
      globalState.maxRiskPerTrade = 0.02;
      globalState.maxLeverage = 5;
    }
    console.log('✅ ТЕСТОВЫЙ РЕЖИМ ВЫКЛЮЧЕН');
  }
  
  return globalState.testMode;
}

// ... остальные функции (getFearAndGreedIndex, getCurrentFuturesPrices, getBingXFuturesHistory, analyzeFuturesWithWisdom, calculateATR, calculateRSI, setBingXLeverage, placeBingXFuturesOrder) остаются без изменений

// ==========================
// ФУНКЦИЯ: Открытие фьючерсной позиции (ДЕМО или РЕАЛЬНАЯ)
// ==========================
async function openFuturesTrade(coin, direction, leverage, size, price, stopLoss, takeProfit) {
  const symbolMap = {
    'bitcoin': 'BTC-USDT',
    'ethereum': 'ETH-USDT',
    'binancecoin': 'BNB-USDT',
    'solana': 'SOL-USDT',
    'ripple': 'XRP-USDT',
    'dogecoin': 'DOGE-USDT',
    'cardano': 'ADA-USDT',
    'polkadot': 'DOT-USDT',
    'chainlink': 'LINK-USDT'
  };

  const symbol = symbolMap[coin];
  if (!symbol) {
    console.error(`❌ Неизвестный символ для ${coin}`);
    return false;
  }

  const side = direction === 'LONG' ? 'BUY' : 'SELL';
  const positionSide = direction;

  console.log(`🌐 Отправка ${direction} ордера на BingX Futures: ${size} ${symbol} с плечом ${leverage}x`);
  console.log(`🔄 Текущий режим: ${globalState.isRealMode ? 'РЕАЛЬНЫЙ' : 'ДЕМО'}`);
  console.log(`⚡ Торговый режим: ${globalState.tradeMode} (${globalState.testMode ? 'ТЕСТОВЫЙ РЕЖИМ ВКЛЮЧЕН' : 'нормальный'})`);

  if (globalState.isRealMode) {
    // Реальная торговля
    const result = await placeBingXFuturesOrder(symbol, side, positionSide, 'MARKET', size, null, leverage);

    if (result) {
      const trade = {
        coin,
        type: direction,
        size,
        entryPrice: price,
        currentPrice: price, // добавим текущую цену для интерфейса
        leverage,
        stopLoss,
        takeProfit,
        fee: 0,
        timestamp: new Date().toLocaleString(),
        status: 'OPEN',
        orderId: result.orderId,
        progress: 0, // для визуализации в интерфейсе
        probability: 50 // для визуализации в интерфейсе
      };

      globalState.history.push(trade);
      globalState.positions[coin] = {
        ...trade,
        trailingStop: price * (direction === 'LONG' ? 0.99 : 1.01)
      };

      globalState.stats.totalTrades++;
      globalState.marketMemory.consecutiveTrades[coin] = (globalState.marketMemory.consecutiveTrades[coin] || 0) + 1;
      globalState.stats.maxLeverageUsed = Math.max(globalState.stats.maxLeverageUsed, leverage);

      console.log(`✅ УСПЕШНО: ${direction} ${size} ${coin} на BingX Futures`);
      return true;
    } else {
      console.log(`❌ Не удалось выполнить ордер на BingX Futures`);
      return false;
    }
  } else {
    // Демо-торговля
    const cost = (size * price) / leverage;
    const fee = size * price * globalState.takerFee;

    if (cost + fee > globalState.balance * globalState.maxRiskPerTrade) {
      console.log(`❌ Риск превышает ${globalState.maxRiskPerTrade * 100}% от депозита`);
      return false;
    }

    globalState.balance -= fee;
    const trade = {
      coin,
      type: direction,
      size,
      entryPrice: price,
      currentPrice: price,
      leverage,
      stopLoss,
      takeProfit,
      fee,
      timestamp: new Date().toLocaleString(),
      status: 'OPEN',
      progress: 0,
      probability: 50
    };

    globalState.history.push(trade);
    globalState.positions[coin] = {
      ...trade,
      trailingStop: price * (direction === 'LONG' ? 0.99 : 1.01)
    };

    globalState.stats.totalTrades++;
    globalState.marketMemory.consecutiveTrades[coin] = (globalState.marketMemory.consecutiveTrades[coin] || 0) + 1;
    globalState.stats.maxLeverageUsed = Math.max(globalState.stats.maxLeverageUsed, leverage);

    console.log(`✅ ДЕМО: ${direction} ${size} ${coin} с плечом ${leverage}x`);
    return true;
  }
}

// ... остальные функции (checkOpenPositions, showOpenPositionsProgress, printStats, sendPushNotification) остаются без изменений

// ==========================
// ГЛАВНАЯ ФУНКЦИЯ — ЦИКЛ БОТА
// ==========================
(async () => {
  console.log('🤖 ЗАПУСК БОТА v14.0 — ТРЕЙДИНГ БОТ ВАСЯ 3000 УНИКАЛЬНЫЙ');
  console.log('📌 deposit(сумма) — пополнить демо-баланс');
  console.log('🔄 toggleMode() — переключить режим (ДЕМО ↔ РЕАЛЬНЫЙ)');
  console.log('⚡ toggleTradeMode() — переключить торговый режим (stable ↔ scalping)');
  console.log('🧪 toggleTestMode() — включить тестовый режим (риск 5%, плечо 10x)');

  // Принудительно обновляем реальный баланс при старте
  await forceUpdateRealBalance();

  while (globalState.isRunning) {
    try {
      console.log(`\n[${new Date().toLocaleTimeString()}] === АНАЛИЗ ОТ ВАСИ 3000 ===`);

      const fearIndex = await getFearAndGreedIndex();
      console.log(`😱 Индекс страха и жадности: ${fearIndex}`);

      // Обновляем реальный баланс каждые 5 минут
      if (Date.now() % 300000 < 10000) {
        await forceUpdateRealBalance();
      }

      const currentPrices = await getCurrentFuturesPrices();
      await checkOpenPositions(currentPrices);

      showOpenPositionsProgress(currentPrices);

      let bestOpportunity = null;
      let bestReasoning = [];

      for (const coin of globalState.watchlist) {
        console.log(`\n🔍 Анализирую фьючерс ${coin.name}...`);

        const candles = await getBingXFuturesHistory(coin.name, '1h', 50);
        if (candles.length < 10) {
          console.log(`   ⚠️ Пропускаем ${coin.name} — недостаточно данных`);
          await new Promise(r => setTimeout(r, 1200));
          continue;
        }

        const analysis = analyzeFuturesWithWisdom(candles, coin.name, fearIndex);
        if (!analysis || !analysis.signal.direction) {
          await new Promise(r => setTimeout(r, 1200));
          continue;
        }

        console.log(`   ✅ Сигнал для ${coin.name}: ${analysis.signal.direction}`);
        analysis.signal.reasoning.forEach(r => console.log(`   • ${r}`));

        if (!bestOpportunity) {
          bestOpportunity = analysis;
          bestReasoning = analysis.signal.reasoning;
        }

        await new Promise(r => setTimeout(r, 1200));
      }

      if (bestOpportunity && (globalState.isRealMode || globalState.balance > 10)) {
        console.log(`\n💎 ВАСЯ 3000 РЕКОМЕНДУЕТ: ${bestOpportunity.signal.direction} по ${bestOpportunity.coin}`);
        bestReasoning.forEach(r => console.log(`   • ${r}`));

        // Используем реальный баланс в реальном режиме, демо — в демо
        const currentBalance = globalState.isRealMode ? (globalState.realBalance || 100) : globalState.balance;
        const riskAmount = currentBalance * globalState.maxRiskPerTrade;
        const price = bestOpportunity.currentPrice;
        const stopDistance = bestOpportunity.signal.direction === 'LONG' 
          ? price - bestOpportunity.signal.stopLoss 
          : bestOpportunity.signal.stopLoss - price;
        
        const size = riskAmount / stopDistance;
        const finalSize = Math.max(0.001, size);

        console.log(`\n🟢 ВХОД: ${bestOpportunity.signal.direction} ${finalSize.toFixed(6)} ${bestOpportunity.coin} с плечом ${bestOpportunity.signal.leverage}x`);
        await openFuturesTrade(
          bestOpportunity.coin,
          bestOpportunity.signal.direction,
          bestOpportunity.signal.leverage,
          finalSize,
          bestOpportunity.currentPrice,
          bestOpportunity.signal.stopLoss,
          bestOpportunity.signal.takeProfit
        );
      } else {
        console.log(`\n⚪ Вася 3000 не видит возможностей — отдыхаем...`);
      }

      // Обновляем статистику (для демо-режима)
      if (!globalState.isRealMode) {
        globalState.stats.totalProfit = globalState.balance - 100;
        if (globalState.balance > globalState.stats.peakBalance) {
          globalState.stats.peakBalance = globalState.balance;
        }
        globalState.stats.maxDrawdown = ((globalState.stats.peakBalance - globalState.balance) / globalState.stats.peakBalance) * 100;
      }

      globalState.stats.winRate = globalState.stats.totalTrades > 0
        ? (globalState.stats.profitableTrades / globalState.stats.totalTrades) * 100
        : 0;

      if (Date.now() % 60000 < 10000) {
        console.log(`\n💰 ${globalState.isRealMode ? 'Реальный' : 'Демо'}-баланс: $${(globalState.isRealMode ? globalState.realBalance : globalState.balance)?.toFixed(2) || 'Загрузка...'}`);
      }

      if (globalState.stats.totalTrades > 0 && globalState.history.length % 2 === 0) {
        printStats();
      }

    } catch (error) {
      console.error('💥 КРИТИЧЕСКАЯ ОШИБКА В ЦИКЛЕ:', error.message);
    }

    console.log(`\n💤 Ждём 60 секунд до следующего анализа...`);
    await new Promise(r => setTimeout(r, 60000));
  }
})();

// ✅ ЭКСПОРТ ФУНКЦИЙ
module.exports = {
  globalState,
  deposit,
  toggleMode,
  toggleTradeMode,
  toggleTestMode,
  forceUpdateRealBalance, // для ручного обновления баланса
  balance: () => globalState.balance,
  stats: () => globalState.stats,
  history: () => globalState.history
};

global.deposit = deposit;
global.toggleMode = toggleMode;
global.toggleTradeMode = toggleTradeMode;
global.toggleTestMode = toggleTestMode;
global.forceUpdateRealBalance = forceUpdateRealBalance;
global.balance = () => globalState.balance;
global.stats = () => globalState.stats;
global.history = () => globalState.history;

console.log('\n✅ Трейдинг Бот Вася 3000 Уникальный запущен!');
console.log('Используй toggleMode() для переключения между ДЕМО и РЕАЛЬНЫМ режимом.');
console.log('Используй toggleTradeMode() для переключения между стабильным и скальпинг режимами.');
console.log('Используй toggleTestMode() для временного увеличения риска (только для теста!).');
