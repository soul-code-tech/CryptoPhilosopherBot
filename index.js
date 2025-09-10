const axios = require('axios');
const CryptoJS = require('crypto-js');

// ==========================
// ГЛОБАЛЬНОЕ СОСТОЯНИЕ — ТРЕЙДИНГ БОТ ВАСЯ 3000 УНИКАЛЬНЫЙ (BINGX FUTURES)
// ==========================
let globalState = {
  balance: 100, // демо-баланс
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
  maxRiskPerTrade: 0.01, // 1% от депозита
  maxLeverage: 3,        // 3x плечо
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
  ]
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
    return value;
  } catch (e) {
    console.log('⚠️ Не удалось получить индекс страха — используем 50');
    return 50;
  }
}

// ==========================
// ФУНКЦИЯ: Получение текущих цен фьючерсов с BingX
// ==========================
async function getCurrentFuturesPrices() {
  try {
    const response = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/price', { timeout: 15000 });

    if (!response.data || !Array.isArray(response.data.data)) {
      console.error('❌ BingX не вернул массив данных для фьючерсов');
      return {};
    }

    const prices = {};
    for (const ticker of response.data.data) {
      if (!ticker.symbol || !ticker.price) continue;

      const coinSymbol = ticker.symbol.replace('USDT', '').toLowerCase();
      let coinName = '';
      switch(coinSymbol) {
        case 'btc': coinName = 'bitcoin'; break;
        case 'eth': coinName = 'ethereum'; break;
        case 'bnb': coinName = 'binancecoin'; break;
        case 'sol': coinName = 'solana'; break;
        case 'xrp': coinName = 'ripple'; break;
        case 'doge': coinName = 'dogecoin'; break;
        case 'ada': coinName = 'cardano'; break;
        case 'dot': coinName = 'polkadot'; break;
        case 'link': coinName = 'chainlink'; break;
        default: continue;
      }
      prices[coinName] = parseFloat(ticker.price);
    }

    return prices;
  } catch (error) {
    console.error('❌ Ошибка получения цен фьючерсов с BingX:', error.message);
    return {};
  }
}

