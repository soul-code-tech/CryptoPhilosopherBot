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
  // Расширенный список из 100+ монет
  watchlist: [
    { symbol: 'BTC-USDT', name: 'bitcoin' },
    { symbol: 'ETH-USDT', name: 'ethereum' },
    { symbol: 'BNB-USDT', name: 'binancecoin' },
    { symbol: 'SOL-USDT', name: 'solana' },
    { symbol: 'XRP-USDT', name: 'ripple' },
    { symbol: 'USDC-USDT', name: 'usd-coin' },
    { symbol: 'ADA-USDT', name: 'cardano' },
    { symbol: 'AVAX-USDT', name: 'avalanche-2' },
    { symbol: 'DOGE-USDT', name: 'dogecoin' },
    { symbol: 'TRX-USDT', name: 'tron' },
    { symbol: 'DOT-USDT', name: 'polkadot' },
    { symbol: 'TON-USDT', name: 'the-open-network' },
    { symbol: 'LINK-USDT', name: 'chainlink' },
    { symbol: 'MATIC-USDT', name: 'polygon' },
    { symbol: 'ICP-USDT', name: 'internet-computer' },
    { symbol: 'SHIB-USDT', name: 'shiba-inu' },
    { symbol: 'APT-USDT', name: 'aptos' },
    { symbol: 'UNI-USDT', name: 'uniswap' },
    { symbol: 'LTC-USDT', name: 'litecoin' },
    { symbol: 'DAI-USDT', name: 'dai' },
    { symbol: 'ARB-USDT', name: 'arbitrum' },
    { symbol: 'OP-USDT', name: 'optimism' },
    { symbol: 'STRK-USDT', name: 'starknet' },
    { symbol: 'INJ-USDT', name: 'injective-protocol' },
    { symbol: 'TIA-USDT', name: 'celestia' },
    { symbol: 'SEI-USDT', name: 'sei-network' },
    { symbol: 'SUI-USDT', name: 'sui' },
    { symbol: 'FET-USDT', name: 'fetch-ai' },
    { symbol: 'RNDR-USDT', name: 'render-token' },
    { symbol: 'IMX-USDT', name: 'immutable-x' },
    { symbol: 'ONDO-USDT', name: 'ondo-finance' },
    { symbol: 'WLD-USDT', name: 'worldcoin' },
    { symbol: 'JUP-USDT', name: 'jupiter-exchange-solana' },
    { symbol: 'ENA-USDT', name: 'ethena' },
    { symbol: 'TAO-USDT', name: 'bittensor' },
    { symbol: 'BONK-USDT', name: 'bonk' },
    { symbol: 'PEPE-USDT', name: 'pepe' },
    { symbol: 'WIF-USDT', name: 'dogwifhat' },
    { symbol: 'AAVE-USDT', name: 'aave' },
    { symbol: 'MKR-USDT', name: 'maker' },
    { symbol: 'COMP-USDT', name: 'compound-governance-token' },
    { symbol: 'SNX-USDT', name: 'synthetix-network-token' },
    { symbol: 'CRV-USDT', name: 'curve-dao-token' },
    { symbol: 'BAL-USDT', name: 'balancer' },
    { symbol: 'GRT-USDT', name: 'the-graph' },
    { symbol: 'SUSHI-USDT', name: 'sushi' },
    { symbol: 'CAKE-USDT', name: 'pancakeswap-token' },
    { symbol: 'GMX-USDT', name: 'gmx' },
    { symbol: 'PENDLE-USDT', name: 'pendle' },
    { symbol: 'FXS-USDT', name: 'frax-share' },
    { symbol: 'LDO-USDT', name: 'lido-dao' },
    { symbol: 'YFI-USDT', name: 'yearn-finance' },
    { symbol: 'AGIX-USDT', name: 'singularitynet' },
    { symbol: 'OCEAN-USDT', name: 'ocean-protocol' },
    { symbol: 'NMR-USDT', name: 'numeraire' },
    { symbol: 'AKT-USDT', name: 'akash-network' },
    { symbol: 'TNSR-USDT', name: 'tensor' },
    { symbol: 'GALA-USDT', name: 'gala' },
    { symbol: 'SAND-USDT', name: 'the-sandbox' },
    { symbol: 'MANA-USDT', name: 'decentraland' },
    { symbol: 'AXS-USDT', name: 'axie-infinity' },
    { symbol: 'ILV-USDT', name: 'illuvium' },
    { symbol: 'MAGIC-USDT', name: 'magic' },
    { symbol: 'FLOKI-USDT', name: 'floki' },
    { symbol: 'BOME-USDT', name: 'book-of-meme' },
    { symbol: 'MOG-USDT', name: 'mog-coin' },
    { symbol: 'PYTH-USDT', name: 'pyth-network' },
    { symbol: 'USDE-USDT', name: 'ethena-usde' },
    { symbol: 'FDUSD-USDT', name: 'first-digital-usd' },
    { symbol: 'TUSD-USDT', name: 'true-usd' },
    { symbol: 'XLM-USDT', name: 'stellar' },
    { symbol: 'ALGO-USDT', name: 'algorand' },
    { symbol: 'VET-USDT', name: 'vechain' },
    { symbol: 'FIL-USDT', name: 'filecoin' },
    { symbol: 'HBAR-USDT', name: 'hedera-hashgraph' },
    { symbol: 'FLOW-USDT', name: 'flow' },
    { symbol: 'NEAR-USDT', name: 'near' },
    { symbol: 'KAVA-USDT', name: 'kava' },
    { symbol: 'CHZ-USDT', name: 'chiliz' },
    { symbol: 'MINA-USDT', name: 'mina-protocol' },
    { symbol: 'EGLD-USDT', name: 'multiversx' },
    { symbol: 'THETA-USDT', name: 'theta-token' },
    { symbol: 'ZIL-USDT', name: 'zilliqa' },
    { symbol: 'QTUM-USDT', name: 'qtum' },
    { symbol: 'RVN-USDT', name: 'ravencoin' },
    { symbol: 'DGB-USDT', name: 'digibyte' },
    { symbol: 'SC-USDT', name: 'siacoin' },
    { symbol: 'ANKR-USDT', name: 'ankr' },
    { symbol: 'BTT-USDT', name: 'bittorrent' },
    { symbol: 'ROSE-USDT', name: 'oasis-network' },
    { symbol: 'IOTA-USDT', name: 'iota' },
    { symbol: 'XMR-USDT', name: 'monero' },
    { symbol: 'ZEC-USDT', name: 'zcash' },
    { symbol: 'DASH-USDT', name: 'dash' },
    { symbol: 'KSM-USDT', name: 'kusama' },
    { symbol: 'OSMO-USDT', name: 'osmosis' },
    { symbol: 'DYDX-USDT', name: 'dydx' },
    { symbol: 'BLUR-USDT', name: 'blur' },
    { symbol: 'ORDI-USDT', name: 'ordi' },
    { symbol: 'ARKM-USDT', name: 'arkham' },
    { symbol: 'NOT-USDT', name: 'notcoin' },
    { symbol: 'JASMY-USDT', name: 'jasmycoin' },
    { symbol: '1INCH-USDT', name: '1inch' },
    { symbol: 'MASK-USDT', name: 'mask-network' },
    { symbol: 'ENS-USDT', name: 'ethereum-name-service' },
    { symbol: 'APE-USDT', name: 'apecoin' },
    { symbol: 'LUNC-USDT', name: 'terra-luna-2' },
    { symbol: 'RUNE-USDT', name: 'thorchain' },
    { symbol: 'ATOM-USDT', name: 'cosmos' },
    { symbol: 'XTZ-USDT', name: 'tezos' },
    { symbol: 'BCH-USDT', name: 'bitcoin-cash' },
    { symbol: 'ETC-USDT', name: 'ethereum-classic' },
    { symbol: 'ZRX-USDT', name: '0x' },
    { symbol: 'BAT-USDT', name: 'basic-attention-token' }
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
const APP_PASSWORD = process.env.APP_PASSWORD || 'admin123';

// Список доменов API (основной и резервный)
const BINGX_API_DOMAINS = [
  process.env.BINGX_API_DOMAIN_1 || 'https://open-api.bingx.io', // Альтернативный, с лимитом 60/мин
  process.env.BINGX_API_DOMAIN_2 || 'https://open-api.bingx.com'  // Основной
];

let currentApiDomainIndex = 0; // Индекс текущего используемого домена

// Функция для получения текущего домена
function getCurrentApiDomain() {
  return BINGX_API_DOMAINS[currentApiDomainIndex];
}

// Функция для переключения на следующий домен
function switchToNextApiDomain() {
  currentApiDomainIndex = (currentApiDomainIndex + 1) % BINGX_API_DOMAINS.length;
  console.log(`🔄 Переключение на домен API: ${getCurrentApiDomain()}`);
}

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
  for (const key in cleanParams) {
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
    const response = await axios.get(`${getCurrentApiDomain()}/openApi/swap/v2/server/time`, {
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
// ФУНКЦИЯ: Получение реального баланса (v3)
// ==========================
async function getBingXRealBalance() {
  try {
    console.log('🔍 [БАЛАНС] Запрос реального баланса...');
    const timestamp = Date.now();
    const params = { timestamp, recvWindow: 5000 };
    const signature = signBingXRequest(params);
    const url = `${getCurrentApiDomain()}/openApi/swap/v3/user/balance?timestamp=${timestamp}&recvWindow=5000&signature=${signature}`;
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
      if (error.response.status === 403 || error.response.status === 429) {
        switchToNextApiDomain();
      }
    }
    return null;
  }
}

// ==========================
// ФУНКЦИЯ: Получение исторических свечей (v2)
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
    const url = `${getCurrentApiDomain()}/openApi/swap/v2/quote/klines?symbol=${params.symbol}&interval=${params.interval}&limit=${params.limit}&timestamp=${params.timestamp}&recvWindow=5000&signature=${signature}`;
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
      if (error.response.status === 403 || error.response.status === 429) {
        switchToNextApiDomain();
      }
    }
    return [];
  }
}

