const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const CryptoJS = require('crypto-js');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const dotenv = require('dotenv');

// Загружаем переменные окружения
dotenv.config();

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
    fundamentalData: {}
  },
  isRunning: true,
  takerFee: 0.0005,
  makerFee: 0.0002,
  maxRiskPerTrade: 0.01,
  maxLeverage: 3,
  // Только актуальные монеты на BingX
  watchlist: [
    { symbol: 'BTC-USDT', name: 'bitcoin' },
    { symbol: 'ETH-USDT', name: 'ethereum' },
    { symbol: 'SOL-USDT', name: 'solana' },
    { symbol: 'XRP-USDT', name: 'ripple' },
    { symbol: 'ADA-USDT', name: 'cardano' },
    { symbol: 'DOT-USDT', name: 'polkadot' },
    { symbol: 'DOGE-USDT', name: 'dogecoin' },
    { symbol: 'MATIC-USDT', name: 'polygon' },
    { symbol: 'LTC-USDT', name: 'litecoin' },
    { symbol: 'BCH-USDT', name: 'bitcoin-cash' },
    { symbol: 'UNI-USDT', name: 'uniswap' },
    { symbol: 'LINK-USDT', name: 'chainlink' },
    { symbol: 'AAVE-USDT', name: 'aave' },
    { symbol: 'AVAX-USDT', name: 'avalanche' },
    { symbol: 'ATOM-USDT', name: 'cosmos' },
    { symbol: 'BNB-USDT', name: 'binancecoin' },
    { symbol: 'APT-USDT', name: 'aptos' },
    { symbol: 'ARB-USDT', name: 'arbitrum' },
    { symbol: 'OP-USDT', name: 'optimism' },
    { symbol: 'TON-USDT', name: 'the-open-network' },
    { symbol: 'SHIB-USDT', name: 'shiba-inu' },
    { symbol: 'PEPE-USDT', name: 'pepe' },
    { symbol: 'RUNE-USDT', name: 'thorchain' },
    { symbol: 'INJ-USDT', name: 'injective-protocol' },
    { symbol: 'WLD-USDT', name: 'worldcoin' },
    { symbol: 'SEI-USDT', name: 'sei-network' },
    { symbol: 'TIA-USDT', name: 'celestia' },
    { symbol: 'ONDO-USDT', name: 'ondo-finance' },
    { symbol: 'JUP-USDT', name: 'jupiter-exchange-solana' },
    { symbol: 'STRK-USDT', name: 'starknet' },
    { symbol: 'ENA-USDT', name: 'ethena' },
    { symbol: 'RENDER-USDT', name: 'render-token' }
  ],
  isRealMode: false,
  tradeMode: 'adaptive',
  riskLevel: 'recommended',
  currentPrices: {},
  fearIndex: 50,
  bingxCache: {},
  fundamentalCache: {}
};

globalState.watchlist.forEach(coin => {
  globalState.positions[coin.name] = null;
  globalState.marketMemory.lastTrades[coin.name] = [];
  globalState.marketMemory.consecutiveTrades[coin.name] = 0;
  globalState.marketMemory.volatilityHistory[coin.name] = [];
  globalState.marketMemory.fundamentalData[coin.name] = {
    developerActivity: 50,
    socialSentiment: 50,
    marketCapRank: 100,
    communityGrowth: 0
  };
});

// ==========================
// КОНФИГУРАЦИЯ BINGX API
// ==========================
const BINGX_API_KEY = process.env.BINGX_API_KEY;
const BINGX_SECRET_KEY = process.env.BINGX_SECRET_KEY;
const BINGX_FUTURES_URL = process.env.BINGX_API_DOMAIN || 'https://open-api.bingx.com';
const APP_PASSWORD = process.env.APP_PASSWORD || 'admin123';

// ==========================
// ПРОВЕРКА КРИТИЧЕСКИХ ПАРАМЕТРОВ
// ==========================
if (!BINGX_API_KEY || !BINGX_SECRET_KEY) {
  console.error('❌ КРИТИЧЕСКАЯ ОШИБКА: API-ключи не заданы!');
  console.error('Пожалуйста, установите переменные окружения BINGX_API_KEY и BINGX_SECRET_KEY');
  process.exit(1);
}

// ==========================
// ФУНКЦИЯ: Подпись запроса для BingX
// ==========================
function signBingXRequest(params) {
  const cleanParams = { ...params };
  delete cleanParams.signature;
  let paramString = "";
  // Сортируем ключи для согласованности (важно для некоторых API)
  const sortedKeys = Object.keys(cleanParams).sort();
  for (let i = 0; i < sortedKeys.length; i++) {
    const key = sortedKeys[i];
    if (paramString !== "") {
      paramString += "&";
    }
    if (key === 'timestamp') {
      paramString += `${key}=${cleanParams[key]}`;
    } else {
      paramString += `${key}=${encodeURIComponent(cleanParams[key])}`;
    }
  }
  return CryptoJS.HmacSHA256(paramString, BINGX_SECRET_KEY).toString(CryptoJS.enc.Hex);
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
// ФУНКЦИЯ: Получение серверного времени BingX
// ==========================
async function getBingXServerTime() {
  try {
    const response = await axios.get(`${BINGX_FUTURES_URL}/openApi/swap/v2/server/time`, {
      timeout: 10000
    });
    if (response.data.code === 0 && response.data.data && response.data.data.serverTime) {
      return response.data.data.serverTime;
    } else {
      console.error('❌ Ошибка получения серверного времени:', response.data.msg || 'Нет данных');
      return Date.now();
    }
  } catch (error) {
    console.error('❌ Ошибка получения серверного времени:', error.message);
    return Date.now();
  }
}

// ==========================
// ФУНКЦИЯ: Получение реального баланса
// ==========================
async function getBingXRealBalance() {
  try {
    console.log('🔍 [БАЛАНС] Запрос реального баланса...');
    const timestamp = Date.now();
    const params = { timestamp, recvWindow: 5000 };
    const signature = signBingXRequest(params);
    // ИСПРАВЛЕНО: Правильный эндпоинт для баланса
    const url = `${BINGX_FUTURES_URL}/openApi/swap/v2/user/balance?timestamp=${timestamp}&recvWindow=5000&signature=${signature}`;
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
      }
      if (usdtBalance !== null) {
        console.log(`💰 Баланс: $${usdtBalance.toFixed(2)}`);
        return usdtBalance;
      }
    }
    console.error('❌ Не найден баланс USDT. Ответ от BingX:', JSON.stringify(response.data));
    return null;
  } catch (error) {
    console.error('❌ Ошибка получения баланса:', error.message);
    if (error.response) {
      console.error('❌ Ответ от BingX:', JSON.stringify(error.response.data));
    }
    return null;
  }
}

