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
    { symbol: 'BTC-USD', name: 'bitcoin' },
    { symbol: 'ETH-USD', name: 'ethereum' },
    { symbol: 'SOL-USD', name: 'solana' },
    { symbol: 'XRP-USD', name: 'ripple' }
  ],
  isRealMode: false, // false = демо, true = реальный режим
  tradeMode: 'adaptive', // 'adaptive' (адаптивный режим), 'scalping', 'swing'
  riskLevel: 'recommended', // 'recommended', 'medium', 'high', 'extreme'
  testMode: false,
  currentPrices: {},
  fearIndex: 50,
  bingxCache: {}, // Кэш для данных BingX API
  fundamentalCache: {} // Кэш для CoinGecko
};

// Инициализация состояния для всех монет
globalState.watchlist.forEach(coin => {
  globalState.positions[coin.name] = null;
  globalState.marketMemory.lastTrades[coin.name] = [];
  globalState.marketMemory.consecutiveTrades[coin.name] = 0;
  globalState.marketMemory.volatilityHistory[coin.name] = [];
  globalState.marketMemory.fundamentalData[coin.name] = {
    developerActivity: null,
    socialSentiment: null
  };
});

// ==========================
// КОНФИГУРАЦИЯ BINGX API
// ==========================
const BINGX_API_KEY = process.env.BINGX_API_KEY;
const BINGX_SECRET_KEY = process.env.BINGX_SECRET_KEY;
const BINGX_FUTURES_URL = process.env.BINGX_API_DOMAIN || 'https://open-api.bingx.com';
const APP_PASSWORD = process.env.APP_PASSWORD || 'admin123'; // Пароль для доступа к интерфейсу

