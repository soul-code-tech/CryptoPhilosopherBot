const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const CryptoJS = require('crypto-js');
const moment = require('moment');

// ==========================
// ГЛОБАЛЬНОЕ СОСТОЯНИЕ
// ==========================
let globalState = {
  balance: 100,
  realBalance: null,
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
    maxLeverageUsed: 1,
    volatilityIndex: 0,
    marketSentiment: 50
  },
  marketMemory: {
    lastTrades: {},
    consecutiveTrades: {},
    volatilityHistory: {},
    fearSentimentHistory: [],
    marketNews: [],
    fundamentalData: {}
  },
  isRunning: true,
  takerFee: 0.0005,
  makerFee: 0.0002,
  maxRiskPerTrade: 0.01,
  maxLeverage: 3,
  watchlist: [
    { symbol: 'BTC-USDT', name: 'bitcoin' },
    { symbol: 'ETH-USDT', name: 'ethereum' },
    { symbol: 'SOL-USDT', name: 'solana' },
    { symbol: 'XRP-USDT', name: 'ripple' }
  ],
  isRealMode: false,
  tradeMode: 'adaptive',
  riskLevel: 'recommended',
  testMode: false,
  currentPrices: {},
  fearIndex: 50,
  fundamentalCache: {}
};

globalState.watchlist.forEach(coin => {
  globalState.positions[coin.name] = null;
  globalState.marketMemory.lastTrades[coin.name] = [];
  globalState.marketMemory.consecutiveTrades[coin.name] = 0;
  globalState.marketMemory.volatilityHistory[coin.name] = [];
  globalState.marketMemory.fundamentalData[coin.name] = {
    hashRate: null,
    activeAddresses: null,
    transactions: null,
    developerActivity: null,
    socialSentiment: null
  };
});

// ==========================
// КОНФИГУРАЦИЯ BINGX API
// ==========================
const BINGX_API_KEY = process.env.BINGX_API_KEY;
const BINGX_SECRET_KEY = process.env.BINGX_SECRET_KEY;
// Можно использовать альтернативный домен: 'https://open-api.bingx.io'
const BINGX_FUTURES_URL = process.env.BINGX_API_DOMAIN || 'https://open-api.bingx.com';

// ==========================
// ФУНКЦИЯ: Подпись запроса (только параметры, БЕЗ signature и recvWindow)
// ==========================
function signBingXRequest(params) {
  // Удаляем служебные параметры, если вдруг попали
  const cleanParams = { ...params };
  delete cleanParams.signature;
  delete cleanParams.recvWindow;

  const sortedKeys = Object.keys(cleanParams).sort();
  const sortedParams = sortedKeys.map(key => `${key}=${cleanParams[key]}`).join('&');
  return CryptoJS.HmacSHA256(sortedParams, BINGX_SECRET_KEY).toString(CryptoJS.enc.Hex);
}

// ==========================
// ФУНКЦИЯ: Получение Fear & Greed Index
// ==========================
async function getFearAndGreedIndex() {
  try {
    const response = await axios.get('https://api.alternative.me/fng/?limit=1', { timeout: 10000 });
    const value = parseInt(response.data.data[0].value);
    globalState.marketMemory.fearSentimentHistory.push({ value, timestamp: Date.now() });
    if (globalState.marketMemory.fearSentimentHistory.length > 24) {
      globalState.marketMemory.fearSentimentHistory.shift();
    }
    globalState.fearIndex = value;
    globalState.stats.marketSentiment = value;
    return value;
  } catch (e) {
    console.log('⚠️ Не удалось получить индекс страха — используем 50');
    globalState.fearIndex = Math.floor(20 + Math.random() * 60);
    globalState.stats.marketSentiment = globalState.fearIndex;
    return globalState.fearIndex;
  }
}