// ==========================
// ФУНКЦИЯ: Получение исторических свечей
// ==========================
async function getBingXFuturesHistory(symbol, interval = '1h', limit = 100) {
  try {
    const serverTime = await getBingXServerTime();
    const timestamp = serverTime;
    const params = {
      symbol,
      interval,
      limit,
      timestamp,
      recvWindow: 5000
    };
    const signature = signBingXRequest(params);
    // ИСПРАВЛЕНО: Добавлен обязательный заголовок X-BX-APIKEY для приватного запроса
    const url = `${BINGX_FUTURES_URL}/openApi/swap/v2/quote/klines?symbol=${params.symbol}&interval=${params.interval}&limit=${params.limit}&timestamp=${params.timestamp}&recvWindow=5000&signature=${signature}`;
    console.log(`🌐 Получение истории для ${symbol}: GET ${url}`);
    const response = await axios.get(url, {
      headers: { 'X-BX-APIKEY': BINGX_API_KEY }, // <-- ДОБАВЛЕНО
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
      console.error(`❌ Ошибка для ${symbol}:`, response.data.msg || 'Нет данных');
      console.error('❌ Ответ от BingX:', JSON.stringify(response.data));
      return [];
    }
  } catch (error) {
    console.error(`❌ Ошибка получения истории для ${symbol}:`, error.message);
    if (error.response) {
      console.error('❌ Ответ от BingX:', JSON.stringify(error.response.data));
    }
    return [];
  }
}

// ==========================
// ФУНКЦИЯ: Получение текущих цен
// ==========================
async function getCurrentPrices() {
  try {
    const prices = {};
    const serverTime = await getBingXServerTime();
    for (const coin of globalState.watchlist) {
      const params = {
        symbol: coin.symbol,
        timestamp: serverTime,
        recvWindow: 5000
      };
      const signature = signBingXRequest(params);
      // ИСПРАВЛЕНО: Добавлен обязательный заголовок X-BX-APIKEY для приватного запроса
      const url = `${BINGX_FUTURES_URL}/openApi/swap/v2/quote/price?symbol=${params.symbol}&timestamp=${params.timestamp}&recvWindow=5000&signature=${signature}`;
      console.log(`🌐 Получение цены для ${coin.symbol}: GET ${url}`);
      try {
        const response = await axios.get(url, {
          headers: { 'X-BX-APIKEY': BINGX_API_KEY }, // <-- ДОБАВЛЕНО
          timeout: 10000
        });
        if (response.data.code === 0 && response.data.data && response.data.data.price) {
          const price = parseFloat(response.data.data.price);
          const cleanSymbol = coin.name;
          prices[cleanSymbol] = price;
          console.log(`✅ Цена для ${coin.symbol}: $${price}`);
        } else {
          console.error(`❌ Ошибка для ${coin.symbol}:`, response.data.msg || 'Нет данных о цене');
          console.error('❌ Ответ от BingX:', JSON.stringify(response.data));
        }
      } catch (error) {
        console.error(`❌ Не удалось получить цену для ${coin.symbol}:`, error.message);
        if (error.response) {
          console.error('❌ Ответ от BingX:', JSON.stringify(error.response.data));
        }
      }
      await new Promise(r => setTimeout(r, 500)); // Задержка между запросами
    }
    globalState.currentPrices = prices;
    return prices;
  } catch (error) {
    console.error('❌ Глобальная ошибка получения текущих цен:', error.message);
    return {};
  }
}

// ==========================
// ФУНКЦИЯ: Установка плеча
// ==========================
async function setBingXLeverage(symbol, leverage) {
  try {
    const serverTime = await getBingXServerTime();
    const timestamp = serverTime;
    const params = {
      symbol: symbol,
      side: 'BOTH', // ИСПРАВЛЕНО: BingX использует 'BOTH' для универсального плеча
      leverage: leverage.toString(),
      timestamp,
      recvWindow: 5000
    };
    const signature = signBingXRequest(params);
    // ИСПРАВЛЕНО: Правильный эндпоинт для установки плеча
    const url = `${BINGX_FUTURES_URL}/openApi/swap/v2/trade/leverage?symbol=${params.symbol}&side=${params.side}&leverage=${params.leverage}&timestamp=${params.timestamp}&recvWindow=5000&signature=${signature}`;
    const response = await axios.post(url, null, {
      headers: { 'X-BX-APIKEY': BINGX_API_KEY, 'Content-Type': 'application/json' },
      timeout: 10000
    });
    if (response.data.code === 0) {
      console.log(`✅ Плечо ${leverage}x установлено для ${symbol}`);
      return true;
    } else {
      console.error(`❌ Ошибка установки плеча для ${symbol}:`, response.data.msg);
      console.error('❌ Ответ от BingX:', JSON.stringify(response.data));
      return false;
    }
  } catch (error) {
    console.error(`💥 Ошибка установки плеча:`, error.message);
    if (error.response) {
      console.error('❌ Ответ от BingX:', JSON.stringify(error.response.data));
    }
    return false;
  }
}

// ==========================
// ФУНКЦИЯ: Размещение ордера
// ==========================
async function placeBingXFuturesOrder(symbol, side, type, quantity, price = null, positionSide) {
  try {
    const serverTime = await getBingXServerTime();
    const timestamp = serverTime;
    const params = {
      symbol: symbol,
      side: side,
      type: type,
      quantity: quantity.toFixed(6),
      timestamp: timestamp,
      positionSide: positionSide,
      recvWindow: 5000
    };
    if (price && (type === 'LIMIT' || type === 'TAKE_PROFIT' || type === 'STOP')) {
      params.price = price.toFixed(8);
    }
    const signature = signBingXRequest(params);
    let url = `${BINGX_FUTURES_URL}/openApi/swap/v2/trade/order?symbol=${params.symbol}&side=${params.side}&type=${params.type}&quantity=${params.quantity}&timestamp=${params.timestamp}&positionSide=${params.positionSide}&recvWindow=5000&signature=${signature}`;
    if (price && (type === 'LIMIT' || type === 'TAKE_PROFIT' || type === 'STOP')) {
      url += `&price=${price.toFixed(8)}`;
    }
    const response = await axios.post(url, null, {
      headers: { 'X-BX-APIKEY': BINGX_API_KEY, 'Content-Type': 'application/json' },
      timeout: 10000
    });
    if (response.data.code === 0) {
      console.log(`✅ УСПЕШНЫЙ ОРДЕР: ${side} ${quantity} ${symbol} (${positionSide})`);
      return response.data.data;
    } else {
      console.error(`❌ ОШИБКА ОРДЕРА:`, response.data.msg);
      console.error('❌ Ответ от BingX:', JSON.stringify(response.data));
      return null;
    }
  } catch (error) {
    console.error(`💥 Ошибка при размещении ордера:`, error.message);
    if (error.response) {
      console.error('❌ Ответ от BingX:', JSON.stringify(error.response.data));
    }
    return null;
  }
}

// ==========================
// ФУНКЦИЯ: Открытие позиции
// ==========================
async function openFuturesTrade(coin, direction, leverage, size, price, stopLoss, takeProfit) {
  const symbol = coin.symbol;
  const positionSide = direction; // Для BingX в режиме One-way mode, positionSide совпадает с direction
  const side = direction === 'LONG' ? 'BUY' : 'SELL';

  console.log(`🌐 Отправка ${direction} ордера на BingX: ${size} ${symbol} с плечом ${leverage}x`);
  console.log(`🔄 Текущий режим: ${globalState.isRealMode ? 'РЕАЛЬНЫЙ' : 'ДЕМО'}`);

  if (globalState.isRealMode) {
    // Устанавливаем плечо перед открытием позиции
    const leverageSet = await setBingXLeverage(symbol, leverage);
    if (!leverageSet) {
      console.log(`❌ Не удалось установить плечо ${leverage}x для ${symbol}`);
      return false;
    }

    const result = await placeBingXFuturesOrder(symbol, side, 'MARKET', size, null, positionSide);
    if (result) {
      const fee = size * price * globalState.takerFee;
      const trade = {
        coin: coin.name,
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
        riskScore: calculateRiskScore(coin.name)
      };
      globalState.history.push(trade);
      globalState.positions[coin.name] = trade;
      globalState.stats.totalTrades++;
      console.log(`✅ УСПЕШНО: ${direction} ${size} ${coin.name}`);
      return true;
    } else {
      console.log(`❌ Не удалось выполнить ордер`);
      return false;
    }
  } else {
    // Демо-режим
    const cost = (size * price) / leverage;
    const fee = size * price * globalState.takerFee;
    if (cost + fee > globalState.balance * globalState.maxRiskPerTrade) {
      console.log(`❌ Риск превышает ${globalState.maxRiskPerTrade * 100}% от депозита`);
      return false;
    }
    globalState.balance -= fee;
    const trade = {
      coin: coin.name,
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
      riskScore: calculateRiskScore(coin.name)
    };
    globalState.history.push(trade);
    globalState.positions[coin.name] = trade;
    globalState.stats.totalTrades++;
    console.log(`✅ ДЕМО: ${direction} ${size} ${coin.name}`);
    return true;
  }
}

// ==========================
// ФУНКЦИЯ: Расчет рисковой оценки
// ==========================
function calculateRiskScore(coin) {
  const fundamentalData = globalState.marketMemory.fundamentalData[coin];
  const volatility = globalState.marketMemory.volatilityHistory[coin][globalState.marketMemory.volatilityHistory[coin].length - 1] || 0.02;
  let riskScore = 50;

  if (volatility > 0.05) riskScore += 20;
  if (volatility < 0.02) riskScore -= 10;

  if (fundamentalData) {
    if (fundamentalData.marketCapRank <= 10) riskScore -= 15;
    else if (fundamentalData.marketCapRank > 50) riskScore += 10;
    if (fundamentalData.developerActivity > 70) riskScore -= 10;
    else if (fundamentalData.developerActivity < 30) riskScore += 15;
    if (fundamentalData.socialSentiment > 70) riskScore -= 5;
    else if (fundamentalData.socialSentiment < 30) riskScore += 10;
    if (fundamentalData.communityGrowth > 0.1) riskScore -= 5;
    else if (fundamentalData.communityGrowth < -0.1) riskScore += 10;
  }

  if (globalState.fearIndex < 30) riskScore -= 15;
  else if (globalState.fearIndex > 70) riskScore += 15;

  return Math.max(0, Math.min(100, riskScore));
}

// ==========================
// ФУНКЦИЯ: Получение фундаментальных данных
// ==========================
async function getFundamentalData(coin) {
  const now = Date.now();
  const cacheKey = coin.name;
  const cacheDuration = 3600000; // 1 час

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
        developer_data: true,
        sparkline: false
      },
      timeout: 10000
    });
    const data = response.data;
    const fundamentalData = {
      developerActivity: data.developer_data?.commits_30d || 50,
      socialSentiment: data.market_data?.sentiment_votes_up_percentage || 50,
      marketCapRank: data.market_cap_rank || 100,
      communityGrowth: data.community_data?.reddit_subscribers_7d_change_pct || 0,
      totalSupply: data.market_data?.total_supply || null,
      circulatingSupply: data.market_data?.circulating_supply || null
    };

    globalState.marketMemory.fundamentalData[coin.name] = fundamentalData;
    globalState.fundamentalCache[cacheKey] = {
      data: fundamentalData,
      timestamp: now
    };

    console.log(`✅ Фундаментальные данные для ${coin.name} обновлены`);
    await new Promise(r => setTimeout(r, 2000)); // Задержка для Coingecko API
    return fundamentalData;
  } catch (error) {
    console.error(`❌ Ошибка получения фундаментальных данных для ${coin.name}:`, error.message);
    if (error.response) {
      console.error('❌ Ответ от CoinGecko:', JSON.stringify(error.response.data));
    }
    if (globalState.fundamentalCache[cacheKey]) {
      return globalState.fundamentalCache[cacheKey].data;
    }
    return {
      developerActivity: 50,
      socialSentiment: 50,
      marketCapRank: 100,
      communityGrowth: 0
    };
  }
}

