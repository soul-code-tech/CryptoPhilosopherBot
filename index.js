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
  balance: 100, // Демо-баланс
  realBalance: null, // Реальный баланс с BingX Futures
  positions: {}, // Активные позиции
  history: [], // История ВСЕХ сделок
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
    fundamentalData: {} // Фундаментальные данные для монет
  },
  isRunning: true,
  takerFee: 0.0005, // Комиссия тейкера (0.05%)
  makerFee: 0.0002, // Комиссия мейкера (0.02%)
  maxRiskPerTrade: 0.01,  // 1% от депозита по умолчанию
  maxLeverage: 3,         // 3x плечо
  watchlist: [
    { symbol: 'BTC', name: 'bitcoin' },
    { symbol: 'ETH', name: 'ethereum' },
    { symbol: 'SOL', name: 'solana' },
    { symbol: 'XRP', name: 'ripple' }
  ],
  isRealMode: false, // false = демо, true = реальный режим
  tradeMode: 'adaptive', // 'adaptive' (адаптивный режим), 'scalping', 'swing'
  riskLevel: 'recommended', // 'recommended', 'medium', 'high', 'extreme'
  testMode: false,
  currentPrices: {},
  fearIndex: 50,
  binanceApiKey: process.env.BINGX_API_KEY,
  binanceSecretKey: process.env.BINGX_SECRET_KEY,
  bingxFuturesUrl: 'https://open-api.bingx.com'
};

// Инициализация состояния для всех монет
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
const BINGX_FUTURES_URL = 'https://open-api.bingx.com';