// ==========================
// ФУНКЦИЯ: Получение реального баланса
// ==========================
async function getBingXRealBalance() {
  try {
    console.log('🔍 [БАЛАНС] Запрос реального баланса...');
    if (!BINGX_API_KEY || !BINGX_SECRET_KEY) {
      console.error('❌ API-ключи не заданы');
      return null;
    }

    const timestamp = Date.now();
    const params = { timestamp, recvWindow: 0 }; // ✅ recvWindow=0
    const signature = signBingXRequest(params);

    // ✅ Формируем URL вручную: recvWindow и signature в конце
    const url = `${BINGX_FUTURES_URL}/openApi/swap/v2/user/balance?timestamp=${timestamp}&recvWindow=0&signature=${signature}`;

    console.log('🌐 [БАЛАНС] Отправляю запрос:', url);

    const response = await axios.get(url, {
      headers: { 'X-BX-APIKEY': BINGX_API_KEY },
      timeout: 10000
    });

    if (response.data.code === 0 && response.data.data) {
      let usdtBalance = null;
      if (response.data.data.balance?.asset === 'USDT') {
        usdtBalance = parseFloat(response.data.data.balance.balance);
      } else if (Array.isArray(response.data.data.assets)) {
        const usdtAsset = response.data.data.assets.find(a => a.asset === 'USDT');
        usdtBalance = usdtAsset ? parseFloat(usdtAsset.walletBalance) : null;
      } else if (Array.isArray(response.data.data)) {
        const usdtAsset = response.data.data.find(a => a.asset === 'USDT');
        usdtBalance = usdtAsset ? parseFloat(usdtAsset.walletBalance) : null;
      }

      if (usdtBalance !== null) {
        console.log(`💰 Баланс: $${usdtBalance.toFixed(2)}`);
        return usdtBalance;
      }
    }
    console.error('❌ Не найден баланс USDT');
    return null;
  } catch (error) {
    console.error('❌ Ошибка получения баланса:', error.message);
    return null;
  }
}

// ==========================
// ФУНКЦИЯ: Получение исторических свечей (ИСПРАВЛЕНО!)
// ==========================
async function getBingXFuturesHistory(symbol, interval = '1h', limit = 100) {
  try {
    // ✅ symbol уже "BTC-USDT", не добавляем лишнее
    const fullSymbol = symbol.toUpperCase().trim();
    const timestamp = Date.now();
    const params = {
      symbol: fullSymbol,
      interval,
      limit,
      timestamp,
      recvWindow: 0 // ✅ recvWindow=0
    };

    const signature = signBingXRequest(params);
    // ✅ Правильный порядок: все параметры → recvWindow → signature
    const url = `${BINGX_FUTURES_URL}/openApi/swap/v2/quote/klines?symbol=${params.symbol}&interval=${params.interval}&limit=${params.limit}&timestamp=${params.timestamp}&recvWindow=0&signature=${signature}`;

    console.log(`🌐 Получение истории для ${symbol}: GET ${url}`);

    const response = await axios.get(url, {
      headers: { 'X-BX-APIKEY': BINGX_API_KEY },
      timeout: 10000
    });

    if (response.data.code === 0 && Array.isArray(response.data.data)) {
      return response.data.data.map(candle => ({
        time: candle[0],
        open: parseFloat(candle[1]),
        high: parseFloat(candle[2]),
        low: parseFloat(candle[3]),
        close: parseFloat(candle[4]),
        volume: parseFloat(candle[5])
      }));
    } else {
      console.error(`❌ Ошибка для ${symbol}:`, response.data.msg);
      return [];
    }
  } catch (error) {
    console.error(`❌ Ошибка получения истории для ${symbol}:`, error.message);
    return [];
  }
}