// ==========================
// ФУНКЦИЯ: Подпись запроса для BingX (СТРОГО ПО ДОКУМЕНТАЦИИ)
// ==========================
function signBingXRequest(params) {
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
// ФУНКЦИЯ: Получение данных из BingX с кэшированием
// ==========================
async function getBingXData(url, params) {
  const cacheKey = `${url}-${JSON.stringify(params)}`;
  
  if (globalState.bingxCache[cacheKey] && Date.now() - globalState.bingxCache[cacheKey].timestamp < 30000) {
    return globalState.bingxCache[cacheKey].data;
  }
  
  try {
    const response = await axios.get(url, {
      params,
      headers: { 
        'X-BX-APIKEY': BINGX_API_KEY,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 10000
    });
    
    globalState.bingxCache[cacheKey] = {
      data: response.data,
      timestamp: Date.now()
    };
    
    return response.data;
  } catch (error) {
    console.error(`❌ Ошибка при получении данных из BingX:`, error.message);
    return null;
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
    const params = { timestamp, recvWindow: 5000 };
    const signature = signBingXRequest(params);
    const url = `${BINGX_FUTURES_URL}/openApi/cswap/v1/user/balance?timestamp=${timestamp}&recvWindow=5000&signature=${signature}`;
    
    console.log('🌐 [БАЛАНС] Отправляю ПОДПИСАННЫЙ запрос к:', url);
    
    const response = await getBingXData(url, params);
    if (!response) return null;
    
    console.log('✅ [БАЛАНС] Получен ответ от BingX:', JSON.stringify(response, null, 2));
    
    if (response.code === 0 && response.data) {
      let usdtBalance = null;
      if (response.data.balance && response.data.balance.asset === 'USDT') {
        usdtBalance = parseFloat(response.data.balance.balance);
        console.log(`💰 [БАЛАНС] Найден баланс в data.balance: $${usdtBalance.toFixed(2)}`);
      } else if (response.data.assets && Array.isArray(response.data.assets)) {
        const usdtAsset = response.data.assets.find(asset => asset.asset === 'USDT');
        if (usdtAsset && usdtAsset.walletBalance) {
          usdtBalance = parseFloat(usdtAsset.walletBalance);
          console.log(`💰 [БАЛАНС] Найден баланс в assets: $${usdtBalance.toFixed(2)}`);
        }
      } else if (Array.isArray(response.data)) {
        const usdtAsset = response.data.find(asset => asset.asset === 'USDT');
        if (usdtAsset && usdtAsset.walletBalance) {
          usdtBalance = parseFloat(usdtAsset.walletBalance);
          console.log(`💰 [БАЛАНС] Найден баланс в массиве: $${usdtBalance.toFixed(2)}`);
        }
      }
      
      if (usdtBalance !== null) return usdtBalance;
      else console.error('❌ [БАЛАНС] Не найден баланс USDT в ответе');
    } else {
      console.error('❌ [БАЛАНС] Ошибка в ответе от BingX:', response.msg || 'Неизвестная ошибка');
    }
    
    return null;
  } catch (error) {
    console.error('❌ [БАЛАНС] КРИТИЧЕСКАЯ ОШИБКА получения реального баланса:', error.message);
    return null;
  }
}

// ==========================
// ФУНКЦИЯ: Получение исторических свечей с BingX Futures
// ==========================
async function getBingXFuturesHistory(symbol, interval = '1h', limit = 100) {
  try {
    const timestamp = Date.now();
    const params = {
      symbol: symbol,
      interval,
      limit,
      timestamp,
      recvWindow: 5000
    };
    
    const signature = signBingXRequest(params);
    const url = `${BINGX_FUTURES_URL}/openApi/cswap/v1/market/klines?symbol=${params.symbol}&interval=${params.interval}&limit=${params.limit}&timestamp=${params.timestamp}&recvWindow=5000&signature=${signature}`;
    
    console.log(`🌐 Получение истории для ${symbol}: GET ${url}`);
    
    const response = await getBingXData(url, params);
    if (!response) return [];
    
    console.log('✅ [ИСТОРИЯ] Ответ:', JSON.stringify(response, null, 2));
    
    if (response.code === 0 && Array.isArray(response.data)) {
      const candles = response.data.map(candle => ({
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
      console.error(`❌ Ошибка в ответе от BingX для истории ${symbol}:`, response.msg || 'Неизвестная ошибка');
      return [];
    }
  } catch (error) {
    console.error(`❌ Ошибка получения истории для ${symbol}:`, error.message);
    return [];
  }
}

// ==========================
// ФУНКЦИЯ: Получение текущих цен с BingX
// ==========================
async function getCurrentPrices() {
  try {
    const prices = {};
    
    for (const coin of globalState.watchlist) {
      const timestamp = Date.now();
      const params = {
        symbol: coin.symbol,
        timestamp,
        recvWindow: 5000
      };
      
      const signature = signBingXRequest(params);
      const url = `${BINGX_FUTURES_URL}/openApi/cswap/v1/market/ticker?symbol=${params.symbol}&timestamp=${params.timestamp}&recvWindow=5000&signature=${signature}`;
      
      console.log(`🌐 Получение цены для ${coin.symbol}: GET ${url}`);
      
      try {
        const response = await getBingXData(url, params);
        if (!response) continue;
        
        if (response.code === 0 && response.data && response.data.price) {
          const price = parseFloat(response.data.price);
          const cleanSymbol = coin.symbol.replace('-USD', '').toLowerCase();
          prices[cleanSymbol] = price;
          console.log(`✅ Цена для ${coin.symbol}: $${price}`);
        } else {
          console.error(`❌ Ошибка для ${coin.symbol}:`, response.msg || 'Нет данных о цене');
        }
      } catch (error) {
        console.error(`❌ Не удалось получить цену для ${coin.symbol}:`, error.message);
      }
      
      // Задержка 2 сек между запросами к BingX
      await new Promise(r => setTimeout(r, 2000));
    }
    
    globalState.currentPrices = prices;
    return prices;
  } catch (error) {
    console.error('❌ Глобальная ошибка получения текущих цен:', error.message);
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
      symbol: symbol,
      side: 'LONG',
      leverage: leverage.toString(),
      timestamp,
      recvWindow: 5000
    };
    
    const signature = signBingXRequest(params);
    const url = `${BINGX_FUTURES_URL}/openApi/cswap/v1/trade/leverage?symbol=${params.symbol}&side=LONG&leverage=${params.leverage}&timestamp=${params.timestamp}&recvWindow=5000&signature=${signature}`;
    
    console.log(`🌐 Установка плеча для ${symbol}: POST ${url}`);
    
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
async function placeBingXFuturesOrder(symbol, side, type, quantity, price = null, leverage, positionSide) {
  try {
    if (!BINGX_API_KEY || !BINGX_SECRET_KEY) {
      console.log(`ℹ️ [ОРДЕР] API-ключи не заданы. Ордер ${side} ${quantity} ${symbol} симулирован.`);
      return { orderId: `fake_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` };
    }
    
    const leverageSet = await setBingXLeverage(symbol, leverage);
    if (!leverageSet) {
      console.log(`❌ Не удалось установить плечо ${leverage}x для ${symbol}`);
      return null;
    }
    
    const timestamp = Date.now();
    const params = {
      symbol: symbol,
      side: side,
      type: type,
      quantity: quantity.toFixed(6),
      timestamp: timestamp,
      positionSide: positionSide,
      recvWindow: 5000
    };
    
    if (price && type === 'LIMIT') {
      params.price = price.toFixed(8);
    }
    
    const signature = signBingXRequest(params);
    const url = `${BINGX_FUTURES_URL}/openApi/cswap/v1/trade/order?symbol=${params.symbol}&side=${params.side}&type=${params.type}&quantity=${params.quantity}&timestamp=${params.timestamp}&positionSide=${params.positionSide}&recvWindow=5000&signature=${signature}`;
    
    if (price && type === 'LIMIT') {
      url += `&price=${price.toFixed(8)}`;
    }
    
    console.log(`🌐 Размещение ордера: POST ${url}`);
    
    const response = await axios.post(url, null, {
      headers: { 
        'X-BX-APIKEY': BINGX_API_KEY,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 10000
    });
    
    if (response.data.code === 0) {
      console.log(`✅ УСПЕШНЫЙ ОРДЕР: ${side} ${quantity} ${symbol} (позиция: ${positionSide})`);
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
  const symbol = coin.symbol;
  const positionSide = direction === 'LONG' ? 'LONG' : 'SHORT';
  const side = direction === 'LONG' ? 'BUY' : 'SELL';
  
  console.log(`🌐 Отправка ${direction} ордера на BingX Futures: ${size} ${symbol} с плечом ${leverage}x`);
  console.log(`🔄 Текущий режим: ${globalState.isRealMode ? 'РЕАЛЬНЫЙ': 'ДЕМО'}`);
  console.log(`⚡ Торговый режим: ${globalState.tradeMode}`);
  console.log(`💣 Уровень риска: ${globalState.riskLevel}`);
  
  if (globalState.isRealMode) {
    const result = await placeBingXFuturesOrder(symbol, side, 'MARKET', size, null, leverage, positionSide);
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
        progress: 0,
        probability: 50,
        riskScore: calculateRiskScore(coin.name)
      };
      globalState.history.push(trade);
      globalState.positions[coin.name] = trade;
      globalState.stats.totalTrades++;
      globalState.marketMemory.consecutiveTrades[coin.name] = (globalState.marketMemory.consecutiveTrades[coin.name] || 0) + 1;
      globalState.stats.maxLeverageUsed = Math.max(globalState.stats.maxLeverageUsed, leverage);
      console.log(`✅ УСПЕШНО: ${direction} ${size} ${coin.name} на BingX Futures`);
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
      progress: 0,
      probability: 50,
      riskScore: calculateRiskScore(coin.name)
    };
    globalState.history.push(trade);
    globalState.positions[coin.name] = trade;
    globalState.stats.totalTrades++;
    globalState.marketMemory.consecutiveTrades[coin.name] = (globalState.marketMemory.consecutiveTrades[coin.name] || 0) + 1;
    globalState.stats.maxLeverageUsed = Math.max(globalState.stats.maxLeverageUsed, leverage);
    console.log(`✅ ДЕМО: ${direction} ${size} ${coin.name} с плечом ${leverage}x`);
    return true;
  }
}

// ==========================
// ФУНКЦИЯ: Расчет рисковой оценки для монеты
// ==========================
function calculateRiskScore(coin) {
  const fundamentalData = globalState.marketMemory.fundamentalData[coin];
  const volatility = globalState.marketMemory.volatilityHistory[coin][globalState.marketMemory.volatilityHistory[coin].length - 1] || 0.02;
  let riskScore = 50;
  if (volatility > 0.05) riskScore += 20;
  if (volatility < 0.02) riskScore -= 10;
  if (fundamentalData && fundamentalData.developerActivity) {
    if (fundamentalData.developerActivity > 100) riskScore -= 15;
    else if (fundamentalData.developerActivity < 20) riskScore += 25;
  }
  if (globalState.fearIndex < 30) riskScore -= 15;
  else if (globalState.fearIndex > 70) riskScore += 15;
  return Math.max(0, Math.min(100, riskScore));
}

// ==========================
// ФУНКЦИЯ: УНИКАЛЬНЫЙ АДАПТИВНЫЙ АНАЛИЗ
// ==========================
function analyzeMarketWithAdaptiveStrategy(candles, coinName, currentFearIndex, fundamentalData) {
  if (candles.length < 50) return null;
  const prices = candles.map(c => c.close);
  const currentPrice = prices[prices.length - 1];
  const sma20 = calculateSMA(prices, 20);
  const sma50 = calculateSMA(prices, 50);
  const sma200 = calculateSMA(prices, 200);
  const atr = calculateATR(candles.slice(-14));
  const rsi = calculateRSI(prices.slice(-14));
  const bollingerUpper = calculateBollingerBands(prices, 20, 2).upper;
  const bollingerLower = calculateBollingerBands(prices, 20, 2).lower;
  const macd = calculateMACD(prices);
  const ichimoku = calculateIchimokuCloud(candles);
  const volatility = atr / currentPrice;
  const isHighVolatility = volatility > 0.05;
  const isLowVolatility = volatility < 0.02;
  const isUptrend = sma20 > sma50 && sma50 > sma200;
  const isDowntrend = sma20 < sma50 && sma50 < sma200;
  const isSideways = Math.abs(sma20 - sma50) / sma20 < 0.01;
  const isOverbought = rsi > 70;
  const isOversold = rsi < 30;
  const isMACDBullish = macd.macd > macd.signal;
  const isMACDBearish = macd.macd < macd.signal;
  const isIchimokuBullish = currentPrice > ichimoku.senkouSpanA && currentPrice > ichimoku.senkouSpanB;
  const isIchimokuBearish = currentPrice < ichimoku.senkouSpanA && currentPrice < ichimoku.senkouSpanB;
  const isBollingerUpperBreak = currentPrice > bollingerUpper;
  const isBollingerLowerBreak = currentPrice < bollingerLower;
  const isBollingerSqueeze = (bollingerUpper - bollingerLower) / sma20 < 0.01;
  const fundamentalScore = fundamentalData ? calculateFundamentalScore(fundamentalData) : 50;
  const marketSentiment = calculateMarketSentiment(currentFearIndex, fundamentalScore);
  let signal = {
    direction: null,
    confidence: 0.5,
    leverage: 1,
    reasoning: [],
    stopLoss: null,
    takeProfit: null,
    riskScore: 50
  };
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
  if (currentFearIndex < 25 && signal.direction === 'LONG') {
    signal.confidence += 0.15;
    signal.reasoning.push("😱 Сильный страх + перепроданность → отличная возможность для LONG");
  }
  if (currentFearIndex > 75 && signal.direction === 'SHORT') {
    signal.confidence += 0.15;
    signal.reasoning.push("🤑 Сильная жадность + перекупленность → отличная возможность для SHORT");
  }
  if (fundamentalScore > 70 && signal.direction === 'LONG') {
    signal.confidence += 0.1;
    signal.reasoning.push("📊 Высокая фундаментальная оценка → поддержка LONG");
  }
  if (fundamentalScore < 30 && signal.direction === 'SHORT') {
    signal.confidence += 0.1;
    signal.reasoning.push("📊 Низкая фундаментальная оценка → поддержка SHORT");
  }
  signal.riskScore = calculateRiskScore(coinName);
  const atrMultiplier = isHighVolatility ? 2.5 : 1.5;
  const volatilityFactor = isLowVolatility ? 0.8 : 1.2;
  if (signal.direction === 'LONG') {
    signal.stopLoss = currentPrice * (1 - (volatility * volatilityFactor * 3));
    signal.takeProfit = currentPrice * (1 + (volatility * volatilityFactor * 6));
    if (isHighVolatility) {
      signal.leverage = Math.min(3, globalState.maxLeverage * 0.5);
      signal.reasoning.push("⚠️ Высокая волатильность → снижаем плечо");
    } else if (isLowVolatility) {
      signal.leverage = Math.min(10, globalState.maxLeverage * 1.5);
      signal.reasoning.push("📉 Низкая волатильность → увеличиваем плечо");
    } else {
      signal.leverage = globalState.maxLeverage;
    }
  } else if (signal.direction === 'SHORT') {
    signal.stopLoss = currentPrice * (1 + (volatility * volatilityFactor * 3));
    signal.takeProfit = currentPrice * (1 - (volatility * volatilityFactor * 6));
    if (isHighVolatility) {
      signal.leverage = Math.min(3, globalState.maxLeverage * 0.5);
      signal.reasoning.push("⚠️ Высокая волатильность → снижаем плечо");
    } else if (isLowVolatility) {
      signal.leverage = Math.min(10, globalState.maxLeverage * 1.5);
      signal.reasoning.push("📉 Низкая волатильность → увеличиваем плечо");
    } else {
      signal.leverage = globalState.maxLeverage;
    }
  }
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
  if (fundamentalData.developerActivity) {
    if (fundamentalData.developerActivity > 100) score += 20;
    else if (fundamentalData.developerActivity > 50) score += 10;
    else if (fundamentalData.developerActivity < 20) score -= 15;
    else if (fundamentalData.developerActivity < 10) score -= 25;
  }
  if (fundamentalData.socialSentiment) {
    if (fundamentalData.socialSentiment > 70) score += 15;
    else if (fundamentalData.socialSentiment > 50) score += 5;
    else if (fundamentalData.socialSentiment < 30) score -= 15;
    else if (fundamentalData.socialSentiment < 10) score -= 25;
  }
  return Math.max(0, Math.min(100, score));
}
function calculateMarketSentiment(fearIndex, fundamentalScore) {
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
    if (position.type === 'LONG' && currentPrice >= position.takeProfit) {
      shouldClose = true;
      reason = '🎯 Достигнут тейк-профит — фиксируем прибыль';
    } else if (position.type === 'SHORT' && currentPrice <= position.takeProfit) {
      shouldClose = true;
      reason = '🎯 Достигнут тейк-профит — фиксируем прибыль';
    }
    if (position.type === 'LONG' && currentPrice <= position.stopLoss) {
      shouldClose = true;
      reason = '🛑 Сработал стоп-лосс';
    } else if (position.type === 'SHORT' && currentPrice >= position.stopLoss) {
      shouldClose = true;
      reason = '🛑 Сработал стоп-лосс';
    }
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
          if (globalState.isRealMode) {}
          else {
            globalState.balance += (trade.size * trade.entryPrice * trade.profitPercent);
          }
        } else {
          globalState.stats.losingTrades++;
          if (globalState.isRealMode) {}
          else {
            globalState.balance += (trade.size * trade.entryPrice * trade.profitPercent);
          }
        }
      }
      globalState.positions[coin.name] = null;
      globalState.marketMemory.consecutiveTrades[coin.name] = 0;
    } else {
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
  if (globalState.tradeMode === 'scalping') {
    globalState.scalpingSettings = {
      takeProfitPercent: 0.01,
      stopLossPercent: 0.005
    };
  } else if (globalState.tradeMode === 'swing') {
    globalState.scalpingSettings = {
      takeProfitPercent: 0.05,
      stopLossPercent: 0.03
    };
  } else {
    globalState.scalpingSettings = {
      takeProfitPercent: 0.03,
      stopLossPercent: 0.02
    };
  }
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
      console.log('💥 Установлен ЭКСТРЕМАЛЬНЫЙ уровень риска: 10%, плечо 20x (ОЧЕНЬ ВЫСОКИЙ РИСК!)');
      break;
  }
  return globalState.riskLevel;
}

// ==========================
// ФУНКЦИЯ: Получение фундаментальных данных монеты
// ==========================
async function getFundamentalData(coin) {
  const now = Date.now();
  const cacheKey = coin.name;
  const cacheDuration = 300000; // 5 минут
  if (globalState.fundamentalCache[cacheKey] && 
      now - globalState.fundamentalCache[cacheKey].timestamp < cacheDuration) {
    console.log(`💾 Использую кэшированные фундаментальные данные для ${coin.name}`);
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
      fundamentalData.socialSentiment = data.market_data.sentiment_votes_up_percentage || 50;
    }
    if (data.developer_data) {
      fundamentalData.developerActivity = data.developer_data.commits_30d || 0;
    }
    // ❌ УБРАНО: НЕ ПЕРЕЗАПИСЫВАЕМ через twitter_followers!
    globalState.fundamentalCache[cacheKey] = {
      fundamentalData,
      timestamp: now
    };
    globalState.marketMemory.fundamentalData[coin.name] = fundamentalData;
    // Увеличена задержка до 10 секунд для предотвращения 429
    await new Promise(r => setTimeout(r, 10000));
    return fundamentalData;
  } catch (error) {
    console.error(`❌ Ошибка получения фундаментальных данных для ${coin.name}:`, error.message);
    if (globalState.fundamentalCache[cacheKey]) {
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
// ФУНКЦИЯ: Тестирование API BingX
// ==========================
async function testBingXAPI() {
  try {
    console.log('🧪 [ТЕСТ] Начинаю тестирование API BingX...');
    if (!BINGX_API_KEY || !BINGX_SECRET_KEY) {
      console.error('❌ [ТЕСТ] API-ключи не заданы в переменных окружения');
      return { success: false, message: 'API-ключи не заданы' };
    }
    const balance = await getBingXRealBalance();
    if (balance === null) {
      console.error('❌ [ТЕСТ] Не удалось получить баланс');
      return { success: false, message: 'Не удалось получить баланс' };
    }
    const btcPrice = await getCurrentPrices();
    const btcPriceValue = btcPrice.bitcoin || 62450.50;
    const riskPercent = 0.3;
    const stopLossPercent = 0.02;
    const riskAmount = balance * riskPercent;
    const stopDistance = btcPriceValue * stopLossPercent;
    const size = riskAmount / stopDistance;
    console.log(`🧪 [ТЕСТ] Открываем тестовую позицию LONG с риском 30% от баланса: $${riskAmount.toFixed(2)}`);
    const result = await placeBingXFuturesOrder(
      'BTC-USD',
      'BUY',
      'MARKET',
      size,
      null,
      3,
      'LONG'
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
// HTTP-сервер для веб-интерфейса
// ==========================
const app = express();
const PORT = process.env.PORT || 10000;

// Middleware для аутентификации
function authenticate(req, res, next) {
  // Разрешаем доступ к странице входа
  if (req.path === '/login' || req.path === '/favicon.ico' || req.path === '/login.css') {
    return next();
  }
  
  // Проверяем наличие токена в cookies
  if (req.cookies.authToken) {
    return next();
  }
  
  // Если нет токена, перенаправляем на страницу входа
  res.redirect('/login');
}

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(authenticate);

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
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          margin: 0;
          padding: 20px;
          background-color: #f5f5f5;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
        }
        .login-form {
          max-width: 400px;
          margin: 0 auto;
          padding: 20px;
          background: white;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .login-form h2 {
          text-align: center;
          margin-bottom: 20px;
        }
        .login-form input {
          width: 100%;
          padding: 10px;
          margin-bottom: 15px;
          border: 1px solid #ddd;
          border-radius: 4px;
        }
        .login-form button {
          width: 100%;
          padding: 10px;
          background: #3498db;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }
        .login-form button:hover {
          background: #2980b9;
        }
      </style>
    </head>
    <body>
      <div class="login-form">
        <h2>Вход в систему</h2>
        <form id="loginForm">
          <input type="password" name="password" placeholder="Пароль" required>
          <button type="submit">Войти</button>
        </form>
      </div>
      <script>
        document.getElementById('loginForm').addEventListener('submit', function(e) {
          e.preventDefault();
          const password = document.querySelector('input[name="password"]').value;
          fetch('/login', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ password })
          }).then(response => response.json())
            .then(data => {
              if (data.success) {
                // Сохраняем авторизацию в cookies
                document.cookie = "authToken=true; path=/; max-age=3600";
                window.location.href = '/';
              } else {
                alert('Неверный пароль');
              }
            });
        });
      </script>
    </body>
    </html>
  `);
});

app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === APP_PASSWORD) {
    res.cookie('authToken', 'true', { path: '/', maxAge: 3600000 }); // Установить cookie на 1 час
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: 'Неверный пароль' });
  }
});

app.get('/logout', (req, res) => {
  res.clearCookie('authToken', { path: '/' });
  res.redirect('/login');
});

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Торговый Бот</title>
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          margin: 0;
          padding: 20px;
          background-color: #f5f5f5;
          color: #333;
        }
        .container {
          max-width: 1000px;
          margin: 0 auto;
        }
        @media (max-width: 768px) {
          .container {
            padding: 10px;
          }
          h1 {
            font-size: 1.5rem;
          }
          table {
            font-size: 0.9rem;
          }
        }
        h1 {
          color: #2c3e50;
          margin-bottom: 10px;
        }
        h2 {
          color: #3498db;
          margin-top: 20px;
          margin-bottom: 10px;
        }
        p {
          margin: 10px 0;
        }
        .stats {
          display: flex;
          flex-wrap: wrap;
          gap: 20px;
          margin-bottom: 20px;
        }
        .stat-card {
          background: white;
          padding: 15px;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          flex: 1;
          min-width: 200px;
        }
        .stat-value {
          font-size: 1.5rem;
          font-weight: bold;
          color: #2c3e50;
        }
        .stat-label {
          color: #7f8c8d;
          font-size: 0.9rem;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 10px;
        }
        th, td {
          padding: 10px;
          text-align: left;
          border-bottom: 1px solid #ddd;
        }
        th {
          background-color: #f2f2f2;
        }
        .trading-view {
          background: white;
          padding: 15px;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          margin-top: 20px;
        }
        .trading-view canvas {
          width: 100%;
          height: 300px;
        }
        .settings {
          background: white;
          padding: 15px;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          margin-top: 20px;
        }
        .settings h2 {
          margin-top: 0;
        }
        .settings form {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
        }
        @media (max-width: 768px) {
          .settings form {
            grid-template-columns: 1fr;
          }
        }
        .settings input, .settings select {
          padding: 8px;
          border: 1px solid #ddd;
          border-radius: 4px;
        }
        .settings button {
          padding: 8px 15px;
          background: #3498db;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }
        .settings button:hover {
          background: #2980b9;
        }
        .logout-button {
          background: #e74c3c;
          margin-top: 15px;
        }
        .logout-button:hover {
          background: #c0392b;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Торговый Бот</h1>
        <div class="stats">
          <div class="stat-card">
            <div class="stat-value">$${globalState.balance.toFixed(2)}</div>
            <div class="stat-label">Баланс</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${globalState.stats.totalTrades}</div>
            <div class="stat-label">Сделок всего</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${globalState.stats.profitableTrades}</div>
            <div class="stat-label">Прибыльных</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${globalState.stats.losingTrades}</div>
            <div class="stat-label">Убыточных</div>
          </div>
        </div>
        <h2>Текущий режим: ${globalState.isRealMode ? 'РЕАЛЬНЫЙ' : 'ДЕМО'}</h2>
        <div class="settings">
          <h2>Настройки</h2>
          <form id="settingsForm">
            <div>
              <label for="riskLevel">Уровень риска:</label>
              <select id="riskLevel" name="riskLevel">
                <option value="recommended" ${globalState.riskLevel === 'recommended' ? 'selected' : ''}>Рекомендуемый</option>
                <option value="medium" ${globalState.riskLevel === 'medium' ? 'selected' : ''}>Средний</option>
                <option value="high" ${globalState.riskLevel === 'high' ? 'selected' : ''}>Высокий</option>
                <option value="extreme" ${globalState.riskLevel === 'extreme' ? 'selected' : ''}>Экстремальный</option>
              </select>
            </div>
            <div>
              <label for="tradeMode">Торговый режим:</label>
              <select id="tradeMode" name="tradeMode">
                <option value="adaptive" ${globalState.tradeMode === 'adaptive' ? 'selected' : ''}>Адаптивный</option>
                <option value="scalping" ${globalState.tradeMode === 'scalping' ? 'selected' : ''}>Скальпинг</option>
                <option value="swing" ${globalState.tradeMode === 'swing' ? 'selected' : ''}>Свинг</option>
              </select>
            </div>
            <div>
              <label for="realMode">Режим:</label>
              <select id="realMode" name="realMode">
                <option value="demo" ${!globalState.isRealMode ? 'selected' : ''}>Демо</option>
                <option value="real" ${globalState.isRealMode ? 'selected' : ''}>Реальный</option>
              </select>
            </div>
            <button type="submit" class="logout-button" onclick="document.cookie='authToken=; path=/; max-age=0'; window.location.href='/logout'">Выйти</button>
            <button type="submit">Сохранить настройки</button>
          </form>
        </div>
        <h2>Последние сделки</h2>
        <table>
          <thead>
            <tr>
              <th>Время</th>
              <th>Монета</th>
              <th>Тип</th>
              <th>Цена</th>
              <th>Прибыль</th>
            </tr>
          </thead>
          <tbody>
            ${globalState.history.slice(-5).map(h => `
              <tr>
                <td>${h.timestamp}</td>
                <td>${h.coin}</td>
                <td>${h.type}</td>
                <td>$${h.entryPrice.toFixed(2)}</td>
                <td style="color: ${h.profitPercent > 0 ? 'green' : 'red'}">${h.profitPercent > 0 ? '+' : ''}${(h.profitPercent * 100).toFixed(2)}%</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <script>
        document.getElementById('settingsForm').addEventListener('submit', function(e) {
          e.preventDefault();
          const formData = new FormData(this);
          fetch('/update-settings', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(Object.fromEntries(formData))
          }).then(response => response.json())
            .then(data => {
              if (data.success) {
                alert('Настройки сохранены!');
                location.reload();
              }
            });
        });
      </script>
    </body>
    </html>
  `);
});

app.post('/update-settings', (req, res) => {
  const { riskLevel, tradeMode, realMode } = req.body;
  
  if (riskLevel) {
    setRiskLevel(riskLevel);
  }
  
  if (tradeMode) {
    globalState.tradeMode = tradeMode;
  }
  
  if (realMode) {
    globalState.isRealMode = (realMode === 'real');
    if (globalState.isRealMode) {
      forceUpdateRealBalance();
    }
  }
  
  res.json({ success: true, message: 'Настройки сохранены' });
});

// ==========================
// ГЛАВНАЯ ФУНКЦИЯ — ЦИКЛ БОТА
// ==========================
(async () => {
  console.log('🤖 ЗАПУСК ТОРГОВОГО БОТА (BINGX API)');
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

      // Получаем фундаментальные данные с задержкой 10000 мс
      for (const coin of globalState.watchlist) {
        await getFundamentalData(coin);
      }

      await checkOpenPositions(currentPrices);

      let bestOpportunity = null;
      let bestReasoning = [];

      for (const coin of globalState.watchlist) {
        console.log(`\n🔍 Анализирую ${coin.name}...`);
        const candles = await getBingXFuturesHistory(coin.symbol, '1h', 100);

        if (candles.length < 50) {
          console.log(`   ⚠️ Пропускаем ${coin.name} — недостаточно данных`);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        const analysis = analyzeMarketWithAdaptiveStrategy(candles, coin.name, fearIndex, globalState.marketMemory.fundamentalData[coin.name]);

        if (!analysis || !analysis.signal.direction) {
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        console.log(`   ✅ Сигнал: ${analysis.signal.direction}`);
        analysis.signal.reasoning.forEach(r => console.log(`   • ${r}`));

        if (!bestOpportunity || analysis.signal.confidence > bestOpportunity.signal.confidence) {
          bestOpportunity = analysis;
          bestReasoning = analysis.signal.reasoning;
        }

        await new Promise(r => setTimeout(r, 2000));
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

// ==========================
// ОБРАБОТКА ОШИБОК
// ==========================
app.use((err, req, res, next) => {
  console.error('Ошибка сервера:', err.stack);
  res.status(500).send('Внутренняя ошибка сервера');
});

// ==========================
// ЗАПУСК СЕРВЕРА
// ==========================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`🌐 Доступ к интерфейсу: https://cryptophilosopherbot-0o69.onrender.com`);
  console.log(`🔐 Пароль для входа: ${APP_PASSWORD}`);
});
