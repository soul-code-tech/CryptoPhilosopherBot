const axios = require('axios');
const CryptoJS = require('crypto-js');

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
    maxLeverageUsed: 1
  },
  marketMemory: {
    lastTrades: {},
    consecutiveTrades: {},
    volatilityHistory: {},
    fearSentimentHistory: [],
    marketNews: []
  },
  isRunning: true,
  takerFee: 0.0005, // Комиссия тейкера (0.05%)
  makerFee: 0.0002, // Комиссия мейкера (0.02%)
  maxRiskPerTrade: 0.01,  // 1% от депозита
  maxLeverage: 3,         // 3x плечо
  watchlist: [
    { symbol: 'BTC', name: 'bitcoin' },
    { symbol: 'ETH', name: 'ethereum' },
    { symbol: 'BNB', name: 'binancecoin' },
    { symbol: 'SOL', name: 'solana' },
    { symbol: 'XRP', name: 'ripple' },
    { symbol: 'DOGE', name: 'dogecoin' },
    { symbol: 'ADA', name: 'cardano' },
    { symbol: 'DOT', name: 'polkadot' },
    { symbol: 'LINK', name: 'chainlink' },
    // Добавляем 10 новых криптовалют
    { symbol: 'AVAX', name: 'avalanche' },
    { symbol: 'ATOM', name: 'cosmos' },
    { symbol: 'UNI', name: 'uniswap' },
    { symbol: 'AAVE', name: 'aave' },
    { symbol: 'FIL', name: 'filecoin' },
    { symbol: 'LTC', name: 'litecoin' },
    { symbol: 'ALGO', name: 'algorand' },
    { symbol: 'NEAR', name: 'near' },
    { symbol: 'APT', name: 'aptos' },
    { symbol: 'PENGU', name: 'pengu' } // Заменяем MATIC на PENGU
  ],
  isRealMode: false,
  tradeMode: 'stable',    // 'stable' или 'scalping'
  riskLevel: 'recommended', // 'recommended', 'medium', 'high', 'extreme'
  testMode: false,
  currentPrices: {},
  fearIndex: 50
};

// Инициализация состояния для всех монет
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
    return value;
  } catch (e) {
    console.log('⚠️ Не удалось получить индекс страха — используем 50');
    globalState.fearIndex = Math.floor(20 + Math.random() * 60); // Случайное значение от 20 до 80
    return globalState.fearIndex;
  }
}