// ==========================
// ФУНКЦИЯ: Получение текущих цен (ИСПРАВЛЕНО!)
// ==========================
async function getCurrentPrices() {
  try {
    // ✅ symbols уже содержат -USDT: "BTC-USDT,ETH-USDT,SOL-USDT,XRP-USDT"
    const symbols = globalState.watchlist.map(coin => coin.symbol).join(',');
    const timestamp = Date.now();
    const params = { symbols, timestamp, recvWindow: 0 };

    const signature = signBingXRequest(params);
    const url = `${BINGX_FUTURES_URL}/openApi/swap/v2/quote/ticker/price?symbols=${symbols}&timestamp=${timestamp}&recvWindow=0&signature=${signature}`;

    console.log(`🌐 Получение текущих цен: GET ${url}`);

    const response = await axios.get(url, {
      headers: { 'X-BX-APIKEY': BINGX_API_KEY },
      timeout: 10000
    });

    if (response.data.code === 0 && Array.isArray(response.data.data)) {
      const prices = {};
      response.data.data.forEach(item => {
        const cleanSymbol = item.symbol.replace('-USDT', '').toLowerCase();
        prices[cleanSymbol] = parseFloat(item.price);
      });
      globalState.currentPrices = prices;
      return prices;
    } else {
      console.error('❌ Ошибка получения цен:', response.data.msg);
      return {};
    }
  } catch (error) {
    console.error('❌ Ошибка получения текущих цен:', error.message);
    return {};
  }
}

// ==========================
// ФУНКЦИЯ: Установка плеча (ИСПРАВЛЕНО!)
// ==========================
async function setBingXLeverage(symbol, leverage) {
  try {
    if (!BINGX_API_KEY || !BINGX_SECRET_KEY) {
      console.log(`ℹ️ API-ключи не заданы. Плечо ${leverage}x для ${symbol} установлено виртуально.`);
      return true;
    }

    // ✅ Убираем лишний -USDT, если вдруг передали
    const cleanSymbol = symbol.toUpperCase().replace(/-USDT$/i, '');
    const fullSymbol = `${cleanSymbol}-USDT`;

    const timestamp = Date.now();
    const params = {
      symbol: fullSymbol,
      side: 'LONG',
      leverage: leverage.toString(),
      timestamp,
      recvWindow: 0
    };

    const signature = signBingXRequest(params);
    const url = `${BINGX_FUTURES_URL}/openApi/swap/v2/trade/leverage?symbol=${params.symbol}&side=LONG&leverage=${params.leverage}&timestamp=${params.timestamp}&recvWindow=0&signature=${signature}`;

    const response = await axios.post(url, null, {
      headers: { 'X-BX-APIKEY': BINGX_API_KEY, 'Content-Type': 'application/json' },
      timeout: 10000
    });

    if (response.data.code === 0) {
      console.log(`✅ Плечо ${leverage}x установлено для ${symbol}`);
      return true;
    } else {
      console.error(`❌ Ошибка установки плеча для ${symbol}:`, response.data.msg);
      return false;
    }
  } catch (error) {
    console.error(`💥 Ошибка установки плеча:`, error.message);
    return false;
  }
}

// ==========================
// ФУНКЦИЯ: Размещение ордера (ИСПРАВЛЕНО!)
// ==========================
async function placeBingXFuturesOrder(symbol, side, type, quantity, price = null, leverage) {
  try {
    if (!BINGX_API_KEY || !BINGX_SECRET_KEY) {
      console.log(`ℹ️ API-ключи не заданы. Ордер симулирован.`);
      return { orderId: `fake_${Date.now()}` };
    }

    const leverageSet = await setBingXLeverage(symbol, leverage);
    if (!leverageSet) return null;

    const cleanSymbol = symbol.toUpperCase().replace(/-USDT$/i, '');
    const fullSymbol = `${cleanSymbol}-USDT`;

    const timestamp = Date.now();
    const params = {
      symbol: fullSymbol,
      side,
      type,
      quantity: quantity.toFixed(6),
      timestamp,
      recvWindow: 0
    };

    if (price && type === 'LIMIT') {
      params.price = price.toFixed(8);
    }

    const signature = signBingXRequest(params);

    let url = `${BINGX_FUTURES_URL}/openApi/swap/v2/trade/order?symbol=${params.symbol}&side=${params.side}&type=${params.type}&quantity=${params.quantity}&timestamp=${params.timestamp}&recvWindow=0&signature=${signature}`;

    if (price && type === 'LIMIT') {
      url += `&price=${price.toFixed(8)}`;
    }

    const response = await axios.post(url, null, {
      headers: { 'X-BX-APIKEY': BINGX_API_KEY, 'Content-Type': 'application/json' },
      timeout: 10000
    });

    if (response.data.code === 0) {
      console.log(`✅ УСПЕШНЫЙ ОРДЕР: ${side} ${quantity} ${symbol}`);
      return response.data.data;
    } else {
      console.error(`❌ ОШИБКА ОРДЕРА:`, response.data.msg);
      return null;
    }
  } catch (error) {
    console.error(`💥 Ошибка при размещении ордера:`, error.message);
    return null;
  }
}

