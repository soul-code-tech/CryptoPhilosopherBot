const express = require('express');
const cors = require('cors');
const path = require('path');
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
  watchlist: [
    { symbol: 'BTCUSD', name: 'bitcoin' },
    { symbol: 'ETHUSD', name: 'ethereum' },
    { symbol: 'SOLUSD', name: 'solana' },
    { symbol: 'XRPUSD', name: 'ripple' },
    { symbol: 'ADAUSD', name: 'cardano' },
    { symbol: 'DOTUSD', name: 'polkadot' },
    { symbol: 'DOGEUSD', name: 'dogecoin' },
    { symbol: 'MATICUSD', name: 'polygon' },
    { symbol: 'LTCUSD', name: 'litecoin' },
    { symbol: 'BCHUSD', name: 'bitcoin-cash' },
    { symbol: 'UNIUSD', name: 'uniswap' },
    { symbol: 'LINKUSD', name: 'chainlink' },
    { symbol: 'AAVEUSD', name: 'aave' },
    { symbol: 'AVAXUSD', name: 'avalanche' },
    { symbol: 'ATOMUSD', name: 'cosmos' },
    { symbol: 'FILUSD', name: 'filecoin' },
    { symbol: 'ALGOUSD', name: 'algorand' },
    { symbol: 'NEARUSD', name: 'near' },
    { symbol: 'SUSHIUSD', name: 'sushi' },
    { symbol: 'MKRUSD', name: 'maker' }
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
const APP_PASSWORD = process.env.APP_PASSWORD || 'admin123'; // ✅ ЗАДАЁТЕ В RENDER

// ==========================
// ФУНКЦИЯ: Подпись запроса для BingX
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
    const params = { timestamp, recvWindow: 5000 };
    const signature = signBingXRequest(params);
    const url = `${BINGX_FUTURES_URL}/openApi/cswap/v1/user/balance?timestamp=${timestamp}&recvWindow=5000&signature=${signature}`;

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
    console.error('❌ Не найден баланс USDT');
    return null;
  } catch (error) {
    console.error('❌ Ошибка получения баланса:', error.message);
    return null;
  }
}