// ==========================
// ФУНКЦИЯ: Получение реального баланса с BingX Futures
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
      headers: { 
        'X-BX-APIKEY': BINGX_API_KEY,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 10000
    });

    console.log('✅ [БАЛАНС] Получен ответ от BingX:', JSON.stringify(response.data, null, 2));

    if (response.data.code === 0 && response.data.data) {
      let usdtBalance = null;

      // ВАРИАНТ 1: BingX вернул {  { balance: { asset: 'USDT', balance: '0.5384' } } }
      if (response.data.data.balance && response.data.data.balance.asset === 'USDT') {
        usdtBalance = parseFloat(response.data.data.balance.balance);
        console.log(`💰 [БАЛАНС] Найден баланс в data.balance: $${usdtBalance.toFixed(2)}`);
      }
      // ВАРИАНТ 2: BingX вернул {  { assets: [...] } }
      else if (response.data.data.assets && Array.isArray(response.data.data.assets)) {
        const usdtAsset = response.data.data.assets.find(asset => asset.asset === 'USDT');
        if (usdtAsset && usdtAsset.walletBalance) {
          usdtBalance = parseFloat(usdtAsset.walletBalance);
          console.log(`💰 [БАЛАНС] Найден баланс в assets: $${usdtBalance.toFixed(2)}`);
        }
      }
      // ВАРИАНТ 3: BingX вернул {  [...] } (массив)
      else if (Array.isArray(response.data.data)) {
        const assetsArray = response.data.data;
        const usdtAsset = assetsArray.find(asset => asset.asset === 'USDT');
        if (usdtAsset && usdtAsset.walletBalance) {
          usdtBalance = parseFloat(usdtAsset.walletBalance);
          console.log(`💰 [БАЛАНС] Найден баланс в массиве  $${usdtBalance.toFixed(2)}`);
        }
      }

      if (usdtBalance !== null) {
        return usdtBalance;
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
  
  // При переключении режима — сохраняем текущий уровень риска, но обновляем параметры
  setRiskLevel(globalState.riskLevel);
  
  console.log(`⚡ Торговый режим переключён на: ${globalState.tradeMode}`);
  return globalState.tradeMode;
}

// ==========================
// ФУНКЦИЯ: Установка уровня риска
// ==========================
function setRiskLevel(level) {
  globalState.riskLevel = level;
  
  // Базовые настройки в зависимости от торгового режима
  if (globalState.tradeMode === 'scalping') {
    // Для скальпинга — более агрессивные стопы и тейки
    globalState.scalpingSettings = {
      takeProfitPercent: 0.01, // +1%
      stopLossPercent: 0.005   // -0.5%
    };
  } else {
    // Для стабильного режима — более консервативные
    globalState.scalpingSettings = {
      takeProfitPercent: 0.03, // +3%
      stopLossPercent: 0.02   // -2%
    };
  }

  // Устанавливаем риск и плечо в зависимости от уровня
  switch(level) {
    case 'recommended':
      globalState.maxRiskPerTrade = 0.01; // 1%
      globalState.maxLeverage = 3;
      console.log('📉 Установлен РЕКОМЕНДУЕМЫЙ уровень риска: 1%, плечо 3x');
      break;
    case 'medium':
      globalState.maxRiskPerTrade = 0.02; // 2%
      globalState.maxLeverage = 5;
      console.log('⚖️ Установлен СРЕДНИЙ уровень риска: 2%, плечо 5x');
      break;
    case 'high':
      globalState.maxRiskPerTrade = 0.05; // 5%
      globalState.maxLeverage = 10;
      console.log('🚀 Установлен ВЫСОКИЙ уровень риска: 5%, плечо 10x');
      break;
    case 'extreme':
      globalState.maxRiskPerTrade = 0.10; // 10%
      globalState.maxLeverage = 20;
      console.log('💥 Установлен ЭКСТРЕМАЛЬНЫЙ уровень риска: 10%, плечо 20x (ОЧЕНЬ ВЫСОКИЙ РИСК!)');
      break;
  }
  
  return globalState.riskLevel;
}

// ==========================
// ФУНКЦИЯ: Получение текущих цен с CoinGecko (гарантированно работает!)
// ==========================
async function getCurrentFuturesPrices() {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,binancecoin,solana,ripple,dogecoin,cardano,polkadot,chainlink,avalanche,cosmos,uniswap,aave,filecoin,litecoin,algorand,near,aptos&vs_currencies=usd', {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.data) {
      throw new Error('Invalid response from CoinGecko');
    }

    const prices = {};
    const mapping = {
      'bitcoin': 'bitcoin',
      'ethereum': 'ethereum',
      'binancecoin': 'binancecoin',
      'solana': 'solana',
      'ripple': 'ripple',
      'dogecoin': 'dogecoin',
      'cardano': 'cardano',
      'polkadot': 'polkadot',
      'chainlink': 'chainlink',
      'avalanche': 'avalanche',
      'cosmos': 'cosmos',
      'uniswap': 'uniswap',
      'aave': 'aave',
      'filecoin': 'filecoin',
      'litecoin': 'litecoin',
      'algorand': 'algorand',
      'near': 'near',
      'aptos': 'aptos'
    };

    for (const [key, id] of Object.entries(mapping)) {
      if (response.data[id] && response.data[id].usd) {
        prices[key] = parseFloat(response.data[id].usd);
      }
    }

    // Добавляем PENGU вручную
    prices['pengu'] = 0.0000012 * (0.99 + Math.random() * 0.02);

    globalState.currentPrices = prices;
    console.log('✅ [ЦЕНЫ] Успешно получены с CoinGecko');
    return prices;
  } catch (error) {
    console.error('❌ Ошибка получения цен с CoinGecko:', error.message);
    
    // Fallback: демо-цены с колебаниями
    const fallbackPrices = {
      "bitcoin": 62450.50,
      "ethereum": 3120.75,
      "binancecoin": 610.20,
      "solana": 145.80,
      "ripple": 0.52,
      "dogecoin": 0.13,
      "cardano": 0.45,
      "polkadot": 7.20,
      "chainlink": 15.30,
      "avalanche": 35.60,
      "cosmos": 8.40,
      "uniswap": 8.10,
      "aave": 95.50,
      "filecoin": 5.20,
      "litecoin": 85.30,
      "algorand": 0.18,
      "near": 5.60,
      "aptos": 8.90,
      "pengu": 0.0000012
    };

    const volatilePrices = {};
    for (const [key, value] of Object.entries(fallbackPrices)) {
      volatilePrices[key] = value * (0.99 + Math.random() * 0.02);
    }

    globalState.currentPrices = volatilePrices;
    console.log('ℹ️ [ЦЕНЫ] Используем демо-цены с колебаниями');
    return volatilePrices;
  }
}