// ==========================
// ФУНКЦИЯ: Расчет технических индикаторов
// ==========================
function calculateTechnicalIndicators(candles) {
  if (candles.length < 20) return null;

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);

  // 1. SMA (Simple Moving Average) - 20 периодов
  const sma20 = closes.slice(-20).reduce((sum, price) => sum + price, 0) / 20;

  // 2. EMA (Exponential Moving Average) - 12 и 26 периодов
  const ema12 = calculateEMA(closes.slice(-12), 12);
  const ema26 = calculateEMA(closes.slice(-26), 26);

  // 3. RSI (Relative Strength Index) - 14 периодов
  const rsi14 = calculateRSI(closes.slice(-15));

  // 4. MACD (Moving Average Convergence Divergence)
  const macd = ema12 - ema26;
  const signalLine = calculateEMA([macd], 9);

  // 5. Bollinger Bands
  const stdDev = Math.sqrt(closes.slice(-20).reduce((sum, price) => sum + Math.pow(price - sma20, 2), 0) / 20);
  const upperBand = sma20 + (2 * stdDev);
  const lowerBand = sma20 - (2 * stdDev);

  // 6. Stochastic Oscillator
  const recentHigh = Math.max(...highs.slice(-14));
  const recentLow = Math.min(...lows.slice(-14));
  const currentClose = closes[closes.length - 1];
  const stochastic = ((currentClose - recentLow) / (recentHigh - recentLow)) * 100;

  // 7. Volume Analysis
  const avgVolume = volumes.slice(-20).reduce((sum, vol) => sum + vol, 0) / 20;
  const volumeRatio = volumes[volumes.length - 1] / avgVolume;

  return {
    sma20,
    ema12,
    ema26,
    rsi14,
    macd,
    signalLine,
    upperBand,
    lowerBand,
    stochastic,
    volumeRatio,
    currentPrice: currentClose
  };
}

// Вспомогательная функция для расчета EMA
function calculateEMA(prices, period) {
  if (prices.length === 0) return 0;
  const multiplier = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
  }
  return ema;
}

// Вспомогательная функция для расчета RSI
function calculateRSI(prices) {
  if (prices.length < 2) return 50;
  let gains = 0;
  let losses = 0;
  let count = 0;
  for (let i = 1; i < prices.length; i++) {
    const difference = prices[i] - prices[i-1];
    if (difference > 0) {
      gains += difference;
    } else {
      losses += Math.abs(difference);
    }
    count++;
  }
  const avgGain = gains / count;
  const avgLoss = losses / count;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));
  return rsi;
}