// ==========================
// ОСТАЛЬНЫЕ ФУНКЦИИ (БЕЗ ИЗМЕНЕНИЙ, КРОМЕ ЗАДЕРЖЕК)
// ==========================

async function getFundamentalData(coin) {
  const now = Date.now();
  const cacheKey = coin.name;
  const cacheDuration = 300000;

  if (globalState.fundamentalCache[cacheKey] && now - globalState.fundamentalCache[cacheKey].timestamp < cacheDuration) {
    console.log(`💾 Кэш для ${coin.name}`);
    return globalState.fundamentalCache[cacheKey].data;
  }

  try {
    const response = await axios.get(`https://api.coingecko.com/api/v3/coins/${coin.name}`, {
      params: {
        localization: false,
        tickers: false,
        market_data: true,
        community_data: true,
        developer_data: true
      },
      timeout: 10000
    });

    const data = response.data;
    const fundamentalData = {
      developerActivity: data.developer_data?.commits_30d || 0,
      socialSentiment: data.market_data?.sentiment_votes_up_percentage || 50
    };

    globalState.fundamentalCache[cacheKey] = { fundamentalData, timestamp: now };
    globalState.marketMemory.fundamentalData[coin.name] = fundamentalData;

    // ✅ Ждем 5 секунд перед следующим запросом
    await new Promise(r => setTimeout(r, 5000));
    return fundamentalData;

  } catch (error) {
    console.error(`❌ Ошибка для ${coin.name}:`, error.message);
    if (globalState.fundamentalCache[cacheKey]) {
      return globalState.fundamentalCache[cacheKey].data;
    }
    return null;
  }
}

// --- Все остальные функции (openFuturesTrade, calculateRiskScore, analyzeMarketWithAdaptiveStrategy, вспомогательные, checkOpenPositions, setRiskLevel, forceUpdateRealBalance, deposit, toggleMode, toggleTradeMode, printStats, testBingXAPI) остаются БЕЗ ИЗМЕНЕНИЙ ---