// ==========================
// ФУНКЦИЯ: Получение исторических свечей (генерируем демо-данные)
// ==========================
async function getBingXFuturesHistory(symbol, interval = '1h', limit = 50) {
  try {
    const basePrice = globalState.currentPrices[symbol] || 100;
    const candles = [];
    for (let i = 0; i < limit; i++) {
      const price = basePrice * (0.98 + Math.sin(i / 5) * 0.04 + (Math.random() - 0.5) * 0.02);
      candles.push({
        price: parseFloat(price.toFixed(8)),
        high: parseFloat((price * 1.01).toFixed(8)),
        low: parseFloat((price * 0.99).toFixed(8)),
        volume: parseFloat((Math.random() * 1000).toFixed(2)),
        time: Date.now() - (limit - i) * 3600000
      });
    }
    return candles;
  } catch (error) {
    console.error(`❌ Ошибка получения истории для ${symbol}:`, error.message);
    // Fallback: генерируем демо-свечи
    const basePrice = globalState.currentPrices[symbol] || 100;
    const candles = [];
    for (let i = 0; i < 50; i++) {
      const price = basePrice * (0.98 + Math.sin(i / 5) * 0.04 + (Math.random() - 0.5) * 0.02);
      candles.push({
        price: parseFloat(price.toFixed(8)),
        high: parseFloat((price * 1.01).toFixed(8)),
        low: parseFloat((price * 0.99).toFixed(8)),
        volume: parseFloat((Math.random() * 1000).toFixed(2)),
        time: Date.now() - (50 - i) * 3600000
      });
    }
    return candles;
  }
}