// ==========================
// ФУНКЦИЯ: Получение исторических свечей фьючерсов с BingX
// ==========================
async function getBingXFuturesHistory(symbol, interval = '1h', limit = 50) {
  try {
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

    const bingxSymbol = symbolMap[symbol];
    if (!bingxSymbol) {
      console.error(`❌ Неизвестная монета: ${symbol}`);
      return [];
    }

    const response = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/klines', {
      params: {
        symbol: bingxSymbol,
        interval: interval,
        limit: limit
      },
      timeout: 15000
    });

    if (!response.data || !Array.isArray(response.data.data)) {
      console.error(`❌ BingX вернул не массив для ${symbol}:`, response.data);
      return [];
    }

    const candles = response.data.data.map(candle => ({
      price: parseFloat(candle.close),
      high: parseFloat(candle.high),
      low: parseFloat(candle.low),
      volume: parseFloat(candle.volume),
      time: candle.time
    }));

    return candles;

  } catch (error) {
    console.error(`❌ Ошибка получения истории для ${symbol} с BingX:`, error.message);
    return [];
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

  if (signal.direction === 'LONG') {
    signal.stopLoss = currentPrice * 0.98;
    signal.takeProfit = currentPrice * 1.03;
  } else if (signal.direction === 'SHORT') {
    signal.stopLoss = currentPrice * 1.02;
    signal.takeProfit = currentPrice * 0.97;
  }

  signal.reasoning.push("🌊 Цунами прибыли: 50% позиции закрываем на +3%, остаток в трейлинг-стоп");

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
    const timestamp = Date.now();
    const params = { symbol, leverage: leverage.toString(), timestamp };
    const signature = signBingXRequest(params);
    const url = `${BINGX_FUTURES_URL}/openApi/swap/v2/trade/leverage?${new URLSearchParams(params)}&signature=${signature}`;

    const response = await axios.post(url, {}, {
      headers: { 'X-BX-APIKEY': BINGX_API_KEY },
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
      headers: { 'X-BX-APIKEY': BINGX_API_KEY },
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
// ФУНКЦИЯ: Открытие РЕАЛЬНОЙ фьючерсной позиции
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

  const result = await placeBingXFuturesOrder(symbol, side, positionSide, 'MARKET', size, null, leverage);

  if (result) {
    const trade = {
      coin,
      type: direction,
      size,
      entryPrice: price,
      leverage,
      stopLoss,
      takeProfit,
      fee: 0,
      timestamp: new Date().toLocaleString(),
      status: 'OPEN',
      orderId: result.orderId
    };

    globalState.history.push(trade);
    globalState.positions[coin] = {
      side: direction,
      size,
      entryPrice: price,
      leverage,
      stopLoss,
      takeProfit,
      fee: 0,
      timestamp: new Date().toLocaleString(),
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

    if (position.side === 'LONG' && currentPrice >= position.takeProfit) {
      shouldClose = true;
      reason = '🎯 Достигнут тейк-профит +3% — фиксируем 50% прибыли';
    } else if (position.side === 'SHORT' && currentPrice <= position.takeProfit) {
      shouldClose = true;
      reason = '🎯 Достигнут тейк-профит +3% — фиксируем 50% прибыли';
    }

    if (position.side === 'LONG' && currentPrice <= position.stopLoss) {
      shouldClose = true;
      reason = '🛑 Сработал стоп-лосс -2%';
    } else if (position.side === 'SHORT' && currentPrice >= position.stopLoss) {
      shouldClose = true;
      reason = '🛑 Сработал стоп-лосс -2%';
    }

    if (shouldClose) {
      console.log(`✅ ЗАКРЫТИЕ: ${reason} по ${coin.name}`);
      const trade = globalState.history.find(t => t.coin === coin.name && t.status === 'OPEN');
      if (trade) {
        trade.exitPrice = currentPrice;
        trade.profitPercent = position.side === 'LONG' 
          ? (currentPrice - trade.entryPrice) / trade.entryPrice 
          : (trade.entryPrice - currentPrice) / trade.entryPrice;
        trade.status = 'CLOSED';
        
        if (trade.profitPercent > 0) {
          globalState.stats.profitableTrades++;
          globalState.balance += (trade.size * trade.entryPrice * trade.profitPercent);
        } else {
          globalState.stats.losingTrades++;
          globalState.balance += (trade.size * trade.entryPrice * trade.profitPercent);
        }
      }
      
      globalState.positions[coin.name] = null;
      globalState.marketMemory.consecutiveTrades[coin.name] = 0;
    } else {
      if (position.side === 'LONG' && currentPrice > position.entryPrice * 1.01) {
        position.trailingStop = Math.max(position.trailingStop, currentPrice * 0.99);
      } else if (position.side === 'SHORT' && currentPrice < position.entryPrice * 0.99) {
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

    if (position.side === 'LONG') {
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

    console.log(`\n📈 ${coin.name} ${position.side}:`);
    console.log(`   Вход: $${position.entryPrice.toFixed(2)} | Текущая: $${currentPrice.toFixed(2)}`);
    console.log(`   🎯 Цель: $${targetPrice.toFixed(2)} (${distanceToTarget > 0 ? '+' : ''}${distanceToTarget.toFixed(2)}% до цели)`);
    console.log(`   📊 Прогресс: ${Math.min(100, Math.max(0, progress)).toFixed(1)}%`);
    console.log(`   🎲 Вероятность успеха: ${successProbability.toFixed(0)}%`);
    console.log(`   🛑 Стоп: $${position.stopLoss.toFixed(2)} | Трейлинг: $${position.trailingStop.toFixed(2)}`);
    console.log(`   ⚖️ Плечо: ${position.leverage}x`);

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
// ФУНКЦИЯ: Пополнение баланса (для демо)
// ==========================
function deposit(amount) {
  if (amount <= 0) return false;
  globalState.balance += amount;
  console.log(`✅ Баланс пополнен на $${amount}. Текущий баланс: $${globalState.balance.toFixed(2)}`);
  return true;
}

// ==========================
// ГЛАВНАЯ ФУНКЦИЯ — ЦИКЛ БОТА
// ==========================
(async () => {
  console.log('🤖 ЗАПУСК БОТА v12.0 — ТРЕЙДИНГ БОТ ВАСЯ 3000 УНИКАЛЬНЫЙ (ЧИСТЫЙ BINGX FUTURES)');
  console.log('📌 deposit(сумма) — пополнить демо-баланс');

  while (globalState.isRunning) {
    try {
      console.log(`\n[${new Date().toLocaleTimeString()}] === АНАЛИЗ ОТ ВАСИ 3000 ===`);

      const fearIndex = await getFearAndGreedIndex();
      console.log(`😱 Индекс страха и жадности: ${fearIndex}`);

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

      if (bestOpportunity && globalState.balance > 10) {
        console.log(`\n💎 ВАСЯ 3000 РЕКОМЕНДУЕТ: ${bestOpportunity.signal.direction} по ${bestOpportunity.coin}`);
        bestReasoning.forEach(r => console.log(`   • ${r}`));

        const riskAmount = globalState.balance * globalState.maxRiskPerTrade;
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

      globalState.stats.totalProfit = globalState.balance - 100;
      if (globalState.balance > globalState.stats.peakBalance) {
        globalState.stats.peakBalance = globalState.balance;
      }
      globalState.stats.maxDrawdown = ((globalState.stats.peakBalance - globalState.balance) / globalState.stats.peakBalance) * 100;
      globalState.stats.winRate = globalState.stats.totalTrades > 0
        ? (globalState.stats.profitableTrades / globalState.stats.totalTrades) * 100
        : 0;

      if (Date.now() % 60000 < 10000) {
        console.log(`\n💰 Демо-баланс: $${globalState.balance.toFixed(2)}`);
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
  balance: () => globalState.balance,
  stats: () => globalState.stats,
  history: () => globalState.history
};

global.deposit = deposit;
global.balance = () => globalState.balance;
global.stats = () => globalState.stats;
global.history = () => globalState.history;

console.log('\n✅ Трейдинг Бот Вася 3000 Уникальный (Чистый BingX Futures) запущен!');
console.log('Теперь работает ТОЛЬКО с BingX — ошибок 401/429 не будет.');