// ==========================
// ФУНКЦИЯ: Получение исторических свечей
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
// ФУНКЦИЯ: Получение текущих цен
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
        const response = await axios.get(url, {
          headers: { 'X-BX-APIKEY': BINGX_API_KEY },
          timeout: 10000
        });

        if (response.data.code === 0 && response.data.data && response.data.data.price) {
          const price = parseFloat(response.data.data.price);
          const cleanSymbol = coin.name; // Используем имя монеты как ключ (bitcoin, ethereum)
          prices[cleanSymbol] = price;
          console.log(`✅ Цена для ${coin.symbol}: $${price}`);
        } else {
          console.error(`❌ Ошибка для ${coin.symbol}:`, response.data.msg || 'Нет данных о цене');
        }
      } catch (error) {
        console.error(`❌ Не удалось получить цену для ${coin.symbol}:`, error.message);
      }

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
// ФУНКЦИЯ: Установка плеча
// ==========================
async function setBingXLeverage(symbol, leverage) {
  try {
    if (!BINGX_API_KEY || !BINGX_SECRET_KEY) {
      console.log(`ℹ️ API-ключи не заданы. Плечо ${leverage}x для ${symbol} установлено виртуально.`);
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
// ФУНКЦИЯ: Размещение ордера
// ==========================
async function placeBingXFuturesOrder(symbol, side, type, quantity, price = null, leverage, positionSide) {
  try {
    if (!BINGX_API_KEY || !BINGX_SECRET_KEY) {
      console.log(`ℹ️ API-ключи не заданы. Ордер симулирован.`);
      return { orderId: `fake_${Date.now()}` };
    }

    const leverageSet = await setBingXLeverage(symbol, leverage);
    if (!leverageSet) return null;

    const timestamp = Date.now();
    const params = {
      symbol: symbol,
      side,
      type,
      quantity: quantity.toFixed(6),
      timestamp,
      positionSide,
      recvWindow: 5000
    };

    if (price && type === 'LIMIT') {
      params.price = price.toFixed(8);
    }

    const signature = signBingXRequest(params);
    let url = `${BINGX_FUTURES_URL}/openApi/cswap/v1/trade/order?symbol=${params.symbol}&side=${params.side}&type=${params.type}&quantity=${params.quantity}&timestamp=${params.timestamp}&positionSide=${params.positionSide}&recvWindow=5000&signature=${signature}`;

    if (price && type === 'LIMIT') {
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
      return null;
    }
  } catch (error) {
    console.error(`💥 Ошибка при размещении ордера:`, error.message);
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
  if (fundamentalData && fundamentalData.developerActivity) {
    if (fundamentalData.developerActivity > 100) riskScore -= 15;
    else if (fundamentalData.developerActivity < 20) riskScore += 25;
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

    await new Promise(r => setTimeout(r, 10000)); // ❗ 10 сек — чтобы избежать 429
    return fundamentalData;
  } catch (error) {
    console.error(`❌ Ошибка для ${coin.name}:`, error.message);
    if (globalState.fundamentalCache[cacheKey]) {
      return globalState.fundamentalCache[cacheKey].data;
    }
    return null;
  }
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
// ФУНКЦИЯ: Анализ рынка (упрощённая версия)
// ==========================
function analyzeMarketWithAdaptiveStrategy(candles, coinName) {
  if (candles.length < 50) return null;
  const close = candles[candles.length - 1].close;
  const prevClose = candles[candles.length - 2].close;
  const direction = close > prevClose ? 'LONG' : 'SHORT';
  return {
    coin: coinName,
    currentPrice: close,
    signal: {
      direction,
      confidence: 0.6,
      leverage: globalState.maxLeverage,
      reasoning: [`📈 Цена ${direction === 'LONG' ? 'выше' : 'ниже'} предыдущей`]
    }
  };
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
// HTTP-сервер
// ==========================
const app = express();
const PORT = process.env.PORT || 10000;

// Middleware для аутентификации
function authenticate(req, res, next) {
  if (req.path === '/login' || req.path === '/favicon.ico' || req.path === '/login.css') {
    return next();
  }
  if (req.cookies.authToken) return next();
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
        body { font-family: sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
        .login-form { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; width: 100%; max-width: 400px; }
        input { width: 100%; padding: 12px; margin: 10px 0; border: 1px solid #ddd; border-radius: 5px; }
        button { width: 100%; padding: 12px; background: #3498db; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 16px; }
        button:hover { background: #2980b9; }
        h2 { color: #3498db; margin-bottom: 20px; }
      </style>
    </head>
    <body>
      <div class="login-form">
        <h2>Торговый Бот</h2>
        <form id="loginForm">
          <input type="password" name="password" placeholder="Введите пароль" required>
          <button type="submit">Войти</button>
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
            document.cookie = "authToken=true; path=/; max-age=3600";
            window.location.href = '/';
          } else {
            alert('Неверный пароль');
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
    res.cookie('authToken', 'true', { path: '/', maxAge: 3600000 });
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false });
  }
});

app.get('/logout', (req, res) => {
  res.clearCookie('authToken');
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
        body { font-family: sans-serif; margin: 0; padding: 15px; background: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; }
        .stat-card { background: white; padding: 15px; border-radius: 8px; margin: 10px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .stat-value { font-size: 2rem; font-weight: bold; color: #2c3e50; }
        .stat-label { color: #7f8c8d; font-size: 0.9rem; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #f2f2f2; }
        .btn { padding: 8px 16px; margin: 5px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer; }
        .btn-danger { background: #e74c3c; }
        .settings { margin-top: 30px; }
        @media (max-width: 600px) {
          .stat-value { font-size: 1.5rem; }
          .container { padding: 10px; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Торговый Бот</h1>
        
        <div class="stat-card">
          <div class="stat-value">$${globalState.balance.toFixed(2)}</div>
          <div class="stat-label">Демо-баланс</div>
        </div>
        
        <div class="stat-card">
          <div class="stat-value">${globalState.isRealMode ? 'РЕАЛЬНЫЙ' : 'ДЕМО'}</div>
          <div class="stat-label">Режим</div>
        </div>
        
        <div class="stat-card">
          <div class="stat-value">${globalState.stats.totalTrades}</div>
          <div class="stat-label">Сделок всего</div>
        </div>

        <h2>Настройки</h2>
        <div class="settings">
          <button class="btn" onclick="toggleMode()">Переключить режим</button>
          <button class="btn" onclick="toggleTradeMode()">Сменить режим торговли</button>
          <button class="btn btn-danger" onclick="location.href='/logout'">Выйти</button>
        </div>

        <h2>Последние сделки</h2>
        <table>
          <thead><tr><th>Время</th><th>Монета</th><th>Тип</th><th>Прибыль</th></tr></thead>
          <tbody>
            ${globalState.history.slice(-5).map(h => `
              <tr>
                <td>${h.timestamp}</td>
                <td>${h.coin}</td>
                <td>${h.type}</td>
                <td style="color: ${h.profitPercent > 0 ? 'green' : 'red'}">${h.profitPercent > 0 ? '+' : ''}${(h.profitPercent * 100).toFixed(2)}%</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <script>
          function toggleMode() {
            fetch('/toggle-mode', { method: 'POST' }).then(() => location.reload());
          }
          function toggleTradeMode() {
            fetch('/toggle-trade-mode', { method: 'POST' }).then(() => location.reload());
          }
        </script>
      </div>
    </body>
    </html>
  `);
});

app.post('/toggle-mode', (req, res) => {
  toggleMode();
  res.json({ success: true });
});

app.post('/toggle-trade-mode', (req, res) => {
  toggleTradeMode();
  res.json({ success: true });
});

// ==========================
// ГЛАВНАЯ ФУНКЦИЯ — ЦИКЛ БОТА
// ==========================
(async () => {
  console.log('🤖 ЗАПУСК ТОРГОВОГО БОТА (BingX API v3)');
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

      // Получаем фундаментальные данные
      for (const coin of globalState.watchlist) {
        await getFundamentalData(coin);
      }

      await checkOpenPositions(currentPrices);

      let bestOpportunity = null;

      for (const coin of globalState.watchlist) {
        console.log(`\n🔍 Анализирую ${coin.name}...`);
        const candles = await getBingXFuturesHistory(coin.symbol, '1h', 100);

        if (candles.length < 50) {
          console.log(`   ⚠️ Пропускаем ${coin.name} — недостаточно данных`);
          continue;
        }

        const analysis = analyzeMarketWithAdaptiveStrategy(candles, coin.name);
        if (!analysis || !analysis.signal.direction) continue;

        if (!bestOpportunity || analysis.signal.confidence > (bestOpportunity?.signal?.confidence || 0)) {
          bestOpportunity = analysis;
        }
      }

      if (bestOpportunity && (globalState.isRealMode || globalState.balance > 10)) {
        console.log(`\n💎 РЕКОМЕНДУЕТСЯ: ${bestOpportunity.signal.direction} по ${bestOpportunity.coin}`);
        const price = bestOpportunity.currentPrice;
        const size = (globalState.isRealMode ? (globalState.realBalance || 100) : globalState.balance) * globalState.maxRiskPerTrade / (price * 0.01);
        const finalSize = Math.max(0.001, size);
        const stopLoss = price * (1 - 0.01);
        const takeProfit = price * (1 + 0.02);

        console.log(`\n🟢 ВХОД: ${bestOpportunity.signal.direction} ${finalSize.toFixed(6)} ${bestOpportunity.coin} с плечом ${bestOpportunity.signal.leverage}x`);
        await openFuturesTrade(
          bestOpportunity.coin,
          bestOpportunity.signal.direction,
          bestOpportunity.signal.leverage,
          finalSize,
          price,
          stopLoss,
          takeProfit
        );
      } else {
        console.log(`\n⚪ Нет подходящих возможностей — ожидаем...`);
      }

      globalState.stats.winRate = globalState.stats.totalTrades > 0
        ? (globalState.stats.profitableTrades / globalState.stats.totalTrades) * 100
        : 0;

      if (Date.now() % 60000 < 10000) {
        console.log(`\n💰 Баланс: $${(globalState.isRealMode ? globalState.realBalance : globalState.balance)?.toFixed(2) || '...'}`);
      }

    } catch (error) {
      console.error('💥 КРИТИЧЕСКАЯ ОШИБКА В ЦИКЛЕ:', error.message);
    }

    console.log(`\n💤 Ждём 60 секунд...`);
    await new Promise(r => setTimeout(r, 60000));
  }
})();

// ==========================
// ЗАПУСК СЕРВЕРА
// ==========================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`🌐 Доступ к интерфейсу: https://cryptophilosopherbot-0o69.onrender.com`);
  console.log(`🔐 Пароль для входа: ${APP_PASSWORD}`);
});