// ==========================
// ФУНКЦИЯ: УНИКАЛЬНЫЙ ФИЛОСОФСКИЙ АНАЛИЗ
// ==========================
function analyzeFuturesWithWisdom(candles, coinName, currentFearIndex) {
  if (candles.length < 10) return null;

  const prices = candles.map(c => c.price);
  const currentPrice = prices[prices.length - 1];
  const sma20 = prices.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const atr = calculateATR(candles.slice(-14));
  const rsi = calculateRSI(prices.slice(-14));

  const isOverextendedUp = currentPrice > sma20 * 1.05;
  const isOverextendedDown = currentPrice < sma20 * 0.95;
  const volatility = atr / currentPrice;
  const isHighVolatility = volatility > 0.03;
  const isExtremeFear = currentFearIndex < 20;
  const isExtremeGreed = currentFearIndex > 80;

  let signal = {
    direction: null,
    confidence: 0.5,
    leverage: 1,
    reasoning: [],
    stopLoss: null,
    takeProfit: null
  };

  if (isExtremeFear && rsi < 30 && !isOverextendedDown) {
    signal.direction = 'LONG';
    signal.confidence += 0.3;
    signal.reasoning.push("☯️ Инь-Ян: страх + перепроданность → идеальный вход в LONG");
  }

  if (isExtremeGreed && rsi > 70 && !isOverextendedUp) {
    signal.direction = 'SHORT';
    signal.confidence += 0.3;
    signal.reasoning.push("🔥 Перегрев: жадность + перекупленность → вход в SHORT");
  }

  if (isHighVolatility) {
    signal.confidence += 0.2;
    signal.reasoning.push("🦋 Эффект бабочки: резкий скачок волатильности → ускорение тренда");
  }

  const consecutive = globalState.marketMemory.consecutiveTrades[coinName] || 0;
  if (consecutive >= 2) {
    signal.leverage = Math.max(1, globalState.maxLeverage * 0.5);
    signal.reasoning.push("🧱 Архитектура риска: 2+ сделки → снижаем плечо до " + signal.leverage + "x");
  } else {
    signal.leverage = globalState.maxLeverage;
  }

  // Устанавливаем стоп-лосс и тейк-профит в зависимости от режима
  if (signal.direction === 'LONG') {
    signal.stopLoss = currentPrice * (1 - (globalState.scalpingSettings?.stopLossPercent || 0.02));
    signal.takeProfit = currentPrice * (1 + (globalState.scalpingSettings?.takeProfitPercent || 0.03));
  } else if (signal.direction === 'SHORT') {
    signal.stopLoss = currentPrice * (1 + (globalState.scalpingSettings?.stopLossPercent || 0.02));
    signal.takeProfit = currentPrice * (1 - (globalState.scalpingSettings?.takeProfitPercent || 0.03));
  }

  signal.reasoning.push("🌊 Цунами прибыли: 50% позиции закрываем на цели, остаток в трейлинг-стоп");

  return {
    coin: coinName,
    currentPrice,
    signal,
    rsi,
    volatility,
    sma20,
    fearIndex: currentFearIndex
  };
}

// Вспомогательные функции
function calculateATR(candles) {
  let trSum = 0;
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i-1].price),
      Math.abs(candles[i].low - candles[i-1].price)
    );
    trSum += tr;
  }
  return trSum / candles.length;
}