// ==========================
// ФУНКЦИЯ: Получение текущих цен (v2)
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
      const url = `${getCurrentApiDomain()}/openApi/swap/v2/quote/price?symbol=${params.symbol}&timestamp=${params.timestamp}&recvWindow=5000&signature=${signature}`;
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
          if (error.response.status === 403 || error.response.status === 429) {
            switchToNextApiDomain();
          }
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
// ФУНКЦИЯ: Размещение ордера (v2)
// ==========================
async function placeBingXFuturesOrder(symbol, side, type, quantity, price = null, leverage, positionSide) {
  try {
    const serverTime = await getBingXServerTime();
    const timestamp = serverTime;
    const params = {
      symbol: symbol,
      side,
      type,
      quantity: quantity.toFixed(6),
      timestamp,
      positionSide,
      recvWindow: 5000
    };
    if (price && (type === 'LIMIT' || type === 'TAKE_PROFIT' || type === 'STOP')) {
      params.price = price.toFixed(8);
    }
    const signature = signBingXRequest(params);
    let url = `${getCurrentApiDomain()}/openApi/swap/v2/trade/order?symbol=${params.symbol}&side=${params.side}&type=${params.type}&quantity=${params.quantity}&timestamp=${params.timestamp}&positionSide=${params.positionSide}&recvWindow=5000&signature=${signature}`;
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
      if (error.response.status === 403 || error.response.status === 429) {
        switchToNextApiDomain();
      }
    }
    return null;
  }
}