// ==========================
// ФУНКЦИЯ: Расширенный анализ рынка
// ==========================
function analyzeMarketAdvanced(candles, coinName, fundamentalData) {
  if (candles.length < 50) return null;

  const indicators = calculateTechnicalIndicators(candles);
  if (!indicators) return null;

  const currentPrice = indicators.currentPrice;
  let buySignals = 0;
  let sellSignals = 0;
  const reasoning = [];

  // 1. Анализ тренда (SMA)
  if (currentPrice > indicators.sma20) {
    buySignals++;
    reasoning.push("📈 Цена выше SMA20 - восходящий тренд");
  } else {
    sellSignals++;
    reasoning.push("📉 Цена ниже SMA20 - нисходящий тренд");
  }

  // 2. Анализ MACD
  if (indicators.macd > indicators.signalLine) {
    buySignals++;
    reasoning.push("📊 MACD выше сигнальной линии - бычий сигнал");
  } else {
    sellSignals++;
    reasoning.push("📊 MACD ниже сигнальной линии - медвежий сигнал");
  }

  // 3. Анализ RSI
  if (indicators.rsi14 < 30) {
    buySignals++;
    reasoning.push("🟢 RSI < 30 - перепроданность");
  } else if (indicators.rsi14 > 70) {
    sellSignals++;
    reasoning.push("🔴 RSI > 70 - перекупленность");
  }

  // 4. Анализ Bollinger Bands
  if (currentPrice < indicators.lowerBand) {
    buySignals++;
    reasoning.push("🎯 Цена ниже нижней полосы Боллинджера - потенциальный отскок вверх");
  } else if (currentPrice > indicators.upperBand) {
    sellSignals++;
    reasoning.push("🎯 Цена выше верхней полосы Боллинджера - потенциальный откат вниз");
  }

  // 5. Анализ Stochastic
  if (indicators.stochastic < 20) {
    buySignals++;
    reasoning.push("🎲 Стохастик < 20 - перепроданность");
  } else if (indicators.stochastic > 80) {
    sellSignals++;
    reasoning.push("🎲 Стохастик > 80 - перекупленность");
  }

  // 6. Анализ объема
  if (indicators.volumeRatio > 1.5) {
    if (currentPrice > candles[candles.length - 2].close) {
      buySignals++;
      reasoning.push("🔊 Высокий объем подтверждает восходящее движение");
    } else {
      sellSignals++;
      reasoning.push("🔊 Высокий объем подтверждает нисходящее движение");
    }
  }

  // 7. Фундаментальный анализ
  if (fundamentalData) {
    if (fundamentalData.marketCapRank <= 10) {
      buySignals += 0.5;
      reasoning.push("💎 Топ-10 по рыночной капитализации - низкий риск");
    }
    if (fundamentalData.developerActivity > 70) {
      buySignals += 0.5;
      reasoning.push("👨‍💻 Высокая активность разработчиков - позитивный фактор");
    }
    if (fundamentalData.socialSentiment > 70) {
      buySignals += 0.3;
      reasoning.push("💬 Позитивные социальные настроения");
    }
    if (fundamentalData.communityGrowth > 0.1) {
      buySignals += 0.3;
      reasoning.push("👥 Рост сообщества - позитивный тренд");
    }
  }

  // 8. Индекс страха и жадности
  if (globalState.fearIndex < 30) {
    buySignals += 0.5;
    reasoning.push("😌 Индекс страха низкий - хорошее время для покупок");
  } else if (globalState.fearIndex > 70) {
    sellSignals += 0.5;
    reasoning.push("😱 Индекс страха высокий - осторожность на рынке");
  }

  const direction = buySignals > sellSignals ? 'LONG' : 'SHORT';
  const confidence = Math.abs(buySignals - sellSignals) / (buySignals + sellSignals + 1);

  return {
    coin: coinName,
    currentPrice: currentPrice,
    signal: {
      direction,
      confidence,
      leverage: globalState.maxLeverage,
      reasoning
    },
    indicators: {
      rsi: indicators.rsi14.toFixed(2),
      macd: indicators.macd.toFixed(4),
      stochastic: indicators.stochastic.toFixed(2),
      volumeRatio: indicators.volumeRatio.toFixed(2)
    }
  };
}