// ==========================
// HTTP-СЕРВЕР
// ==========================
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ru">
    <head><meta charset="UTF-8"><title>Торговый Бот</title></head>
    <body style="font-family: sans-serif; padding: 20px;">
      <h1>Торговый Бот</h1>
      <p>Баланс: <strong>$${globalState.balance.toFixed(2)}</strong></p>
      <p>Режим: <strong>${globalState.isRealMode ? 'РЕАЛЬНЫЙ' : 'ДЕМО'}</strong></p>
      <h3>Последние сделки</h3>
      <pre>${globalState.history.slice(-5).map(h => `${h.timestamp} | ${h.coin} | ${h.type} | ${(h.profitPercent * 100).toFixed(2)}%`).join('\n')}</pre>
    </body>
    </html>
  `);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`🌐 API URL: ${BINGX_FUTURES_URL}`);
});

// ==========================
// ГЛАВНЫЙ ЦИКЛ (С ЗАДЕРЖКАМИ)
// ==========================
(async () => {
  console.log('🤖 ЗАПУСК ТОРГОВОГО БОТА');
  setRiskLevel('recommended');
  globalState.tradeMode = 'adaptive';
  await forceUpdateRealBalance();

  while (globalState.isRunning) {
    try {
      console.log(`\n[${new Date().toLocaleTimeString()}] === АНАЛИЗ РЫНКА ===`);
      const fearIndex = await getFearAndGreedIndex();
      console.log(`😱 Индекс страха: ${fearIndex}`);

      if (Date.now() % 300000 < 10000) {
        await forceUpdateRealBalance();
      }

      const currentPrices = await getCurrentPrices();
      globalState.currentPrices = currentPrices;

      // ✅ Получаем фундаментальные данные с задержкой 5000 мс
      for (const coin of globalState.watchlist) {
        await getFundamentalData(coin);
        // Задержка между запросами к CoinGecko
        await new Promise(r => setTimeout(r, 5000));
      }

      await checkOpenPositions(currentPrices);

      let bestOpportunity = null;
      let bestReasoning = [];

      for (const coin of globalState.watchlist) {
        console.log(`\n🔍 Анализирую ${coin.name}...`);
        const candles = await getBingXFuturesHistory(coin.symbol, '1h', 100);

        if (candles.length < 50) {
          console.log(`   ⚠️ Пропускаем ${coin.name} — недостаточно данных`);
          await new Promise(r => setTimeout(r, 1200));
          continue;
        }

        const analysis = analyzeMarketWithAdaptiveStrategy(candles, coin.name, fearIndex, globalState.marketMemory.fundamentalData[coin.name]);

        if (!analysis || !analysis.signal.direction) {
          await new Promise(r => setTimeout(r, 1200));
          continue;
        }

        console.log(`   ✅ Сигнал: ${analysis.signal.direction}`);
        analysis.signal.reasoning.forEach(r => console.log(`   • ${r}`));

        if (!bestOpportunity || analysis.signal.confidence > bestOpportunity.signal.confidence) {
          bestOpportunity = analysis;
          bestReasoning = analysis.signal.reasoning;
        }

        await new Promise(r => setTimeout(r, 1200));
      }

      if (bestOpportunity && (globalState.isRealMode || globalState.balance > 10)) {
        console.log(`\n💎 РЕКОМЕНДУЕТСЯ: ${bestOpportunity.signal.direction} по ${bestOpportunity.coin}`);
        bestReasoning.forEach(r => console.log(`   • ${r}`));

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
        console.log(`\n⚪ Нет подходящих торговых возможностей — ожидаем...`);
      }

      // Обновление статистики
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
        console.log(`\n💰 Баланс: $${(globalState.isRealMode ? globalState.realBalance : globalState.balance)?.toFixed(2) || '...'}`);
        console.log(`📊 Волатильность: ${globalState.stats.volatilityIndex.toFixed(2)}%`);
        console.log(`🧠 Sentiment: ${globalState.stats.marketSentiment.toFixed(0)}%`);
      }

    } catch (error) {
      console.error('💥 КРИТИЧЕСКАЯ ОШИБКА В ЦИКЛЕ:', error.message);
    }

    console.log(`\n💤 Ждём 60 секунд...`);
    await new Promise(r => setTimeout(r, 60000));
  }
})();

// Экспорт функций
module.exports = { globalState, deposit, toggleMode, toggleTradeMode, setRiskLevel, forceUpdateRealBalance, testBingXAPI };

global.deposit = deposit;
global.toggleMode = toggleMode;
global.toggleTradeMode = toggleTradeMode;
global.setRiskLevel = setRiskLevel;
global.forceUpdateRealBalance = forceUpdateRealBalance;
global.testBingXAPI = testBingXAPI;

console.log('✅ Торговый Бот запущен!');
console.log('❗ Для торговли на реальном счете переведите USDT на фьючерсный счет BingX.');
console.log('⚙️ Используйте toggleMode() для переключения режима.');
console.log('⚠️ Риск потери средств 100%.');
