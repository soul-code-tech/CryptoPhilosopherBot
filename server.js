const axios = require('axios');
const CryptoJS = require('crypto-js');
const fs = require('fs');
const dotenv = require('dotenv');
const http = require('http');

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
  takerFee: 0.0005, // Комиссия за сделку (Taker)
  makerFee: 0.0002, // Комиссия за лимитный ордер (Maker)
  maxRiskPerTrade: 0.01,
  maxLeverage: 3,
  // Расширенный список монет (50+)
  watchlist: [
    // Топ-20 по капитализации
    { symbol: 'BTC-USDT', name: 'bitcoin' },
    { symbol: 'ETH-USDT', name: 'ethereum' },
    { symbol: 'BNB-USDT', name: 'binancecoin' },
    { symbol: 'SOL-USDT', name: 'solana' },
    { symbol: 'XRP-USDT', name: 'ripple' },
    { symbol: 'ADA-USDT', name: 'cardano' },
    { symbol: 'DOGE-USDT', name: 'dogecoin' },
    { symbol: 'LINK-USDT', name: 'chainlink' },
    { symbol: 'MATIC-USDT', name: 'polygon' },
    { symbol: 'DOT-USDT', name: 'polkadot' },
    { symbol: 'AVAX-USDT', name: 'avalanche' },
    { symbol: 'SHIB-USDT', name: 'shiba-inu' },
    { symbol: 'TRX-USDT', name: 'tron' },
    { symbol: 'TON-USDT', name: 'the-open-network' },
    { symbol: 'ATOM-USDT', name: 'cosmos' },
    { symbol: 'UNI-USDT', name: 'uniswap' },
    { symbol: 'LTC-USDT', name: 'litecoin' },
    { symbol: 'PEPE-USDT', name: 'pepe' },
    { symbol: 'OKB-USDT', name: 'okb' },
    { symbol: 'BCH-USDT', name: 'bitcoin-cash' },
    // Дополнительные популярные монеты
    { symbol: 'APT-USDT', name: 'aptos' },
    { symbol: 'ARB-USDT', name: 'arbitrum' },
    { symbol: 'OP-USDT', name: 'optimism' },
    { symbol: 'FIL-USDT', name: 'filecoin' },
    { symbol: 'ICP-USDT', name: 'internet-computer' },
    { symbol: 'RNDR-USDT', name: 'render-token' },
    { symbol: 'INJ-USDT', name: 'injective-protocol' },
    { symbol: 'LDO-USDT', name: 'lido-dao' },
    { symbol: 'HBAR-USDT', name: 'hedera-hashgraph' },
    { symbol: 'TIA-USDT', name: 'celestia' },
    { symbol: 'NEAR-USDT', name: 'near' },
    { symbol: 'FTM-USDT', name: 'fantom' },
    { symbol: 'VET-USDT', name: 'vechain' },
    { symbol: 'ALGO-USDT', name: 'algorand' },
    { symbol: 'QNT-USDT', name: 'quant' },
    { symbol: 'FLOW-USDT', name: 'flow' },
    { symbol: 'GRT-USDT', name: 'the-graph' },
    { symbol: 'AXS-USDT', name: 'axie-infinity' },
    { symbol: 'THETA-USDT', name: 'theta-token' },
    { symbol: 'EGLD-USDT', name: 'multiversx' },
    { symbol: 'SAND-USDT', name: 'the-sandbox' },
    { symbol: 'MANA-USDT', name: 'decentraland' },
    { symbol: 'CHZ-USDT', name: 'chiliz' },
    { symbol: 'KAVA-USDT', name: 'kava' },
    { symbol: 'MINA-USDT', name: 'mina-protocol' },
    { symbol: 'IMX-USDT', name: 'immutable-x' },
    { symbol: 'MKR-USDT', name: 'maker' },
    { symbol: 'AAVE-USDT', name: 'aave' },
    { symbol: 'CRV-USDT', name: 'curve-dao-token' },
    { symbol: 'SNX-USDT', name: 'synthetix-network-token' },
    { symbol: 'COMP-USDT', name: 'compound-governance-token' },
    { symbol: 'YFI-USDT', name: 'yearn-finance' },
    { symbol: 'GMX-USDT', name: 'gmx' },
    { symbol: 'DYDX-USDT', name: 'dydx' },
    { symbol: 'WLD-USDT', name: 'worldcoin' },
    { symbol: 'JUP-USDT', name: 'jupiter-exchange-solana' },
    { symbol: 'STRK-USDT', name: 'starknet' },
    { symbol: 'ENA-USDT', name: 'ethena' },
    { symbol: 'ONDO-USDT', name: 'ondo-finance' },
    { symbol: 'SEI-USDT', name: 'sei-network' },
    { symbol: 'TAO-USDT', name: 'bittensor' },
    { symbol: 'RUNE-USDT', name: 'thorchain' },
    { symbol: 'PENDLE-USDT', name: 'pendle' },
    { symbol: 'AKT-USDT', name: 'akash-network' },
    { symbol: 'PYTH-USDT', name: 'pyth-network' },
    { symbol: 'JTO-USDT', name: 'jito' },
    { symbol: 'METIS-USDT', name: 'metis-token' },
    { symbol: 'AEVO-USDT', name: 'aevo' },
    { symbol: 'ZRO-USDT', name: 'layerzero' },
    { symbol: 'DYM-USDT', name: 'dymension' },
    { symbol: 'TNSR-USDT', name: 'tensor' },
    { symbol: 'IO-USDT', name: 'io' }
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
// Новый токен для доступа к API бота со стороны веб-интерфейса
const API_SECRET_TOKEN = process.env.API_SECRET_TOKEN || 'my_default_super_secret_token';
const PORT = process.env.PORT || 3000;

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
  // Сортируем ключи для согласованности
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
    // ИСПРАВЛЕНО: Правильный эндпоинт для свечей
    const url = `${BINGX_FUTURES_URL}/openApi/swap/v2/quote/klines?symbol=${params.symbol}&interval=${params.interval}&limit=${params.limit}&timestamp=${params.timestamp}&recvWindow=5000&signature=${signature}`;
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
      // ИСПРАВЛЕНО: Правильный эндпоинт для получения цены
      const url = `${BINGX_FUTURES_URL}/openApi/swap/v2/quote/price?symbol=${params.symbol}&timestamp=${params.timestamp}&recvWindow=5000&signature=${signature}`;
      console.log(`🌐 Получение цены для ${coin.symbol}: GET ${url}`);
      try {
        const response = await axios.get(url, {
          headers: { 'X-BX-APIKEY': BINGX_API_KEY },
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
      await new Promise(r => setTimeout(r, 300)); // Уменьшаем задержку до 300мс
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
      side: 'BOTH', // BingX использует 'BOTH' для универсального плеча
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
  const positionSide = direction; // Для BingX в режиме One-way mode
  const side = direction === 'LONG' ? 'BUY' : 'SELL';

  console.log(`🌐 Отправка ${direction} ордера на BingX: ${size} ${symbol} с плечом ${leverage}x`);
  console.log(`🔄 Текущий режим: ${globalState.isRealMode ? 'РЕАЛЬНЫЙ' : 'ДЕМО'}`);

  if (globalState.isRealMode) {
    // Устанавливаем плечо
    const leverageSet = await setBingXLeverage(symbol, leverage);
    if (!leverageSet) {
      console.log(`❌ Не удалось установить плечо ${leverage}x для ${symbol}`);
      return false;
    }

    const result = await placeBingXFuturesOrder(symbol, side, 'MARKET', size, null, positionSide);
    if (result) {
      const fee = size * price * globalState.takerFee; // Расчет комиссии
      const trade = {
        coin: coin.name,
        type: direction,
        size,
        entryPrice: price,
        currentPrice: price,
        leverage,
        stopLoss,
        takeProfit,
        fee, // <-- Сохраняем комиссию
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
    const fee = size * price * globalState.takerFee; // Расчет комиссии
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
      fee, // <-- Сохраняем комиссию
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
    await new Promise(r => setTimeout(r, 1000)); // Задержка для Coingecko API
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
// ФУНКЦИЯ: Проверка открытых позиций
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
// ФУНКЦИЯ: Аутентификация API
// ==========================
function authenticateAPI(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return false;
  }
  const token = authHeader.split(' ')[1]; // Bearer <token>
  return token === API_SECRET_TOKEN;
}

// ==========================
// HTTP-СЕРВЕР ДЛЯ API (порт 3000)
// ==========================
const requestHandler = async (req, res) => {
  // Разрешаем CORS для всех источников
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Обработка preflight запросов
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Проверяем путь
  if (!req.url.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
    return;
  }

  // Проверяем аутентификацию для всех /api/* запросов
  if (!authenticateAPI(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  try {
    if (req.url === '/api/status' && req.method === 'GET') {
      const openPositions = Object.values(globalState.positions).filter(p => p !== null);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
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
      }));
    } else if (req.url === '/api/toggle-mode' && req.method === 'POST') {
      const newMode = toggleMode();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, isRealMode: newMode, message: `Режим успешно переключен на ${newMode ? 'РЕАЛЬНЫЙ' : 'ДЕМО'}` }));
    } else if (req.url === '/api/toggle-trade-mode' && req.method === 'POST') {
      const newMode = toggleTradeMode();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, tradeMode: newMode, message: `Стратегия успешно изменена на ${newMode}` }));
    } else if (req.url === '/api/set-risk-level' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          const { level } = JSON.parse(body);
          setRiskLevel(level);
          let message = '';
          switch(level) {
            case 'recommended': message = 'Уровень риска установлен на РЕКОМЕНДУЕМЫЙ (1%, плечо 3x)'; break;
            case 'medium': message = 'Уровень риска установлен на СРЕДНИЙ (2%, плечо 5x)'; break;
            case 'high': message = 'Уровень риска установлен на ВЫСОКИЙ (5%, плечо 10x)'; break;
            case 'extreme': message = 'Уровень риска установлен на ЭКСТРЕМАЛЬНЫЙ (10%, плечо 20x)'; break;
            default: message = `Уровень риска установлен на ${level}`;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, riskLevel: level, message: message }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Bad Request' }));
        }
      });
      return;
    } else if (req.url === '/api/logout' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Вы успешно вышли из системы' }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Endpoint not found' }));
    }
  } catch (error) {
    console.error('API Error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal Server Error' }));
  }
};