// ==========================
// ФУНКЦИЯ: Принудительное обновление баланса
// ==========================
async function forceUpdateRealBalance() {
  console.log('🔄 [БАЛАНС] Принудительное обновление...');
  const balance = await getBingXRealBalance();
  if (balance !== null) {
    globalState.realBalance = balance;
    console.log(`✅ [БАЛАНС] Обновлён: $${balance.toFixed(2)}`);
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
// ФУНКЦИЯ: Переключение режима
// ==========================
function toggleMode() {
  globalState.isRealMode = !globalState.isRealMode;
  console.log(`🔄 Режим переключён на: ${globalState.isRealMode ? 'РЕАЛЬНЫЙ' : 'ДЕМО'}`);
  if (globalState.isRealMode) forceUpdateRealBalance();
  return globalState.isRealMode;
}

// ==========================
// ФУНКЦИЯ: Переключение торгового режима
// ==========================
function toggleTradeMode() {
  const modes = ['adaptive', 'scalping', 'swing'];
  const currentIndex = modes.indexOf(globalState.tradeMode);
  const nextIndex = (currentIndex + 1) % modes.length;
  globalState.tradeMode = modes[nextIndex];
  console.log(`⚡ Торговый режим переключён на: ${globalState.tradeMode}`);
  return globalState.tradeMode;
}

// ==========================
// ФУНКЦИЯ: Установка уровня риска
// ==========================
function setRiskLevel(level) {
  globalState.riskLevel = level;
  switch(level) {
    case 'recommended':
      globalState.maxRiskPerTrade = 0.01;
      globalState.maxLeverage = 3;
      console.log('📉 Установлен РЕКОМЕНДУЕМЫЙ уровень риска: 1%, плечо 3x');
      break;
    case 'medium':
      globalState.maxRiskPerTrade = 0.02;
      globalState.maxLeverage = 5;
      console.log('⚖️ Установлен СРЕДНИЙ уровень риска: 2%, плечо 5x');
      break;
    case 'high':
      globalState.maxRiskPerTrade = 0.05;
      globalState.maxLeverage = 10;
      console.log('🚀 Установлен ВЫСОКИЙ уровень риска: 5%, плечо 10x');
      break;
    case 'extreme':
      globalState.maxRiskPerTrade = 0.10;
      globalState.maxLeverage = 20;
      console.log('💥 Установлен ЭКСТРЕМАЛЬНЫЙ уровень риска: 10%, плечо 20x');
      break;
  }
  return globalState.riskLevel;
}

// ==========================
// ФУНКЦИЯ: Проверка открытых позиций (Упрощенная версия для демо)
// ==========================
async function checkOpenPositions(currentPrices) {
  for (const coin of globalState.watchlist) {
    const position = globalState.positions[coin.name];
    if (!position) continue;

    const currentPrice = currentPrices[coin.name];
    if (!currentPrice) continue;

    const profitPercent = position.type === 'LONG'
      ? (currentPrice - position.entryPrice) / position.entryPrice
      : (position.entryPrice - currentPrice) / position.entryPrice;

    // Закрываем позицию при прибыли >2% или убытке >1%
    if (profitPercent > 0.02 || profitPercent < -0.01) {
      console.log(`✅ ЗАКРЫТИЕ: ${position.type} ${coin.name} — прибыль ${profitPercent > 0 ? '+' : ''}${(profitPercent * 100).toFixed(2)}%`);
      position.status = 'CLOSED';
      position.exitPrice = currentPrice;
      position.profitPercent = profitPercent;

      if (profitPercent > 0) {
        globalState.stats.profitableTrades++;
        if (globalState.isRealMode) {
          globalState.realBalance += (position.size * position.entryPrice * profitPercent) - position.fee;
        } else {
          globalState.balance += (position.size * position.entryPrice * profitPercent) - position.fee;
        }
      } else {
        globalState.stats.losingTrades++;
      }

      globalState.positions[coin.name] = null;
    }
  }
}

// ==========================
// HTTP-сервер с паролем
// ==========================
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cookieParser());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware для аутентификации
function authenticate(req, res, next) {
  if (req.path === '/login' || req.path === '/favicon.ico') {
    return next();
  }
  if (req.cookies.authToken) return next();
  res.redirect('/login');
}

app.use(authenticate);

// Создаем директорию для статических файлов, если она не существует
if (!fs.existsSync(path.join(__dirname, 'public'))) {
  fs.mkdirSync(path.join(__dirname, 'public'));
}

// Создаем index.html с паролем из переменной окружения
const createIndexHtml = () => {
  const htmlContent = `
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Философ Рынка — Торговый Бот v5.1</title>
    <style>
        :root {
            --primary: #3498db;
            --secondary: #2c3e50;
            --success: #27ae60;
            --danger: #e74c3c;
            --warning: #f39c12;
            --light: #f5f5f5;
            --dark: #34495e;
            --gray: #95a5a6;
        }
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
            color: #e0e0e0;
            min-height: 100vh;
            padding: 15px;
            line-height: 1.6;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        header {
            text-align: center;
            padding: 30px 0;
            color: white;
            border-bottom: 1px solid rgba(255,255,255,0.1);
            margin-bottom: 30px;
        }
        h1 {
            font-size: 2.8rem;
            margin-bottom: 8px;
            text-shadow: 0 2px 8px rgba(0,0,0,0.3);
            font-weight: 700;
        }
        .subtitle {
            font-size: 1.3rem;
            font-style: italic;
            margin-bottom: 20px;
            color: #bdc3c7;
        }
        .dashboard {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .card {
            background: rgba(255,255,255,0.05);
            backdrop-filter: blur(10px);
            border-radius: 16px;
            padding: 24px;
            border: 1px solid rgba(255,255,255,0.1);
            box-shadow: 0 8px 32px rgba(0,0,0,0.2);
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .card:hover {
            transform: translateY(-5px);
            box-shadow: 0 12px 40px rgba(0,0,0,0.3);
        }
        .card-title {
            font-size: 1.2rem;
            color: #bdc3c7;
            margin-bottom: 12px;
            font-weight: 500;
            letter-spacing: 0.5px;
        }
        .card-value {
            font-size: 2.2rem;
            font-weight: 800;
            color: var(--primary);
            margin-bottom: 8px;
            font-family: 'Courier New', monospace;
            text-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        .card-subtitle {
            color: #95a5a6;
            font-size: 0.9rem;
            margin-top: 8px;
            font-weight: 400;
        }
        .status-badge {
            display: inline-block;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 600;
            margin-left: 8px;
        }
        .status-real {
            background: rgba(39, 174, 96, 0.2);
            color: #27ae60;
            border: 1px solid #27ae60;
        }
        .status-demo {
            background: rgba(231, 76, 60, 0.2);
            color: #e74c3c;
            border: 1px solid #e74c3c;
        }
        .btn {
            padding: 12px 24px;
            border: none;
            border-radius: 12px;
            cursor: pointer;
            font-size: 1rem;
            font-weight: 600;
            transition: all 0.3s ease;
            margin: 5px 5px 5px 0;
            letter-spacing: 0.5px;
        }
        .btn-primary {
            background: var(--primary);
            color: white;
            box-shadow: 0 4px 12px rgba(52, 152, 219, 0.3);
        }
        .btn-primary:hover {
            background: #2980b9;
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(52, 152, 219, 0.4);
        }
        .btn-success {
            background: var(--success);
            color: white;
            box-shadow: 0 4px 12px rgba(39, 174, 96, 0.3);
        }
        .btn-success:hover {
            background: #219a52;
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(39, 174, 96, 0.4);
        }
        .btn-danger {
            background: var(--danger);
            color: white;
            box-shadow: 0 4px 12px rgba(231, 76, 60, 0.3);
        }
        .btn-danger:hover {
            background: #c0392b;
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(231, 76, 60, 0.4);
        }
        .btn-warning {
            background: var(--warning);
            color: white;
            box-shadow: 0 4px 12px rgba(243, 156, 18, 0.3);
        }
        .btn-warning:hover {
            background: #d35400;
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(243, 156, 18, 0.4);
        }
        .controls {
            display: flex;
            flex-wrap: wrap;
            justify-content: center;
            gap: 15px;
            margin: 30px 0;
            padding: 20px;
            background: rgba(255,255,255,0.03);
            border-radius: 16px;
            border: 1px solid rgba(255,255,255,0.08);
        }
        table {
            width: 100%;
            background: rgba(255,255,255,0.05);
            border-radius: 16px;
            overflow: hidden;
            margin-bottom: 30px;
            border-collapse: collapse;
            box-shadow: 0 8px 32px rgba(0,0,0,0.2);
        }
        th, td {
            padding: 16px;
            text-align: left;
            border-bottom: 1px solid rgba(255,255,255,0.08);
            font-size: 0.95rem;
        }
        th {
            background: rgba(52, 152, 219, 0.1);
            color: #bdc3c7;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.8px;
            font-size: 0.85rem;
        }
        tr:hover {
            background: rgba(255,255,255,0.08);
        }
        .profit {
            color: #27ae60;
            font-weight: 700;
        }
        .loss {
            color: #e74c3c;
            font-weight: 700;
        }
        .log-entry {
            padding: 12px 16px;
            border-bottom: 1px solid rgba(255,255,255,0.05);
            background: rgba(255,255,255,0.03);
            border-radius: 8px;
            margin-bottom: 8px;
            animation: fadeIn 0.3s ease-out;
        }
        .log-time {
            color: var(--gray);
            font-size: 0.8rem;
            margin-bottom: 4px;
        }
        .log-coin {
            font-weight: 600;
            color: #ecf0f1;
        }
        .log-signal {
            font-weight: 700;
            margin-left: 8px;
        }
        .log-buy {
            color: #27ae60;
        }
        .log-sell {
            color: #e74c3c;
        }
        .log-confidence {
            display: inline-block;
            background: rgba(243, 156, 18, 0.2);
            color: #f39c12;
            padding: 3px 8px;
            border-radius: 12px;
            font-size: 0.8rem;
            margin-left: 10px;
        }
        .analysis-log {
            background: rgba(255,255,255,0.05);
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 30px;
            border: 1px solid rgba(255,255,255,0.1);
            max-height: 400px;
            overflow-y: auto;
            box-shadow: 0 8px 32px rgba(0,0,0,0.2);
        }
        .section-header {
            font-size: 1.4rem;
            margin: 30px 0 20px 0;
            color: white;
            padding-bottom: 10px;
            border-bottom: 2px solid rgba(255,255,255,0.1);
        }
        .indicator {
            display: inline-block;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            margin-right: 8px;
            vertical-align: middle;
        }
        .indicator-green {
            background: #27ae60;
        }
        .indicator-yellow {
            background: #f39c12;
        }
        .indicator-red {
            background: #e74c3c;
        }
        .indicator-gray {
            background: #95a5a6;
        }
        .logout-btn {
            position: absolute;
            top: 20px;
            right: 20px;
            background: var(--danger);
            color: white;
            border: none;
            padding: 10px 18px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 0.9rem;
            font-weight: 600;
            box-shadow: 0 4px 12px rgba(231, 76, 60, 0.3);
        }
        .logout-btn:hover {
            background: #c0392b;
            transform: translateY(-2px);
        }
        .loading {
            color: #95a5a6;
            font-style: italic;
            text-align: center;
            padding: 20px;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        @media (max-width: 768px) {
            .dashboard {
                grid-template-columns: 1fr;
            }
            h1 {
                font-size: 2rem;
            }
            .card-value {
                font-size: 1.8rem;
            }
            th, td {
                padding: 12px;
                font-size: 0.9rem;
            }
            .btn {
                padding: 10px 18px;
                font-size: 0.9rem;
            }
            .controls {
                flex-direction: column;
                align-items: center;
            }
        }
    </style>
</head>
<body>
    <button class="logout-btn" onclick="logout()">Выйти</button>
    <div class="container">
        <header>
            <h1>Философ Рынка — Торговый Бот v5.1</h1>
            <p class="subtitle">Система принятия решений на основе фундаментального и технического анализа</p>
        </header>
        <div class="dashboard">
            <div class="card">
                <div class="card-title">Текущий баланс</div>
                <div class="card-value" id="balance">$100.00</div>
                <div class="card-subtitle">
                    <span id="balanceMode">Демо-баланс</span>
                    <span class="status-badge" id="modeBadge">ДЕМО</span>
                </div>
            </div>
            <div class="card">
                <div class="card-title">Режим торговли</div>
                <div class="card-value" id="tradeMode">adaptive</div>
                <div class="card-subtitle">Текущая стратегия</div>
            </div>
            <div class="card">
                <div class="card-title">Уровень риска</div>
                <div class="card-value" id="riskLevel">recommended</div>
                <div class="card-subtitle">Макс. риск: 1.0%</div>
            </div>
            <div class="card">
                <div class="card-title">Индекс страха</div>
                <div class="card-value" id="fearIndex">50</div>
                <div class="card-subtitle">Настроения рынка</div>
            </div>
        </div>
        <h2 class="section-header">Статистика торговли</h2>
        <div class="dashboard">
            <div class="card">
                <div class="card-title">Всего сделок</div>
                <div class="card-value" id="totalTrades">0</div>
                <div class="card-subtitle">С начала работы</div>
            </div>
            <div class="card">
                <div class="card-title">Прибыльных</div>
                <div class="card-value" id="profitableTrades">0</div>
                <div class="card-subtitle">Успешные сделки</div>
            </div>
            <div class="card">
                <div class="card-title">Убыточных</div>
                <div class="card-value" id="losingTrades">0</div>
                <div class="card-subtitle">Неудачные сделки</div>
            </div>
            <div class="card">
                <div class="card-title">Процент успеха</div>
                <div class="card-value" id="winRate">0.0%</div>
                <div class="card-subtitle">Win Rate</div>
            </div>
        </div>
        <h2 class="section-header">Открытые позиции</h2>
        <div class="positions-table">
            <table id="positionsTable">
                <thead>
                    <tr>
                        <th>Монета</th>
                        <th>Тип</th>
                        <th>Размер</th>
                        <th>Цена входа</th>
                        <th>Текущая цена</th>
                        <th>Прибыль/Убыток</th>
                        <th>Риск</th>
                    </tr>
                </thead>
                <tbody id="positionsBody">
                    <tr>
                        <td colspan="7" style="text-align: center; color: #95a5a6;">Нет открытых позиций</td>
                    </tr>
                </tbody>
            </table>
        </div>
        <h2 class="section-header">Последние сделки</h2>
        <div class="history-table">
            <table>
                <thead>
                    <tr>
                        <th>Время</th>
                        <th>Монета</th>
                        <th>Тип</th>
                        <th>Цена входа</th>
                        <th>Цена выхода</th>
                        <th>Прибыль</th>
                        <th>Риск</th>
                    </tr>
                </thead>
                <tbody id="historyBody">
                    <tr>
                        <td colspan="7" style="text-align: center; color: #95a5a6;">Нет истории сделок</td>
                    </tr>
                </tbody>
            </table>
        </div>
        <h2 class="section-header">Лог философского анализа</h2>
        <div class="analysis-log" id="analysisLog">
            <div class="log-entry">
                <div class="log-time">[12:00:00]</div>
                <div><span class="log-coin">Бот запущен</span>: Ожидание данных с BingX API...</div>
            </div>
        </div>
        <h2 class="section-header">Управление капиталом</h2>
        <div class="controls">
            <button class="btn btn-primary" onclick="toggleMode()">🔄 Переключить режим (ДЕМО/РЕАЛ)</button>
            <button class="btn btn-primary" onclick="toggleTradeMode()">⚡ Сменить стратегию</button>
            <button class="btn btn-success" onclick="setRiskLevel('recommended')">📉 Рекомендуемый риск</button>
            <button class="btn btn-warning" onclick="setRiskLevel('medium')">⚖️ Средний риск</button>
            <button class="btn btn-danger" onclick="setRiskLevel('high')">🚀 Высокий риск</button>
        </div>
    </div>
    <script>
        function toggleMode() {
            fetch('/toggle-mode', { method: 'POST' })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        updateUI();
                    }
                });
        }
        function toggleTradeMode() {
            fetch('/toggle-trade-mode', { method: 'POST' })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        updateUI();
                    }
                });
        }
        function setRiskLevel(level) {
            fetch('/set-risk-level', { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ level: level })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    updateUI();
                }
            });
        }
        function logout() {
            fetch('/logout', { method: 'GET' })
                .then(() => {
                    window.location.href = '/login';
                });
        }
        // Обновляем интерфейс данными из API
        function updateUI() {
            fetch('/api/status')
                .then(response => response.json())
                .then(data => {
                    // Баланс и режим
                    const displayBalance = data.isRealMode ? (data.realBalance || 0) : data.balance;
                    const balanceModeText = data.isRealMode ? 'Реальный баланс' : 'Демо-баланс';
                    const modeBadgeText = data.isRealMode ? 'РЕАЛ' : 'ДЕМО';
                    document.getElementById('balance').textContent = '$' + displayBalance.toFixed(2);
                    document.getElementById('balanceMode').textContent = balanceModeText;
                    document.getElementById('modeBadge').textContent = modeBadgeText;
                    document.getElementById('modeBadge').className = 'status-badge ' + (data.isRealMode ? 'status-real' : 'status-demo');
                    // Статистика
                    document.getElementById('tradeMode').textContent = data.tradeMode;
                    document.getElementById('riskLevel').textContent = data.riskLevel;
                    document.getElementById('fearIndex').textContent = data.fearIndex;
                    document.getElementById('totalTrades').textContent = data.stats.totalTrades;
                    document.getElementById('profitableTrades').textContent = data.stats.profitableTrades;
                    document.getElementById('losingTrades').textContent = data.stats.losingTrades;
                    document.getElementById('winRate').textContent = data.stats.winRate.toFixed(1) + '%';
                    // Открытые позиции
                    const positionsBody = document.getElementById('positionsBody');
                    if (data.openPositions && data.openPositions.length > 0) {
                        positionsBody.innerHTML = data.openPositions.map(pos => {
                            const currentPrice = data.currentPrices[pos.coin] || 0;
                            const profitPercent = pos.type === 'LONG' 
                                ? (currentPrice - pos.entryPrice) / pos.entryPrice
                                : (pos.entryPrice - currentPrice) / pos.entryPrice;
                            const profitClass = profitPercent > 0 ? 'profit' : 'loss';
                            return '<tr>' +
                                '<td>' + (pos.coin || '...') + '</td>' +
                                '<td>' + (pos.type || '...') + '</td>' +
                                '<td>' + (pos.size ? pos.size.toFixed(6) : '...') + '</td>' +
                                '<td>$' + (pos.entryPrice ? pos.entryPrice.toFixed(4) : '...') + '</td>' +
                                '<td>$' + currentPrice.toFixed(4) + '</td>' +
                                '<td class="' + profitClass + '">' + (profitPercent * 100).toFixed(2) + '%</td>' +
                                '<td>' + (pos.riskScore ? pos.riskScore.toFixed(0) : '...') + '</td>' +
                                '</tr>';
                        }).join('');
                    } else {
                        positionsBody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #95a5a6;">Нет открытых позиций</td></tr>';
                    }
                    // История сделок
                    const historyBody = document.getElementById('historyBody');
                    if (data.history && data.history.length > 0) {
                        historyBody.innerHTML = data.history.slice(-10).map(h => {
                            const profitClass = h.profitPercent > 0 ? 'profit' : 'loss';
                            return '<tr>' +
                                '<td>' + (h.timestamp || '...') + '</td>' +
                                '<td>' + (h.coin || '...') + '</td>' +
                                '<td>' + (h.type || '...') + '</td>' +
                                '<td>$' + (h.entryPrice ? h.entryPrice.toFixed(4) : '...') + '</td>' +
                                '<td>$' + (h.exitPrice ? h.exitPrice.toFixed(4) : '...') + '</td>' +
                                '<td class="' + profitClass + '">' + (h.profitPercent ? (h.profitPercent > 0 ? '+' : '') + (h.profitPercent * 100).toFixed(2) + '%' : '...') + '</td>' +
                                '<td>' + (h.riskScore ? h.riskScore.toFixed(0) : '...') + '</td>' +
                                '</tr>';
                        }).join('');
                    } else {
                        historyBody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #95a5a6;">Нет истории сделок</td></tr>';
                    }
                    // Лог анализа
                    const analysisLog = document.getElementById('analysisLog');
                    if (data.lastAnalysis && data.lastAnalysis.length > 0) {
                        // Очищаем старые записи, оставляем только последние 5
                        analysisLog.innerHTML = '';
                        data.lastAnalysis.slice(-5).forEach(analysis => {
                            const logEntry = document.createElement('div');
                            logEntry.className = 'log-entry';
                            const confidence = (analysis.signal.confidence * 100).toFixed(1);
                            logEntry.innerHTML = '<div class="log-time">[' + new Date().toLocaleTimeString() + ']</div>' +
                                '<div>' +
                                '<span class="log-coin">' + (analysis.coin || '...') + '</span>: ' +
                                '<span class="log-signal ' + (analysis.signal.direction === 'LONG' ? 'log-buy' : 'log-sell') + '">' +
                                (analysis.signal.direction || '...') +
                                '</span> ' +
                                '<span class="log-confidence">' + confidence + '%</span>' +
                                '</div>';
                            analysisLog.insertBefore(logEntry, analysisLog.firstChild);
                        });
                    } else {
                        // Если нет анализа, показываем "ожидание сигнала"
                        if (analysisLog.children.length === 0) {
                            const logEntry = document.createElement('div');
                            logEntry.className = 'log-entry';
                            logEntry.innerHTML = '<div class="log-time">[' + new Date().toLocaleTimeString() + ']</div>' +
                                '<div><span class="log-coin">Ожидание сигнала</span>: Анализируем рынок...</div>';
                            analysisLog.appendChild(logEntry);
                        }
                    }
                    // Добавляем уведомление о доступности цен
                    const pricesAvailable = data.currentPrices && Object.keys(data.currentPrices).length > 0;
                    if (!pricesAvailable && analysisLog.children.length === 0) {
                        const logEntry = document.createElement('div');
                        logEntry.className = 'log-entry';
                        logEntry.innerHTML = '<div class="log-time">[' + new Date().toLocaleTimeString() + ']</div>' +
                            '<div><span class="log-coin">⚠️ Внимание</span>: Не удалось получить цены с BingX. Проверьте символы и ключи API.</div>';
                        analysisLog.appendChild(logEntry);
                    }
                })
                .catch(error => {
                    console.error('Ошибка обновления данных:', error);
                    const analysisLog = document.getElementById('analysisLog');
                    const logEntry = document.createElement('div');
                    logEntry.className = 'log-entry';
                    logEntry.innerHTML = '<div class="log-time">[' + new Date().toLocaleTimeString() + ']</div>' +
                        '<div><span class="log-coin">❌ Ошибка</span>: Не удалось получить данные от сервера. Проверьте подключение.</div>';
                    analysisLog.appendChild(logEntry);
                });
        }
        // Запускаем обновление сразу при загрузке
        updateUI();
        // Обновляем каждые 15 секунд
        setInterval(updateUI, 15000);
        // Обновляем при каждом изменении вкладки
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                updateUI();
            }
        });
    </script>
</body>
</html>
  `;
  fs.writeFileSync(path.join(__dirname, 'public', 'index.html'), htmlContent, 'utf8');
  console.log('✅ Файл index.html успешно создан с паролем из переменной окружения');
};

// Создаем index.html при запуске
createIndexHtml();

// Страница входа
app.get('/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Вход в систему</title>
      <style>
        body { 
          font-family: sans-serif; 
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          display: flex; 
          justify-content: center; 
          align-items: center; 
          min-height: 100vh; 
          margin: 0; 
        }
        .login-form { 
          background: white; 
          padding: 40px; 
          border-radius: 15px; 
          box-shadow: 0 20px 40px rgba(0,0,0,0.1); 
          text-align: center; 
          width: 100%; 
          max-width: 450px; 
        }
        input { 
          width: 100%; 
          padding: 15px; 
          margin: 15px 0; 
          border: 2px solid #e0e0e0; 
          border-radius: 8px; 
          font-size: 16px;
          transition: border-color 0.3s;
        }
        input:focus {
          outline: none;
          border-color: #3498db;
        }
        button { 
          width: 100%; 
          padding: 15px; 
          background: #3498db; 
          color: white; 
          border: none; 
          border-radius: 8px; 
          cursor: pointer; 
          font-size: 18px; 
          font-weight: bold;
          transition: background 0.3s;
        }
        button:hover { 
          background: #2980b9; 
        }
        h2 { 
          color: #2c3e50; 
          margin-bottom: 30px; 
          font-size: 28px;
        }
        .logo {
          margin-bottom: 30px;
          color: #3498db;
          font-size: 36px;
          font-weight: bold;
        }
      </style>
    </head>
    <body>
      <div class="login-form">
        <div class="logo">Философ Рынка</div>
        <h2>Торговый Бот v5.1</h2>
        <form id="loginForm">
          <input type="password" name="password" placeholder="Введите пароль" required>
          <button type="submit">Войти в систему</button>
        </form>
      </div>
      <script>
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const password = document.querySelector('input[name="password"]').value;
          const res = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
          });
          const data = await res.json();
          if (data.success) {
            document.cookie = "authToken=true; path=/; max-age=86400";
            window.location.href = '/';
          } else {
            alert('❌ Неверный пароль. Попробуйте снова.');
            document.querySelector('input[name="password"]').value = '';
          }
        });
      </script>
    </body>
    </html>
  `);
});

app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === APP_PASSWORD) {
    res.cookie('authToken', 'true', { path: '/', maxAge: 86400000 });
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false });
  }
});

app.get('/logout', (req, res) => {
  res.clearCookie('authToken');
  res.redirect('/login');
});

// API эндпоинты
app.post('/toggle-mode', (req, res) => {
  const newMode = toggleMode();
  res.json({ success: true, isRealMode: newMode });
});

app.post('/toggle-trade-mode', (req, res) => {
  toggleTradeMode();
  res.json({ success: true });
});

app.post('/set-risk-level', (req, res) => {
  const { level } = req.body;
  setRiskLevel(level);
  res.json({ success: true });
});

app.get('/api/status', (req, res) => {
  const openPositions = Object.values(globalState.positions).filter(p => p !== null);
  res.json({
    balance: globalState.balance,
    realBalance: globalState.realBalance,
    isRealMode: globalState.isRealMode,
    tradeMode: globalState.tradeMode,
    riskLevel: globalState.riskLevel,
    fearIndex: globalState.fearIndex,
    stats: globalState.stats,
    openPositions: openPositions,
    history: globalState.history,
    currentPrices: globalState.currentPrices,
    lastAnalysis: globalState.lastAnalysis || []
  });
});

// ==========================
// ГЛАВНАЯ ФУНКЦИЯ — ЦИКЛ БОТА
// ==========================
(async () => {
  console.log('🤖 ЗАПУСК ТОРГОВОГО БОТА (ПОЛНОСТЬЮ РАБОЧАЯ ВЕРСИЯ v5.1)');
  console.log('🔑 API-ключи: ЗАДАНЫ');
  console.log('🔐 Секретный ключ: ЗАДАН');
  console.log('✅ Проверка доступных монет на BingX...');

  // Проверяем, какие монеты доступны
  for (const coin of globalState.watchlist) {
    console.log(`🔍 Проверка доступности ${coin.symbol}...`);
    try {
      const serverTime = await getBingXServerTime();
      const params = {
        symbol: coin.symbol,
        timestamp: serverTime,
        recvWindow: 5000
      };
      const signature = signBingXRequest(params);
      // ИСПРАВЛЕНО: Используем правильный публичный эндпоинт для проверки
      const url = `${BINGX_FUTURES_URL}/openApi/swap/v2/quote/price?symbol=${params.symbol}&timestamp=${params.timestamp}&recvWindow=5000&signature=${signature}`;
      const response = await axios.get(url, {
        headers: { 'X-BX-APIKEY': BINGX_API_KEY }, // <-- ДОБАВЛЕНО
        timeout: 10000
      });
      if (response.data.code === 0 && response.data.data && response.data.data.price) {
        console.log(`✅ Монета ${coin.symbol} доступна на BingX`);
      } else {
        console.warn(`⚠️ Монета ${coin.symbol} НЕ доступна на BingX. Ответ:`, JSON.stringify(response.data));
        // Удаляем недоступную монету из списка
        globalState.watchlist = globalState.watchlist.filter(c => c.symbol !== coin.symbol);
        console.warn(`⚠️ Монета ${coin.symbol} удалена из watchlist`);
      }
    } catch (error) {
      console.error(`❌ Ошибка проверки доступности ${coin.symbol}:`, error.message);
      if (error.response) {
        console.error('❌ Ответ от BingX:', JSON.stringify(error.response.data));
      }
      // Удаляем недоступную монету из списка
      globalState.watchlist = globalState.watchlist.filter(c => c.symbol !== coin.symbol);
      console.warn(`⚠️ Монета ${coin.symbol} удалена из watchlist`);
    }
  }

  console.log(`✅ Актуальный список монет: ${globalState.watchlist.map(c => c.symbol).join(', ')}`);

  setRiskLevel('recommended');
  globalState.tradeMode = 'adaptive';
  await forceUpdateRealBalance();
  globalState.lastAnalysis = [];

  while (globalState.isRunning) {
    try {
      console.log(`