// ==========================
// ФУНКЦИЯ: Открытие позиции
// ==========================
async function openFuturesTrade(coin, direction, leverage, size, price, stopLoss, takeProfit) {
  const symbol = coin.symbol;
  const positionSide = direction === 'LONG' ? 'LONG' : 'SHORT';
  const side = direction === 'LONG' ? 'BUY' : 'SELL';
  console.log(`🌐 Отправка ${direction} ордера на BingX: ${size} ${symbol} с плечом ${leverage}x`);
  console.log(`🔄 Текущий режим: ${globalState.isRealMode ? 'РЕАЛЬНЫЙ' : 'ДЕМО'}`);

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
  const cacheDuration = 3600000;
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
    await new Promise(r => setTimeout(r, 2000));
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
    if (profitPercent > 0.02 || profitPercent < -0.01) {
      console.log(`✅ ЗАКРЫТИЕ: ${position.type} ${coin.name} — прибыль ${profitPercent > 0 ? '+' : ''}${(profitPercent * 100).toFixed(2)}%`);
      position.status = 'CLOSED';
      position.exitPrice = currentPrice;
      position.profitPercent = profitPercent;
      if (profitPercent > 0) globalState.stats.profitableTrades++;
      else globalState.stats.losingTrades++;
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
      const url = `${getCurrentApiDomain()}/openApi/swap/v2/quote/price?symbol=${params.symbol}&timestamp=${params.timestamp}&recvWindow=5000&signature=${signature}`;
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
        if (error.response.status === 403 || error.response.status === 429) {
          switchToNextApiDomain();
        }
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

      if (Date.now() % 300000 < 10000 && globalState.isRealMode) {
        await forceUpdateRealBalance();
      }

      const currentPrices = await getCurrentPrices();
      globalState.currentPrices = currentPrices;

      for (const coin of globalState.watchlist) {
        await getFundamentalData(coin);
      }

      await checkOpenPositions(currentPrices);

      let bestOpportunity = null;
      globalState.lastAnalysis = [];

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

      globalState.stats.winRate = globalState.stats.totalTrades > 0
        ? (globalState.stats.profitableTrades / globalState.stats.totalTrades) * 100
        : 0;

      if (Date.now() % 60000 < 10000) {
        console.log(`
💰 Баланс: $${(globalState.isRealMode ? globalState.realBalance : globalState.balance)?.toFixed(2) || '...'}`);
      }
    } catch (error) {
      console.error('💥 КРИТИЧЕСКАЯ ОШИБКА В ЦИКЛЕ:', error.message);
      if (error.response) {
        console.error('❌ Ответ от BingX:', JSON.stringify(error.response.data));
        if (error.response.status === 403 || error.response.status === 429) {
          switchToNextApiDomain();
        }
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