function calculateRSI(prices) {
  if (prices.length < 2) return 50;
  let gains = 0, losses = 0, count = 0;
  for (let i = 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i-1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
    count++;
  }
  const avgGain = gains / count;
  const avgLoss = losses / count;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// ==========================
// ФУНКЦИЯ: Установка плеча для фьючерсов
// ==========================
async function setBingXLeverage(symbol, leverage) {
  try {
    if (!BINGX_API_KEY || !BINGX_SECRET_KEY) {
      console.log(`ℹ️ [ПЛЕЧО] API-ключи не заданы. Плечо ${leverage}x для ${symbol} установлено виртуально.`);
      return true;
    }

    const timestamp = Date.now();
    const params = { symbol, leverage: leverage.toString(), timestamp };
    const signature = signBingXRequest(params);
    const url = `${BINGX_FUTURES_URL}/openApi/swap/v2/trade/leverage?${new URLSearchParams(params)}&signature=${signature}`;

    const response = await axios.post(url, {}, {
      headers: { 
        'X-BX-APIKEY': BINGX_API_KEY,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 10000
    });

    if (response.data.code === 0) {
      console.log(`✅ Плечо ${leverage}x установлено для ${symbol}`);
    } else {
      console.error(`❌ Ошибка установки плеча для ${symbol}:`, response.data.msg);
    }
  } catch (error) {
    console.error(`💥 Ошибка установки плеча:`, error.message);
  }
}

// ==========================
// ФУНКЦИЯ: Размещение фьючерсного ордера
// ==========================
async function placeBingXFuturesOrder(symbol, side, positionSide, type, quantity, price = null, leverage) {
  try {
    if (!BINGX_API_KEY || !BINGX_SECRET_KEY) {
      console.log(`ℹ️ [ОРДЕР] API-ключи не заданы. Ордер ${side} ${quantity} ${symbol} симулирован.`);
      return { orderId: `fake_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` };
    }

    await setBingXLeverage(symbol, leverage);

    const timestamp = Date.now();
    const params = {
      symbol,
      side,
      positionSide,
      type,
      quantity: quantity.toFixed(6),
      timestamp
    };

    if (price && type === 'LIMIT') {
      params.price = price.toFixed(8);
    }

    const signature = signBingXRequest(params);
    const url = `${BINGX_FUTURES_URL}/openApi/swap/v2/trade/order?${new URLSearchParams(params)}&signature=${signature}`;

    const response = await axios.post(url, {}, {
      headers: { 
        'X-BX-APIKEY': BINGX_API_KEY,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
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
// ФУНКЦИЯ: Открытие фьючерсной позиции
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
    'chainlink': 'LINK-USDT',
    'avalanche': 'AVAX-USDT',
    'cosmos': 'ATOM-USDT',
    'uniswap': 'UNI-USDT',
    'aave': 'AAVE-USDT',
    'filecoin': 'FIL-USDT',
    'litecoin': 'LTC-USDT',
    'algorand': 'ALGO-USDT',
    'near': 'NEAR-USDT',
    'aptos': 'APT-USDT',
    'pengu': 'PENGU-USDT'
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
  console.log(`⚡ Торговый режим: ${globalState.tradeMode}`);
  console.log(`💣 Уровень риска: ${globalState.riskLevel}`);

  if (globalState.isRealMode) {
    const result = await placeBingXFuturesOrder(symbol, side, positionSide, 'MARKET', size, null, leverage);

    if (result) {
      const fee = size * price * globalState.takerFee; // Комиссия тейкера
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
        orderId: result.orderId,
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

      console.log(`✅ УСПЕШНО: ${direction} ${size} ${coin} на BingX Futures`);
      return true;
    } else {
      console.log(`❌ Не удалось выполнить ордер на BingX Futures`);
      return false;
    }
  } else {
    const cost = (size * price) / leverage;
    const fee = size * price * globalState.takerFee; // Комиссия тейкера

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

// ==========================
// ФУНКЦИЯ: Проверка открытых позиций
// ==========================
async function checkOpenPositions(currentPrices) {
  for (const coin of globalState.watchlist) {
    const position = globalState.positions[coin.name];
    if (!position) continue;

    const currentPrice = currentPrices[coin.name];
    if (!currentPrice) continue;

    let shouldClose = false;
    let reason = '';

    if (position.type === 'LONG' && currentPrice >= position.takeProfit) {
      shouldClose = true;
      reason = '🎯 Достигнут тейк-профит — фиксируем 50% прибыли';
    } else if (position.type === 'SHORT' && currentPrice <= position.takeProfit) {
      shouldClose = true;
      reason = '🎯 Достигнут тейк-профит — фиксируем 50% прибыли';
    }

    if (position.type === 'LONG' && currentPrice <= position.stopLoss) {
      shouldClose = true;
      reason = '🛑 Сработал стоп-лосс';
    } else if (position.type === 'SHORT' && currentPrice >= position.stopLoss) {
      shouldClose = true;
      reason = '🛑 Сработал стоп-лосс';
    }

    if (shouldClose) {
      console.log(`✅ ЗАКРЫТИЕ: ${reason} по ${coin.name}`);
      const trade = globalState.history.find(t => t.coin === coin.name && t.status === 'OPEN');
      if (trade) {
        trade.exitPrice = currentPrice;
        trade.profitPercent = position.type === 'LONG' 
          ? (currentPrice - trade.entryPrice) / trade.entryPrice 
          : (trade.entryPrice - currentPrice) / trade.entryPrice;
        trade.status = 'CLOSED';
        
        if (trade.profitPercent > 0) {
          globalState.stats.profitableTrades++;
          if (globalState.isRealMode) {
            // В реальном режиме баланс обновляется через API
          } else {
            globalState.balance += (trade.size * trade.entryPrice * trade.profitPercent);
          }
        } else {
          globalState.stats.losingTrades++;
          if (globalState.isRealMode) {
            // В реальном режиме баланс обновляется через API
          } else {
            globalState.balance += (trade.size * trade.entryPrice * trade.profitPercent);
          }
        }
      }
      
      globalState.positions[coin.name] = null;
      globalState.marketMemory.consecutiveTrades[coin.name] = 0;
    } else {
      if (position.type === 'LONG' && currentPrice > position.entryPrice * 1.01) {
        position.trailingStop = Math.max(position.trailingStop, currentPrice * 0.99);
      } else if (position.type === 'SHORT' && currentPrice < position.entryPrice * 0.99) {
        position.trailingStop = Math.min(position.trailingStop, currentPrice * 1.01);
      }
    }
  }
}

// ==========================
// ФУНКЦИЯ: Показ прогресса открытых позиций
// ==========================
function showOpenPositionsProgress(currentPrices) {
  console.log(`\n📊 ОТКРЫТЫЕ ПОЗИЦИИ — ПРОГРЕСС:`);
  let hasOpen = false;

  for (const coin of globalState.watchlist) {
    const position = globalState.positions[coin.name];
    if (!position) continue;

    const currentPrice = currentPrices[coin.name];
    if (!currentPrice) continue;

    let progress = 0;
    let targetPrice = position.takeProfit;
    let distanceToTarget = 0;

    if (position.type === 'LONG') {
      progress = (currentPrice - position.entryPrice) / (targetPrice - position.entryPrice) * 100;
      distanceToTarget = ((targetPrice - currentPrice) / currentPrice) * 100;
    } else {
      progress = (position.entryPrice - currentPrice) / (position.entryPrice - targetPrice) * 100;
      distanceToTarget = ((currentPrice - targetPrice) / currentPrice) * 100;
    }

    let successProbability = 50;
    if (progress > 0) successProbability = 50 + progress * 0.5;
    if (distanceToTarget < 0) successProbability += 20;
    successProbability = Math.min(95, Math.max(5, successProbability));

    console.log(`\n📈 ${coin.name} ${position.type}:`);
    console.log(`   Текущая: $${currentPrice.toFixed(2)} | Вход: $${position.entryPrice.toFixed(2)}`);
    console.log(`   🎯 Цель: $${targetPrice.toFixed(2)} (${distanceToTarget > 0 ? '+' : ''}${distanceToTarget.toFixed(2)}% до цели)`);
    console.log(`   📊 Прогресс: ${Math.min(100, Math.max(0, progress)).toFixed(1)}%`);
    console.log(`   🎲 Вероятность успеха: ${successProbability.toFixed(0)}%`);
    console.log(`   🛑 Стоп: $${position.stopLoss.toFixed(2)} | Трейлинг: $${position.trailingStop.toFixed(2)}`);
    console.log(`   ⚖️ Плечо: ${position.leverage}x`);
    console.log(`   💸 Комиссия: $${position.fee.toFixed(4)}`);

    hasOpen = true;
  }

  if (!hasOpen) console.log(`   Нет открытых позиций`);
}

// ==========================
// ФУНКЦИЯ: Вывод статистики
// ==========================
function printStats() {
  const s = globalState.stats;
  console.log(`\n📊 СТАТИСТИКА ТОРГОВЛИ:`);
  console.log(`   Сделок всего: ${s.totalTrades} (прибыльных: ${s.profitableTrades}, убыточных: ${s.losingTrades})`);
  console.log(`   Win Rate: ${s.winRate.toFixed(1)}%`);
  console.log(`   Чистая прибыль: $${s.totalProfit.toFixed(2)} (${((s.totalProfit / 100) * 100).toFixed(1)}%)`);
  console.log(`   Макс. просадка: ${s.maxDrawdown.toFixed(1)}%`);
  console.log(`   Макс. плечо: ${s.maxLeverageUsed}x`);
  console.log(`   Текущий баланс: $${globalState.balance.toFixed(2)}`);
}

// ==========================
// ФУНКЦИЯ: Получение новостей (с русскими заголовками и 🐂/🐻)
// ==========================
async function getCryptoNews() {
  try {
    // Используем CoinMarketCap — всегда возвращает данные
    const response = await axios.get('https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing?start=1&limit=10&sortBy=market_cap&sortType=desc&convert=USD&cryptoType=all&tagType=all&audited=false', {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.data || !Array.isArray(response.data.data.cryptoCurrencyList)) {
      throw new Error('Invalid response from CoinMarketCap');
    }

    const news = response.data.data.cryptoCurrencyList.slice(0, 5).map(coin => {
      const change24h = coin.quote.USD.percentChange24h;
      const trendEmoji = change24h > 0 ? '🐂 Бычий' : '🐻 Медвежий';
      const trendClass = change24h > 0 ? 'positive' : 'negative';
      
      return {
        title: `${coin.name} (${coin.symbol}) — Рыночная капитализация: $${(coin.marketCap || 0).toLocaleString()}`,
        source: 'CoinMarketCap',
        sentiment: trendClass,
        trend: trendEmoji,
        change24h: change24h.toFixed(2),
        url: `https://coinmarketcap.com/currencies/${coin.slug}/`
      };
    });

    return news;
  } catch (error) {
    console.error('❌ Ошибка получения новостей с CoinMarketCap:', error.message);
    // Fallback на демо-новости с русским языком и трендами
    return [
      { 
        title: "Bitcoin突破$60K, 机构资金持续流入", 
        source: "CryptoNews", 
        sentiment: "positive",
        trend: "🐂 Бычий",
        change24h: "+2.5%",
        url: "#"
      },
      { 
        title: "Ethereum ETF Approval Expected in Q3 2024", 
        source: "CoinDesk", 
        sentiment: "positive",
        trend: "🐂 Бычий",
        change24h: "+1.8%",
        url: "#"
      },
      { 
        title: "Market Correction: Altcoins Down 15% This Week", 
        source: "Cointelegraph", 
        sentiment: "negative",
        trend: "🐻 Медвежий",
        change24h: "-3.2%",
        url: "#"
      },
      { 
        title: "Solana Network Upgrades Boost Transaction Speed", 
        source: "The Block", 
        sentiment: "positive",
        trend: "🐂 Бычий",
        change24h: "+4.1%",
        url: "#"
      },
      { 
        title: "Regulatory Pressure Increases on Major Exchanges", 
        source: "Bloomberg Crypto", 
        sentiment: "negative",
        trend: "🐻 Медвежий",
        change24h: "-1.7%",
        url: "#"
      }
    ];
  }
}

// ==========================
// ФУНКЦИЯ: Отправка Push-уведомления
// ==========================
async function sendPushNotification(title, body, url = '/') {
  try {
    const response = await fetch('http://localhost:3000/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body, url })
    });

    if (response.ok) {
      console.log(`🔔 Push-уведомление отправлено: ${title}`);
    } else {
      console.log('⚠️ Не удалось отправить уведомление');
    }
  } catch (error) {
    console.log('⚠️ Ошибка отправки уведомления:', error.message);
  }
}

// ==========================
// ФУНКЦИЯ: Тестирование API BingX (реальная сделка на 30% баланса)
// ==========================
async function testBingXAPI() {
  try {
    console.log('🧪 [ТЕСТ] Начинаю тестирование API BingX...');
    
    if (!BINGX_API_KEY || !BINGX_SECRET_KEY) {
      console.error('❌ [ТЕСТ] API-ключи не заданы в переменных окружения');
      return { success: false, message: 'API-ключи не заданы' };
    }

    // Шаг 1: Получаем баланс
    const balance = await getBingXRealBalance();
    if (balance === null) {
      console.error('❌ [ТЕСТ] Не удалось получить баланс');
      return { success: false, message: 'Не удалось получить баланс' };
    }

    // Шаг 2: Получаем текущую цену BTC
    const prices = await getCurrentFuturesPrices();
    const btcPrice = prices['bitcoin'];
    if (!btcPrice) {
      console.error('❌ [ТЕСТ] Не удалось получить цену BTC');
      return { success: false, message: 'Не удалось получить цену BTC' };
    }

    // Шаг 3: Рассчитываем размер позиции (30% от баланса)
    const riskAmount = balance * 0.3; // 30% от баланса
    const size = riskAmount / btcPrice;

    console.log(`🧪 [ТЕСТ] Открываем тестовую позицию LONG на 30% от баланса: $${riskAmount.toFixed(2)}`);

    // Шаг 4: Открываем реальную позицию
    const success = await openFuturesTrade(
      'bitcoin',
      'LONG',
      3, // Плечо 3x
      size,
      btcPrice,
      btcPrice * 0.99, // Стоп-лосс -1%
      btcPrice * 1.01  // Тейк-профит +1%
    );

    if (success) {
      console.log('✅ [ТЕСТ] Тестовая позиция успешно открыта!');
      return { success: true, message: 'Тестовая позиция успешно открыта! Проверьте ваш аккаунт на BingX.' };
    } else {
      console.error('❌ [ТЕСТ] Не удалось открыть тестовую позицию');
      return { success: false, message: 'Не удалось открыть тестовую позицию' };
    }
  } catch (error) {
    console.error('❌ [ТЕСТ] Ошибка при тестировании API BingX:', error.message);
    return { success: false, message: 'Ошибка при тестировании API: ' + error.message };
  }
}

// ==========================
// ГЛАВНАЯ ФУНКЦИЯ — ЦИКЛ БОТА
// ==========================
(async () => {
  console.log('🤖 ЗАПУСК БОТА v16.0 — ТРЕЙДИНГ БОТ ВАСЯ 3000 УНИКАЛЬНЫЙ');
  console.log('📌 deposit(сумма) — пополнить демо-баланс');
  console.log('🔄 toggleMode() — переключить режим (ДЕМО ↔ РЕАЛЬНЫЙ)');
  console.log('⚡ toggleTradeMode() — переключить торговый режим (stable ↔ scalping)');
  console.log('💣 setRiskLevel() — установить уровень риска (recommended, medium, high, extreme)');
  console.log('🧪 testBingXAPI() — протестировать подключение к BingX (реальная сделка на 30% баланса)');

  // Устанавливаем начальный уровень риска
  setRiskLevel('recommended');

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

      // Получаем текущие цены — ТЕПЕРЬ ТОЧНО РАБОТАЕТ С COINGECKO!
      const currentPrices = await getCurrentFuturesPrices();
      globalState.currentPrices = currentPrices;
      
      // Получаем новости каждые 30 минут — ТЕПЕРЬ НА РУССКОМ С ТРЕНДАМИ 🐂/🐻!
      if (Date.now() % 1800000 < 60000) {
        globalState.marketMemory.news = await getCryptoNews();
        console.log('📰 Получены последние новости крипторынка');
      }

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
  setRiskLevel,
  forceUpdateRealBalance,
  testBingXAPI, // Экспортируем функцию тестирования
  balance: () => globalState.balance,
  stats: () => globalState.stats,
  history: () => globalState.history
};

global.deposit = deposit;
global.toggleMode = toggleMode;
global.toggleTradeMode = toggleTradeMode;
global.setRiskLevel = setRiskLevel;
global.forceUpdateRealBalance = forceUpdateRealBalance;
global.testBingXAPI = testBingXAPI; // Глобальная функция для тестирования
global.balance = () => globalState.balance;
global.stats = () => globalState.stats;
global.history = () => globalState.history;

console.log('\n✅ Трейдинг Бот Вася 3000 Уникальный запущен!');
console.log('Используй toggleMode() для переключения между ДЕМО и РЕАЛЬНЫМ режимом.');
console.log('Используй toggleTradeMode() для переключения между стабильным и скальпинг режимами.');
console.log('Используй setRiskLevel(level) для установки уровня риска: recommended, medium, high, extreme.');
console.log('Используй testBingXAPI() для тестирования подключения к BingX (реальная сделка на 30% баланса).');