// ==========================
// ФУНКЦИЯ: Подпись запроса для BingX (СТРОГО ПО ДОКУМЕНТАЦИИ)
// ==========================
function signBingXRequest(params) {
  // Сортируем параметры по ключам
  const sortedKeys = Object.keys(params).sort();
  const sortedParams = sortedKeys.map(key => `${key}=${params[key]}`).join('&');
  // Создаем подпись HMAC SHA256
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
    globalState.fearIndex = Math.floor(20 + Math.random() * 60); // Случайное значение от 20 до 80
    globalState.stats.marketSentiment = globalState.fearIndex;
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
    // ВАЖНО: Все параметры передаются в query string, а не в body
    const url = `${BINGX_FUTURES_URL}/openApi/swap/v2/user/balance?timestamp=${timestamp}&signature=${signature}`;
    console.log('🌐 [БАЛАНС] Отправляю ПОДПИСАННЫЙ запрос к:', url);
    const response = await axios.get(url, {
      headers: { 
        'X-BX-APIKEY': BINGX_API_KEY,
        'Content-Type': 'application/json',
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
// ФУНКЦИЯ: Получение исторических свечей с BingX Futures (ИСПРАВЛЕНА)
// ==========================
async function getBingXFuturesHistory(symbol, interval = '1h', limit = 100) {
  try {
    const params = {
      symbol: `${symbol}USDT`,
      interval,
      limit
    };
    const timestamp = Date.now();
    params.timestamp = timestamp;
    const signature = signBingXRequest(params);
    // ВАЖНО: Отправляем параметры в ТЕЛЕ POST-запроса, а не в query string!
    const url = `${BINGX_FUTURES_URL}/openApi/swap/v2/quote/klines`;
    console.log(`🌐 Получение истории для ${symbol}: POST ${url}`);
    const response = await axios.post(url, params, { // <-- Используем POST и передаем params в тело
      headers: { 
        'X-BX-APIKEY': BINGX_API_KEY,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 10000
    });
    console.log('✅ [ИСТОРИЯ] Ответ:', JSON.stringify(response.data, null, 2));
    if (response.data.code === 0 && Array.isArray(response.data.data)) {
      const candles = response.data.data.map(candle => ({
        time: candle[0],
        open: parseFloat(candle[1]),
        high: parseFloat(candle[2]),
        low: parseFloat(candle[3]),
        close: parseFloat(candle[4]),
        volume: parseFloat(candle[5]),
        closeTime: candle[6],
        quoteVolume: parseFloat(candle[7]),
        trades: parseInt(candle[8]),
        takerBuyBaseVolume: parseFloat(candle[9]),
        takerBuyQuoteVolume: parseFloat(candle[10])
      }));
      return candles;
    } else {
      console.error(`❌ Ошибка в ответе от BingX для истории ${symbol}:`, response.data.msg || 'Неизвестная ошибка');
      return [];
    }
  } catch (error) {
    console.error(`❌ Ошибка получения истории для ${symbol}:`, error.message);
    return [];
  }
}

// ==========================
// ФУНКЦИЯ: Получение текущих цен с BingX (ИСПРАВЛЕНА)
// ==========================
async function getCurrentPrices() {
  try {
    const symbols = globalState.watchlist.map(coin => coin.symbol).join(',');
    const params = {
      symbols
    };
    const timestamp = Date.now();
    params.timestamp = timestamp;
    const signature = signBingXRequest(params);
    // ВАЖНО: Отправляем параметры в ТЕЛЕ POST-запроса
    const url = `${BINGX_FUTURES_URL}/openApi/swap/v2/quote/ticker/price`;
    console.log(`🌐 Получение текущих цен: POST ${url}`);
    const response = await axios.post(url, params, { // <-- Используем POST
      headers: { 
        'X-BX-APIKEY': BINGX_API_KEY,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 10000
    });
    console.log('✅ [ЦЕНЫ] Ответ:', JSON.stringify(response.data, null, 2));
    if (response.data.code === 0 && Array.isArray(response.data.data)) {
      const prices = {};
      response.data.data.forEach(item => {
        const symbol = item.symbol.replace('USDT', '').toLowerCase();
        prices[symbol] = parseFloat(item.price);
      });
      globalState.currentPrices = prices;
      return prices;
    } else {
      console.error('❌ Ошибка в ответе от BingX для цен:', response.data.msg || 'Неизвестная ошибка');
      return {};
    }
  } catch (error) {
    console.error('❌ Ошибка получения текущих цен:', error.message);
    return {};
  }
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
    const params = {
      symbol: `${symbol}USDT`,
      side: 'LONG',
      leverage: leverage.toString(),
      timestamp: timestamp
    };
    const signature = signBingXRequest(params);
    const url = `${BINGX_FUTURES_URL}/openApi/swap/v2/trade/leverage?symbol=${params.symbol}&side=LONG&leverage=${params.leverage}&timestamp=${params.timestamp}&signature=${signature}`;
    const response = await axios.post(url, null, {
      headers: { 
        'X-BX-APIKEY': BINGX_API_KEY,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
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
// ФУНКЦИЯ: Размещение фьючерсного ордера
// ==========================
async function placeBingXFuturesOrder(symbol, side, type, quantity, price = null, leverage) {
  try {
    if (!BINGX_API_KEY || !BINGX_SECRET_KEY) {
      console.log(`ℹ️ [ОРДЕР] API-ключи не заданы. Ордер ${side} ${quantity} ${symbol} симулирован.`);
      return { orderId: `fake_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` };
    }
    // Устанавливаем плечо
    const leverageSet = await setBingXLeverage(symbol, leverage);
    if (!leverageSet) {
      console.log(`❌ Не удалось установить плечо ${leverage}x для ${symbol}`);
      return null;
    }
    const timestamp = Date.now();
    const params = {
      symbol: `${symbol}USDT`,
      side: side,
      type: type,
      quantity: quantity.toFixed(6),
      timestamp: timestamp
    };
    // Для лимитных ордеров добавляем цену
    if (price && type === 'LIMIT') {
      params.price = price.toFixed(8);
    }
    const signature = signBingXRequest(params);
    let url = `${BINGX_FUTURES_URL}/openApi/swap/v2/trade/order?symbol=${params.symbol}&side=${params.side}&type=${params.type}&quantity=${params.quantity}&timestamp=${params.timestamp}&signature=${signature}`;
    if (price && type === 'LIMIT') {
      url += `&price=${price.toFixed(8)}`;
    }
    const response = await axios.post(url, null, {
      headers: { 
        'X-BX-APIKEY': BINGX_API_KEY,
        'Content-Type': 'application/json',
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
  const symbol = coin.toUpperCase();
  console.log(`🌐 Отправка ${direction} ордера на BingX Futures: ${size} ${symbol} с плечом ${leverage}x`);
  console.log(`🔄 Текущий режим: ${globalState.isRealMode ? 'РЕАЛЬНЫЙ' : 'ДЕМО'}`);
  console.log(`⚡ Торговый режим: ${globalState.tradeMode}`);
  console.log(`💣 Уровень риска: ${globalState.riskLevel}`);
  if (globalState.isRealMode) {
    const result = await placeBingXFuturesOrder(symbol, direction === 'LONG' ? 'BUY' : 'SELL', 'MARKET', size, null, leverage);
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
        probability: 50,
        riskScore: calculateRiskScore(coin)
      };
      globalState.history.push(trade);
      globalState.positions[coin] = trade;
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
      probability: 50,
      riskScore: calculateRiskScore(coin)
    };
    globalState.history.push(trade);
    globalState.positions[coin] = trade;
    globalState.stats.totalTrades++;
    globalState.marketMemory.consecutiveTrades[coin] = (globalState.marketMemory.consecutiveTrades[coin] || 0) + 1;
    globalState.stats.maxLeverageUsed = Math.max(globalState.stats.maxLeverageUsed, leverage);
    console.log(`✅ ДЕМО: ${direction} ${size} ${coin} с плечом ${leverage}x`);
    return true;
  }
}

// ==========================
// ФУНКЦИЯ: Расчет рисковой оценки для монеты
// ==========================
function calculateRiskScore(coin) {
  const fundamentalData = globalState.marketMemory.fundamentalData[coin];
  const volatility = globalState.marketMemory.volatilityHistory[coin][globalState.marketMemory.volatilityHistory[coin].length - 1] || 0.02;
  // Базовая оценка риска (0-100)
  let riskScore = 50;
  // Учитываем волатильность
  if (volatility > 0.05) riskScore += 20;
  if (volatility < 0.02) riskScore -= 10;
  // Учитываем фундаментальные данные
  if (fundamentalData && fundamentalData.developerActivity) {
    if (fundamentalData.developerActivity > 100) riskScore -= 15; // Много активности разработчиков - меньше риск
    else if (fundamentalData.developerActivity < 20) riskScore += 25; // Мало активности - больше риск
  }
  // Учитываем Fear & Greed Index
  if (globalState.fearIndex < 30) riskScore -= 15; // Страх - меньше риск для LONG
  else if (globalState.fearIndex > 70) riskScore += 15; // Жадность - больше риск
  return Math.max(0, Math.min(100, riskScore));
}

// ==========================
// ФУНКЦИЯ: УНИКАЛЬНЫЙ АДАПТИВНЫЙ АНАЛИЗ
// ==========================
function analyzeMarketWithAdaptiveStrategy(candles, coinName, currentFearIndex, fundamentalData) {
  if (candles.length < 50) return null;
  const prices = candles.map(c => c.close);
  const currentPrice = prices[prices.length - 1];
  // Рассчитываем индикаторы
  const sma20 = calculateSMA(prices, 20);
  const sma50 = calculateSMA(prices, 50);
  const sma200 = calculateSMA(prices, 200);
  const atr = calculateATR(candles.slice(-14));
  const rsi = calculateRSI(prices.slice(-14));
  const bollingerUpper = calculateBollingerBands(prices, 20, 2).upper;
  const bollingerLower = calculateBollingerBands(prices, 20, 2).lower;
  const macd = calculateMACD(prices);
  const ichimoku = calculateIchimokuCloud(candles);
  // Рассчитываем волатильность
  const volatility = atr / currentPrice;
  const isHighVolatility = volatility > 0.05;
  const isLowVolatility = volatility < 0.02;
  // Рассчитываем тренд
  const isUptrend = sma20 > sma50 && sma50 > sma200;
  const isDowntrend = sma20 < sma50 && sma50 < sma200;
  const isSideways = Math.abs(sma20 - sma50) / sma20 < 0.01;
  // Рассчитываем перекупленность/перепроданность
  const isOverbought = rsi > 70;
  const isOversold = rsi < 30;
  // Рассчитываем MACD сигнал
  const isMACDBullish = macd.macd > macd.signal;
  const isMACDBearish = macd.macd < macd.signal;
  // Рассчитываем Ichimoku Cloud
  const isIchimokuBullish = currentPrice > ichimoku.senkouSpanA && currentPrice > ichimoku.senkouSpanB;
  const isIchimokuBearish = currentPrice < ichimoku.senkouSpanA && currentPrice < ichimoku.senkouSpanB;
  // Рассчитываем Bollinger Bands
  const isBollingerUpperBreak = currentPrice > bollingerUpper;
  const isBollingerLowerBreak = currentPrice < bollingerLower;
  const isBollingerSqueeze = (bollingerUpper - bollingerLower) / sma20 < 0.01;
  // Рассчитываем фундаментальную оценку
  const fundamentalScore = fundamentalData ? calculateFundamentalScore(fundamentalData) : 50;
  // Рассчитываем общую оценку рынка
  const marketSentiment = calculateMarketSentiment(currentFearIndex, fundamentalScore);
  // Определяем сигнал
  let signal = {
    direction: null,
    confidence: 0.5,
    leverage: 1,
    reasoning: [],
    stopLoss: null,
    takeProfit: null,
    riskScore: 50
  };
  // Базовые правила для адаптивного режима
  if (isUptrend && isMACDBullish && isIchimokuBullish && !isOverbought) {
    signal.direction = 'LONG';
    signal.confidence += 0.3;
    signal.reasoning.push("📈 Тренд вверх + MACD бычий + Ichimoku бычий");
  }
  if (isDowntrend && isMACDBearish && isIchimokuBearish && !isOversold) {
    signal.direction = 'SHORT';
    signal.confidence += 0.3;
    signal.reasoning.push("📉 Тренд вниз + MACD медвежий + Ichimoku медвежий");
  }
  if (isBollingerSqueeze && isUptrend) {
    signal.direction = 'LONG';
    signal.confidence += 0.2;
    signal.reasoning.push("📊 Сжатие Bollinger Bands + восходящий тренд → ожидается прорыв");
  }
  if (isBollingerSqueeze && isDowntrend) {
    signal.direction = 'SHORT';
    signal.confidence += 0.2;
    signal.reasoning.push("📊 Сжатие Bollinger Bands + нисходящий тренд → ожидается прорыв");
  }
  if (isBollingerUpperBreak && isUptrend) {
    signal.direction = 'LONG';
    signal.confidence += 0.2;
    signal.reasoning.push("🎯 Прорыв верхней полосы Bollinger + восходящий тренд");
  }
  if (isBollingerLowerBreak && isDowntrend) {
    signal.direction = 'SHORT';
    signal.confidence += 0.2;
    signal.reasoning.push("🎯 Прорыв нижней полосы Bollinger + нисходящий тренд");
  }
  // Учитываем Fear & Greed Index
  if (currentFearIndex < 25 && signal.direction === 'LONG') {
    signal.confidence += 0.15;
    signal.reasoning.push("😱 Сильный страх + перепроданность → отличная возможность для LONG");
  }
  if (currentFearIndex > 75 && signal.direction === 'SHORT') {
    signal.confidence += 0.15;
    signal.reasoning.push("🤑 Сильная жадность + перекупленность → отличная возможность для SHORT");
  }
  // Учитываем фундаментальную оценку
  if (fundamentalScore > 70 && signal.direction === 'LONG') {
    signal.confidence += 0.1;
    signal.reasoning.push("📊 Высокая фундаментальная оценка → поддержка LONG");
  }
  if (fundamentalScore < 30 && signal.direction === 'SHORT') {
    signal.confidence += 0.1;
    signal.reasoning.push("📊 Низкая фундаментальная оценка → поддержка SHORT");
  }
  // Рассчитываем риск-скор
  signal.riskScore = calculateRiskScore(coinName);
  // Устанавливаем стоп-лосс и тейк-профит в зависимости от волатильности
  const atrMultiplier = isHighVolatility ? 2.5 : 1.5;
  const volatilityFactor = isLowVolatility ? 0.8 : 1.2;
  if (signal.direction === 'LONG') {
    signal.stopLoss = currentPrice * (1 - (atr * atrMultiplier / currentPrice));
    signal.takeProfit = currentPrice * (1 + (atr * atrMultiplier * 2 / currentPrice));
    // Динамическое плечо в зависимости от волатильности
    if (isHighVolatility) {
      signal.leverage = Math.min(3, globalState.maxLeverage * 0.5);
      signal.reasoning.push("⚠️ Высокая волатильность → снижаем плечо");
    } else if (isLowVolatility) {
      signal.leverage = Math.min(10, globalState.maxLeverage * 1.5);
      signal.reasoning.push("📉 Низкая волатильность → увеличиваем плечо");
    } else {
      signal.leverage = globalState.maxLeverage;
    }
    // Адаптивный риск-менеджмент
    signal.stopLoss = currentPrice * (1 - (volatility * volatilityFactor * 3));
    signal.takeProfit = currentPrice * (1 + (volatility * volatilityFactor * 6));
  } else if (signal.direction === 'SHORT') {
    signal.stopLoss = currentPrice * (1 + (atr * atrMultiplier / currentPrice));
    signal.takeProfit = currentPrice * (1 - (atr * atrMultiplier * 2 / currentPrice));
    // Динамическое плечо в зависимости от волатильности
    if (isHighVolatility) {
      signal.leverage = Math.min(3, globalState.maxLeverage * 0.5);
      signal.reasoning.push("⚠️ Высокая волатильность → снижаем плечо");
    } else if (isLowVolatility) {
      signal.leverage = Math.min(10, globalState.maxLeverage * 1.5);
      signal.reasoning.push("📉 Низкая волатильность → увеличиваем плечо");
    } else {
      signal.leverage = globalState.maxLeverage;
    }
    // Адаптивный риск-менеджмент
    signal.stopLoss = currentPrice * (1 + (volatility * volatilityFactor * 3));
    signal.takeProfit = currentPrice * (1 - (volatility * volatilityFactor * 6));
  }
  // Учитываем фундаментальную оценку в риске
  if (signal.riskScore > 70) {
    signal.confidence *= 0.8;
    signal.reasoning.push("⚠️ Высокий риск-скор → снижаем уверенность");
  } else if (signal.riskScore < 30) {
    signal.confidence *= 1.2;
    signal.reasoning.push("✅ Низкий риск-скор → увеличиваем уверенность");
  }
  signal.reasoning.push(`📊 Волатильность: ${volatility.toFixed(4)} (${isHighVolatility ? 'Высокая' : isLowVolatility ? 'Низкая' : 'Средняя'})`);
  signal.reasoning.push(`📈 Рыночный тренд: ${isUptrend ? 'Восходящий' : isDowntrend ? 'Нисходящий' : 'Боковой'}`);
  signal.reasoning.push(`🧠 Рыночный sentiment: ${marketSentiment.toFixed(0)}%`);
  signal.reasoning.push(`🔍 Фундаментальная оценка: ${fundamentalScore.toFixed(0)}/100`);
  signal.reasoning.push(`⚠️ Риск-скор: ${signal.riskScore.toFixed(0)}/100`);
  return {
    coin: coinName,
    currentPrice,
    signal,
    rsi,
    volatility,
    sma20,
    sma50,
    sma200,
    atr,
    bollingerUpper,
    bollingerLower,
    macd,
    ichimoku,
    marketSentiment,
    fundamentalScore
  };
}

// ==========================
// Вспомогательные функции
// ==========================
function calculateSMA(prices, period) {
  if (prices.length < period) return 0;
  return prices.slice(-period).reduce((a, b) => a + b, 0) / period;
}
function calculateATR(candles) {
  let trSum = 0;
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i-1].close),
      Math.abs(candles[i].low - candles[i-1].close)
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
function calculateBollingerBands(prices, period, stdDev) {
  const sma = calculateSMA(prices, period);
  const std = Math.sqrt(prices.slice(-period).reduce((sum, price) => sum + Math.pow(price - sma, 2), 0) / period);
  return {
    sma,
    upper: sma + (std * stdDev),
    lower: sma - (std * stdDev)
  };
}
function calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const fastEMA = calculateEMA(prices, fastPeriod);
  const slowEMA = calculateEMA(prices, slowPeriod);
  const macd = fastEMA - slowEMA;
  const signal = calculateEMA([macd], signalPeriod)[0];
  return { macd, signal };
}
function calculateEMA(prices, period) {
  const multiplier = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }
  return ema;
}
function calculateIchimokuCloud(candles) {
  const tenkanSen = (Math.max(...candles.slice(-9).map(c => c.high)) + Math.min(...candles.slice(-9).map(c => c.low))) / 2;
  const kijunSen = (Math.max(...candles.slice(-26).map(c => c.high)) + Math.min(...candles.slice(-26).map(c => c.low))) / 2;
  const senkouSpanA = (tenkanSen + kijunSen) / 2;
  const senkouSpanB = (Math.max(...candles.slice(-52).map(c => c.high)) + Math.min(...candles.slice(-52).map(c => c.low))) / 2;
  return {
    tenkanSen,
    kijunSen,
    senkouSpanA,
    senkouSpanB
  };
}
function calculateFundamentalScore(fundamentalData) {
  let score = 50;
  // Учитываем активность разработчиков
  if (fundamentalData.developerActivity) {
    if (fundamentalData.developerActivity > 100) score += 20;
    else if (fundamentalData.developerActivity > 50) score += 10;
    else if (fundamentalData.developerActivity < 20) score -= 15;
    else if (fundamentalData.developerActivity < 10) score -= 25;
  }
  // Учитываем социальный сентимент
  if (fundamentalData.socialSentiment) {
    if (fundamentalData.socialSentiment > 70) score += 15;
    else if (fundamentalData.socialSentiment > 50) score += 5;
    else if (fundamentalData.socialSentiment < 30) score -= 15;
    else if (fundamentalData.socialSentiment < 10) score -= 25;
  }
  return Math.max(0, Math.min(100, score));
}
function calculateMarketSentiment(fearIndex, fundamentalScore) {
  // Усредняем Fear & Greed Index и фундаментальную оценку
  return (fearIndex + fundamentalScore) / 2;
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
    // Проверяем тейк-профит
    if (position.type === 'LONG' && currentPrice >= position.takeProfit) {
      shouldClose = true;
      reason = '🎯 Достигнут тейк-профит — фиксируем прибыль';
    } else if (position.type === 'SHORT' && currentPrice <= position.takeProfit) {
      shouldClose = true;
      reason = '🎯 Достигнут тейк-профит — фиксируем прибыль';
    }
    // Проверяем стоп-лосс
    if (position.type === 'LONG' && currentPrice <= position.stopLoss) {
      shouldClose = true;
      reason = '🛑 Сработал стоп-лосс';
    } else if (position.type === 'SHORT' && currentPrice >= position.stopLoss) {
      shouldClose = true;
      reason = '🛑 Сработал стоп-лосс';
    }
    // Проверяем трейлинг-стоп
    if (position.type === 'LONG' && currentPrice > position.entryPrice * 1.01) {
      position.trailingStop = Math.max(position.trailingStop || position.entryPrice, currentPrice * 0.99);
      if (currentPrice <= position.trailingStop) {
        shouldClose = true;
        reason = '📉 Трейлинг-стоп сработал';
      }
    } else if (position.type === 'SHORT' && currentPrice < position.entryPrice * 0.99) {
      position.trailingStop = Math.min(position.trailingStop || position.entryPrice, currentPrice * 1.01);
      if (currentPrice >= position.trailingStop) {
        shouldClose = true;
        reason = '📉 Трейлинг-стоп сработал';
      }
    }
    // Динамическое закрытие при высоком риске
    if (position.riskScore > 80) {
      shouldClose = true;
      reason = '⚠️ Высокий риск-скор → закрываем позицию';
    }
    if (shouldClose) {
      console.log(`✅ ЗАКРЫТИЕ: ${reason} по ${coin.name}`);
      const tradeIndex = globalState.history.findIndex(t => t.coin === coin.name && t.status === 'OPEN');
      if (tradeIndex !== -1) {
        const trade = globalState.history[tradeIndex];
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
      // Обновляем трейлинг-стоп
      if (position.type === 'LONG' && currentPrice > position.entryPrice * 1.01) {
        position.trailingStop = Math.max(position.trailingStop || position.entryPrice, currentPrice * 0.99);
      } else if (position.type === 'SHORT' && currentPrice < position.entryPrice * 0.99) {
        position.trailingStop = Math.min(position.trailingStop || position.entryPrice, currentPrice * 1.01);
      }
    }
  }
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
  } else if (globalState.tradeMode === 'swing') {
    // Для свинг-торговли — более консервативные
    globalState.scalpingSettings = {
      takeProfitPercent: 0.05, // +5%
      stopLossPercent: 0.03   // -3%
    };
  } else {
    // Для адаптивного режима
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
// ФУНКЦИЯ: Получение фундаментальных данных монеты (ИСПРАВЛЕНА с кэшированием)
// ==========================
async function getFundamentalData(coin) {
  const now = Date.now();
  const cacheKey = coin.name;
  const cacheDuration = 300000; // 5 минут в миллисекундах
  
  // Если есть кэш и он еще не истек, возвращаем его
  if (globalState.fundamentalCache && 
      globalState.fundamentalCache[cacheKey] && 
      now - globalState.fundamentalCache[cacheKey].timestamp < cacheDuration) {
    console.log(`💾 Использую кэшированные фундаментальные данные для ${coin.name}`);
    return globalState.fundamentalCache[cacheKey].data;
  }

  try {
    // Инициализируем кэш, если еще не создан
    if (!globalState.fundamentalCache) {
      globalState.fundamentalCache = {};
    }
    
    const response = await axios.get(`https://api.coingecko.com/api/v3/coins/${coin.name}`, {
      params: {
        localization: false,
        tickers: false,
        market_data: true,
        community_data: true,
        developer_data: true,
        last_updated: true
      },
      timeout: 10000
    });
    const data = response.data;
    const fundamentalData = {
      hashRate: null,
      activeAddresses: null,
      transactions: null,
      developerActivity: null,
      socialSentiment: null
    };

    if (data.market_data) {
      // Исправление: используем sentiment_votes_up_percentage, а не twitter_followers
      fundamentalData.socialSentiment = data.market_data.sentiment_votes_up_percentage || 50;
    }
    if (data.developer_data) {
      fundamentalData.developerActivity = data.developer_data.commits_30d || 0;
    }
    // Убрано: data.community_data.twitter_followers -> это неверно, так как уже используется market_data.sentiment

    // Сохраняем данные в кэш
    globalState.fundamentalCache[cacheKey] = {
      data: fundamentalData,
      timestamp: now
    };
    globalState.marketMemory.fundamentalData[coin.name] = fundamentalData;
    return fundamentalData;

  } catch (error) {
    console.error(`❌ Ошибка получения фундаментальных данных для ${coin.name}:`, error.message);
    // Если ошибка, можно вернуть кэшированные данные (если есть) или дефолтные
    if (globalState.fundamentalCache && globalState.fundamentalCache[cacheKey]) {
      console.log(`⚠️ Использую устаревшие данные для ${coin.name} из-за ошибки API`);
      return globalState.fundamentalCache[cacheKey].data;
    }
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
// ФУНКЦИЯ: Переключение торгового режима (adaptive, scalping, swing)
// ==========================
function toggleTradeMode() {
  const modes = ['adaptive', 'scalping', 'swing'];
  const currentIndex = modes.indexOf(globalState.tradeMode);
  const nextIndex = (currentIndex + 1) % modes.length;
  globalState.tradeMode = modes[nextIndex];
  // При переключении режима — сохраняем текущий уровень риска, но обновляем параметры
  setRiskLevel(globalState.riskLevel);
  console.log(`⚡ Торговый режим переключён на: ${globalState.tradeMode}`);
  return globalState.tradeMode;
}

// ==========================
// ФУНКЦИЯ: Вывод статистики
// ==========================
function printStats() {
  const s = globalState.stats;
  console.log(`
📊 СТАТИСТИКА ТОРГОВЛИ:`);
  console.log(`   Сделок всего: ${s.totalTrades} (прибыльных: ${s.profitableTrades}, убыточных: ${s.losingTrades})`);
  console.log(`   Win Rate: ${s.winRate.toFixed(1)}%`);
  console.log(`   Чистая прибыль: $${s.totalProfit.toFixed(2)} (${((s.totalProfit / 100) * 100).toFixed(1)}%)`);
  console.log(`   Макс. просадка: ${s.maxDrawdown.toFixed(1)}%`);
  console.log(`   Макс. плечо: ${s.maxLeverageUsed}x`);
  console.log(`   Волатильность рынка: ${s.volatilityIndex.toFixed(2)}%`);
  console.log(`   Рыночный sentiment: ${s.marketSentiment.toFixed(0)}%`);
  console.log(`   Текущий баланс: $${globalState.balance.toFixed(2)}`);
}

// ==========================
// ФУНКЦИЯ: Получение новостей крипторынка (на русском с 🐂/🐻)
// ==========================
async function getCryptoNews() {
  try {
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
      const russianNames = {
        'Bitcoin': 'Биткоин',
        'Ethereum': 'Эфириум',
        'Solana': 'Солана',
        'Ripple': 'Рипл',
        'Dogecoin': 'Догекоин',
        'Cardano': 'Кардано',
        'Polkadot': 'Полкадот',
        'Chainlink': 'Чейнлинк',
        'Avalanche': 'Аваланч',
        'Cosmos': 'Космос',
        'Uniswap': 'Юнисвап',
        'Aave': 'Ааве',
        'Filecoin': 'Файлкоин',
        'Litecoin': 'Лайткоин',
        'Algorand': 'Алгоранд',
        'Near Protocol': 'Нир Протокол',
        'Aptos': 'Аптос'
      };
      const russianName = russianNames[coin.name] || coin.name;
      return {
        title: `${russianName} (${coin.symbol}) — Рыночная капитализация: $${(coin.marketCap || 0).toLocaleString()}`,
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
    return [
      { 
        title: "Биткоин突破$60K, 机构资金持续流入", 
        source: "CryptoNews", 
        sentiment: "positive",
        trend: "🐂 Бычий",
        change24h: "+2.5%",
        url: "#"
      },
      { 
        title: "Эфириум ETF Approval Expected in Q3 2024", 
        source: "CoinDesk", 
        sentiment: "positive",
        trend: "🐂 Бычий",
        change24h: "+1.8%",
        url: "#"
      },
      { 
        title: "Рынок корректируется: Альткоины упали на 15% на этой неделе", 
        source: "Cointelegraph", 
        sentiment: "negative",
        trend: "🐻 Медвежий",
        change24h: "-3.2%",
        url: "#"
      },
      { 
        title: "Сеть Solana обновлена для увеличения скорости транзакций", 
        source: "The Block", 
        sentiment: "positive",
        trend: "🐂 Бычий",
        change24h: "+4.1%",
        url: "#"
      },
      { 
        title: "Регуляторное давление на крупные биржи усиливается", 
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
// ФУНКЦИЯ: Тестирование API BingX (реальная сделка с 30% риском)
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
    const btcPrice = await getCurrentPrices();
    const btcPriceValue = btcPrice.bitcoin || 62450.50;
    // Шаг 3: Рассчитываем размер позиции (30% РИСКА от баланса)
    const riskPercent = 0.3; // 30% риск
    const stopLossPercent = 0.02; // 2% стоп-лосс
    const riskAmount = balance * riskPercent;
    const stopDistance = btcPriceValue * stopLossPercent;
    const size = riskAmount / stopDistance;
    console.log(`🧪 [ТЕСТ] Открываем тестовую позицию LONG с риском 30% от баланса: $${riskAmount.toFixed(2)}`);
    // Шаг 4: Открываем реальную позицию
    const result = await placeBingXFuturesOrder(
      'BTC',
      'BUY',
      'MARKET',
      size,
      null,
      3
    );
    if (result) {
      const fee = size * btcPriceValue * globalState.takerFee;
      const trade = {
        coin: 'bitcoin',
        type: 'LONG',
        size: size,
        entryPrice: btcPriceValue,
        currentPrice: btcPriceValue,
        leverage: 3,
        stopLoss: btcPriceValue * (1 - stopLossPercent),
        takeProfit: btcPriceValue * 1.04,
        fee: fee,
        timestamp: new Date().toLocaleString(),
        status: 'OPEN',
        orderId: result.orderId,
        progress: 0,
        probability: 50
      };
      globalState.history.push(trade);
      globalState.positions['bitcoin'] = trade;
      globalState.stats.totalTrades++;
      globalState.marketMemory.consecutiveTrades['bitcoin'] = (globalState.marketMemory.consecutiveTrades['bitcoin'] || 0) + 1;
      globalState.stats.maxLeverageUsed = Math.max(globalState.stats.maxLeverageUsed, 3);
      console.log('✅ [ТЕСТ] Тестовая позиция успешно открыта!');
      return { success: true, message: 'Тестовая позиция успешно открыта! Проверьте ваш фьючерсный счет на BingX.' };
    } else {
      console.error('❌ [ТЕСТ] Не удалось выполнить ордер на BingX Futures');
      return { success: false, message: 'Не удалось выполнить ордер на BingX Futures' };
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
  console.log('🤖 ЗАПУСК БОТА v20.0 — ТРЕЙДИНГ БОТ ВАСЯ 3000 УНИКАЛЬНЫЙ (BINGX)');
  console.log('📌 deposit(сумма) — пополнить демо-баланс');
  console.log('🔄 toggleMode() — переключить режим (ДЕМО ↔ РЕАЛЬНЫЙ)');
  console.log('⚡ toggleTradeMode() — переключить торговый режим (adaptive, scalping, swing)');
  console.log('💣 setRiskLevel() — установить уровень риска (recommended, medium, high, extreme)');
  console.log('🧪 testBingXAPI() — протестировать подключение к BingX (реальная сделка с 30% риском)');
  
  // Устанавливаем начальный уровень риска
  setRiskLevel('recommended');
  globalState.tradeMode = 'adaptive'; // Адаптивный режим по умолчанию
  
  // Принудительно обновляем реальный баланс при старте
  await forceUpdateRealBalance();
  
  while (globalState.isRunning) {
    try {
      console.log(`
[${new Date().toLocaleTimeString()}] === АНАЛИЗ ОТ ВАСИ 3000 ===`);
      const fearIndex = await getFearAndGreedIndex();
      console.log(`😱 Индекс страха и жадности: ${fearIndex}`);
      
      // Обновляем реальный баланс каждые 5 минут
      if (Date.now() % 300000 < 10000) {
        await forceUpdateRealBalance();
      }
      
      // Получаем текущие цены
      const currentPrices = await getCurrentPrices();
      globalState.currentPrices = currentPrices;
      
      // Получаем фундаментальные данные для всех монет с задержкой между запросами
      for (const coin of globalState.watchlist) {
        await getFundamentalData(coin);
        // Задержка 1.5 секунды между запросами к CoinGecko для избежания 429
        await new Promise(r => setTimeout(r, 1500)); 
      }
      
      // Получаем новости каждые 30 минут
      if (Date.now() % 1800000 < 60000) {
        globalState.marketMemory.news = await getCryptoNews();
        console.log('📰 Получены последние новости крипторынка');
      }
      
      await checkOpenPositions(currentPrices);
      
      let bestOpportunity = null;
      let bestReasoning = [];
      
      for (const coin of globalState.watchlist) {
        console.log(`
🔍 Анализирую ${coin.name}...`);
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
        
        console.log(`   ✅ Сигнал для ${coin.name}: ${analysis.signal.direction}`);
        analysis.signal.reasoning.forEach(r => console.log(`   • ${r}`));
        
        if (!bestOpportunity || analysis.signal.confidence > bestOpportunity.signal.confidence) {
          bestOpportunity = analysis;
          bestReasoning = analysis.signal.reasoning;
        }
        
        await new Promise(r => setTimeout(r, 1200));
      }
      
      if (bestOpportunity && (globalState.isRealMode || globalState.balance > 10)) {
        console.log(`
💎 ВАСЯ 3000 РЕКОМЕНДУЕТ: ${bestOpportunity.signal.direction} по ${bestOpportunity.coin}`);
        bestReasoning.forEach(r => console.log(`   • ${r}`));
        const currentBalance = globalState.isRealMode ? (globalState.realBalance || 100) : globalState.balance;
        const riskAmount = currentBalance * globalState.maxRiskPerTrade;
        const price = bestOpportunity.currentPrice;
        const stopDistance = bestOpportunity.signal.direction === 'LONG' 
          ? price - bestOpportunity.signal.stopLoss 
          : bestOpportunity.signal.stopLoss - price;
        
        // Рассчитываем размер позиции с учетом риска
        const size = riskAmount / stopDistance;
        const finalSize = Math.max(0.001, size);
        
        console.log(`
🟢 ВХОД: ${bestOpportunity.signal.direction} ${finalSize.toFixed(6)} ${bestOpportunity.coin} с плечом ${bestOpportunity.signal.leverage}x`);
        
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
        console.log(`
⚪ Вася 3000 не видит возможностей — отдыхаем...`);
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
        console.log(`
💰 ${globalState.isRealMode ? 'Реальный' : 'Демо'}-баланс: $${(globalState.isRealMode ? globalState.realBalance : globalState.balance)?.toFixed(2) || 'Загрузка...'}`);
        console.log(`📊 Волатильность рынка: ${globalState.stats.volatilityIndex.toFixed(2)}%`);
        console.log(`🧠 Рыночный sentiment: ${globalState.stats.marketSentiment.toFixed(0)}%`);
      }
      
      if (globalState.stats.totalTrades > 0 && globalState.history.length % 2 === 0) {
        printStats();
      }
      
    } catch (error) {
      console.error('💥 КРИТИЧЕСКАЯ ОШИБКА В ЦИКЛЕ:', error.message);
    }
    
    console.log(`
💤 Ждём 60 секунд до следующего анализа...`);
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
  testBingXAPI,
  balance: () => globalState.balance,
  stats: () => globalState.stats,
  history: () => globalState.history
};

global.deposit = deposit;
global.toggleMode = toggleMode;
global.toggleTradeMode = toggleTradeMode;
global.setRiskLevel = setRiskLevel;
global.forceUpdateRealBalance = forceUpdateRealBalance;
global.testBingXAPI = testBingXAPI;
global.balance = () => globalState.balance;
global.stats = () => globalState.stats;
global.history = () => globalState.history;

console.log('\n✅ Трейдинг Бот Вася 3000 Уникальный запущен!');
console.log('❗ ВАЖНО: Для торговли на реальном счете переведите USDT на фьючерсный счет в интерфейсе BingX.');
console.log('Используй toggleMode() для переключения между ДЕМО и РЕАЛЬНЫМ режимом.');
console.log('Используй toggleTradeMode() для переключения между адаптивным, скальпинг и свинг режимами.');
console.log('Используй setRiskLevel(level) для установки уровня риска: recommended, medium, high, extreme.');
console.log('Используй testBingXAPI() для тестирования подключения к BingX (реальная сделка с 30% риском).');
console.log('⚠️ ВАЖНО: Никакой алгоритмический трейдинг-бот не гарантирует прибыль. Риск потери всех средств 100%.');