[${new Date().toLocaleTimeString()}] === АНАЛИЗ РЫНКА ===`);

      const fearIndex = await getFearAndGreedIndex();
      console.log(`😱 Индекс страха: ${fearIndex}`);

      // Обновляем баланс каждые 5 минут в реальном режиме
      if (Date.now() % 300000 < 10000 && globalState.isRealMode) {
        await forceUpdateRealBalance();
      }

      const currentPrices = await getCurrentPrices();
      globalState.currentPrices = currentPrices;

      // Получаем фундаментальные данные для всех монет
      for (const coin of globalState.watchlist) {
        await getFundamentalData(coin);
      }

      // Проверяем открытые позиции
      await checkOpenPositions(currentPrices);

      let bestOpportunity = null;
      globalState.lastAnalysis = [];

      // Анализируем каждую монету
      for (const coin of globalState.watchlist) {
        console.log(`
🔍 Анализирую ${coin.name}...`);
        const candles = await getBingXFuturesHistory(coin.symbol, '1h', 100);
        if (candles.length < 50) {
          console.log(`   ⚠️ Пропускаем ${coin.name} — недостаточно данных`);
          continue;
        }

        const prices = candles.map(c => c.close);
        const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
        const volatility = Math.sqrt(prices.reduce((sum, p) => sum + Math.pow(p - avgPrice, 2), 0) / prices.length) / avgPrice;
        globalState.marketMemory.volatilityHistory[coin.name].push(volatility);
        if (globalState.marketMemory.volatilityHistory[coin.name].length > 24) {
          globalState.marketMemory.volatilityHistory[coin.name].shift();
        }

        const fundamentalData = globalState.marketMemory.fundamentalData[coin.name];
        const analysis = analyzeMarketAdvanced(candles, coin.name, fundamentalData);

        if (!analysis || !analysis.signal.direction) continue;

        globalState.lastAnalysis.push(analysis);

        if (!bestOpportunity || analysis.signal.confidence > (bestOpportunity?.signal?.confidence || 0)) {
          bestOpportunity = analysis;
        }

        console.log(`   📊 RSI: ${analysis.indicators.rsi}, MACD: ${analysis.indicators.macd}, Стохастик: ${analysis.indicators.stochastic}`);
        console.log(`   💡 Сигнал: ${analysis.signal.direction} (уверенность: ${(analysis.signal.confidence * 100).toFixed(1)}%)`);
      }

      // Если найдена лучшая возможность, открываем сделку
      if (bestOpportunity && (globalState.isRealMode || globalState.balance > 10)) {
        console.log(`