const server = http.createServer(requestHandler);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 API сервер бота запущен на порту ${PORT}`);
  console.log(`🔐 Для доступа используйте токен: ${API_SECRET_TOKEN}`);
  console.log('✅ ВАЖНО: Убедитесь, что установлены переменные окружения:');
  console.log('   - BINGX_API_KEY');
  console.log('   - BINGX_SECRET_KEY');
  console.log('   - API_SECRET_TOKEN');
});

// ==========================
// ГЛАВНАЯ ФУНКЦИЯ — ЦИКЛ БОТА
// ==========================
(async () => {
  console.log('🤖 ЗАПУСК ТОРГОВОГО БОТА (ФИНАЛЬНАЯ ВЕРСИЯ)');
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
      const url = `${BINGX_FUTURES_URL}/openApi/swap/v2/quote/price?symbol=${params.symbol}&timestamp=${params.timestamp}&recvWindow=5000&signature=${signature}`;
      const response = await axios.get(url, {
        headers: { 'X-BX-APIKEY': BINGX_API_KEY },
        timeout: 10000
      });
      if (response.data.code === 0 && response.data.data && response.data.data.price) {
        console.log(`✅ Монета ${coin.symbol} доступна на BingX`);
      } else {
        console.warn(`⚠️ Монета ${coin.symbol} НЕ доступна на BingX. Ответ:`, JSON.stringify(response.data));
        globalState.watchlist = globalState.watchlist.filter(c => c.symbol !== coin.symbol);
        console.warn(`⚠️ Монета ${coin.symbol} удалена из watchlist`);
      }
    } catch (error) {
      console.error(`❌ Ошибка проверки доступности ${coin.symbol}:`, error.message);
      if (error.response) {
        console.error('❌ Ответ от BingX:', JSON.stringify(error.response.data));
      }
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