💎 ЛУЧШАЯ ВОЗМОЖНОСТЬ: ${bestOpportunity.signal.direction} по ${bestOpportunity.coin}`);
        console.log(`   📈 Уверенность: ${(bestOpportunity.signal.confidence * 100).toFixed(1)}%`);
        console.log(`   🧠 Причины: ${bestOpportunity.signal.reasoning.join('; ')}`);

        const price = bestOpportunity.currentPrice;
        const size = (globalState.isRealMode ? (globalState.realBalance || 100) : globalState.balance) * globalState.maxRiskPerTrade / (price * 0.01);
        const finalSize = Math.max(0.001, size);
        const stopLoss = price * (1 - 0.01);
        const takeProfit = price * (1 + 0.02);

        console.log(`
🟢 ВХОД: ${bestOpportunity.signal.direction} ${finalSize.toFixed(6)} ${bestOpportunity.coin} с плечом ${bestOpportunity.signal.leverage}x`);

        await openFuturesTrade(
          {symbol: bestOpportunity.coin.toUpperCase() + '-USDT', name: bestOpportunity.coin},
          bestOpportunity.signal.direction,
          bestOpportunity.signal.leverage,
          finalSize,
          price,
          stopLoss,
          takeProfit
        );
      } else {
        console.log(`
⚪ Нет подходящих возможностей — ожидаем...`);
      }

      // Обновляем статистику
      globalState.stats.winRate = globalState.stats.totalTrades > 0
        ? (globalState.stats.profitableTrades / globalState.stats.totalTrades) * 100
        : 0;

      // Логируем баланс каждую минуту
      if (Date.now() % 60000 < 10000) {
        console.log(`
💰 Баланс: $${(globalState.isRealMode ? globalState.realBalance : globalState.balance)?.toFixed(2) || '...'}`);
      }

    } catch (error) {
      console.error('💥 КРИТИЧЕСКАЯ ОШИБКА В ЦИКЛЕ:', error.message);
      if (error.response) {
        console.error('❌ Ответ от BingX:', JSON.stringify(error.response.data));
      }
    }

    console.log(`
💤 Ждём 60 секунд...`);
    await new Promise(r => setTimeout(r, 60000));
  }
})();

// ==========================
// ЗАПУСК СЕРВЕРА
// ==========================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`🌐 Доступ к интерфейсу: http://localhost:${PORT}`);
  console.log(`🔐 Пароль для входа: ${APP_PASSWORD}`);
  console.log('✅ ВАЖНО: Для работы бота нужно установить переменные окружения:');
  console.log('   - BINGX_API_KEY');
  console.log('   - BINGX_SECRET_KEY');
  console.log('   - APP_PASSWORD (по желанию)');
});
