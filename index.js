const axios = require('axios');

// ==========================
// ГЛОБАЛЬНОЕ СОСТОЯНИЕ — ФИЛОСОФ РЫНКА PRO (BINGX ВЕРСИЯ)
// ==========================
let globalState = {
  balance: 10,
  positions: {},
  history: [],
  stats: {
    totalTrades: 0,
    profitableTrades: 0,
    losingTrades: 0,
    winRate: 0,
    totalProfit: 0,
    maxDrawdown: 0,
    peakBalance: 10
  },
  marketMemory: {
    lastBuyPrices: {},
    consecutiveBuys: {},
    fearSentimentHistory: []
  },
  isRunning: true,
  makerFee: 0.001,
  takerFee: 0.001,
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
    { symbol: 'MATIC', name: 'matic-network' }
  ]
};

globalState.watchlist.forEach(coin => {
  globalState.positions[coin.name] = 0;
  globalState.marketMemory.lastBuyPrices[coin.name] = [];
  globalState.marketMemory.consecutiveBuys[coin.name] = 0;
});

// ==========================
// ФУНКЦИЯ: Пополнение баланса
// ==========================
function deposit(amount) {
  if (amount <= 0) return false;
  globalState.balance += amount;
  console.log(`✅ Баланс пополнен на $${amount}. Текущий баланс: $${globalState.balance.toFixed(2)}`);
  return true;
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
// ФУНКЦИЯ: Получение текущих цен с BingX — С ЗАЩИТОЙ
// ==========================
async function getCurrentPrices() {
  try {
    const response = await axios.get('https://open-api.bingx.com/openApi/spot/v1/ticker/price', { timeout: 10000 });

    // 🔒 ЗАЩИТА: проверяем структуру ответа
    if (!response.data || !response.data.data || !Array.isArray(response.data.data)) {
      console.error('⚠️ Некорректный ответ от BingX при получении цен:', response.data);
      return {};
    }

    const prices = {};
    for (const ticker of response.data.data) {
      if (!ticker.symbol || !ticker.price) continue; // защита от битых данных

      const coinSymbol = ticker.symbol.replace('-USDT', '').toLowerCase();
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
        case 'matic': coinName = 'matic-network'; break;
        default: continue;
      }
      prices[coinName] = parseFloat(ticker.price);
    }
    return prices;
  } catch (error) {
    console.error('❌ Ошибка получения цен с BingX:', error.message);
    return {};
  }
}

// ==========================
// ФУНКЦИЯ: Получение исторических свечей с BingX — С ЗАЩИТОЙ
// ==========================
async function getBingXHistory(symbol, interval = '1h', limit = 50) {
  try {
    // Маппинг названий монет → символы BingX
    const symbolMap = {
      'bitcoin': 'BTC',
      'ethereum': 'ETH',
      'binancecoin': 'BNB',
      'solana': 'SOL',
      'ripple': 'XRP',
      'dogecoin': 'DOGE',
      'cardano': 'ADA',
      'polkadot': 'DOT',
      'chainlink': 'LINK',
      'matic-network': 'MATIC'
    };

    const bingxSymbol = (symbolMap[symbol] || symbol.toUpperCase()) + '-USDT';

    const response = await axios.get('https://open-api.bingx.com/openApi/spot/v1/market/kline', {
      params: {
        symbol: bingxSymbol,
        interval: interval,
        limit: limit
      },
      timeout: 10000
    });

    // 🔒 ЗАЩИТА: проверяем структуру ответа
    if (!response.data || !response.data.data || !Array.isArray(response.data.data)) {
      console.error(`⚠️ Некорректный ответ от BingX для ${symbol}:`, response.data);
      return [];
    }

    return response.data.data.map(candle => ({
      price: parseFloat(candle.close),
      time: candle.time
    }));

  } catch (error) {
    console.error(`❌ Ошибка получения истории для ${symbol} с BingX:`, error.message);
    return [];
  }
}

// ==========================
// ФУНКЦИЯ: Расширенный анализ — с философией рынка
// ==========================
function analyzeCoinWithWisdom(candles, coinName, currentFearIndex) {
  if (candles.length < 10) return null;

  const prices = candles.map(c => c.price);
  const currentPrice = prices[prices.length - 1];
  const sma10 = prices.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const sma30 = prices.slice(-30).reduce((a, b) => a + b, 0) / 30;
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance = prices.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / prices.length;
  const stdDev = Math.sqrt(variance);

  const isExtremeFear = currentFearIndex < 25;
  const isExtremeGreed = currentFearIndex > 75;

  let upCount = 0;
  for (let i = prices.length - 6; i < prices.length - 1; i++) {
    if (prices[i + 1] > prices[i]) upCount++;
  }
  const trendProbability = upCount / 5;
  const expectedReturn = (currentPrice - sma30) / sma30;

  const buyZone = sma30 - stdDev * 0.5;
  const sellZone = sma30 + stdDev * 0.5;
  const isBuyZone = currentPrice <= buyZone;
  const isSellZone = currentPrice >= sellZone;

  let wisdom = {
    shouldBuy: false,
    shouldSell: false,
    positionSizeFactor: 1.0,
    reasoning: []
  };

  if (isExtremeFear && currentPrice > sma30) {
    wisdom.shouldBuy = true;
    wisdom.reasoning.push("☯️ Инь-Ян: страх на максимуме + цена выше средней → идеальная точка входа");
  }

  if (trendProbability > 0.7 && currentPrice > sma10) {
    wisdom.shouldBuy = true;
    wisdom.reasoning.push("🚀 Инерция: сильный импульс + цена выше SMA10 → тренд продолжится");
  }

  if (isExtremeGreed && currentPrice >= sellZone) {
    wisdom.shouldSell = true;
    wisdom.reasoning.push("🔥 Перегрев: жадность + цена в зоне продаж → фиксируем прибыль");
  }

  const consecutiveBuys = globalState.marketMemory.consecutiveBuys[coinName] || 0;
  if (consecutiveBuys >= 3) {
    wisdom.positionSizeFactor = 0.5;
    wisdom.reasoning.push("🦎 Адаптация: 3+ покупки подряд → снижаем риск");
  }

  if (stdDev / mean > 0.05) {
    wisdom.positionSizeFactor *= 0.7;
    wisdom.reasoning.push("🌀 Неопределённость: высокая волатильность → снижаем позицию");
  }

  return {
    coin: coinName,
    currentPrice,
    shouldBuy: wisdom.shouldBuy,
    shouldSell: wisdom.shouldSell,
    positionSizeFactor: wisdom.positionSizeFactor,
    reasoning: wisdom.reasoning,
    trendProbability,
    expectedReturn,
    isBuyZone,
    isSellZone,
    fearIndex: currentFearIndex
  };
}

// ==========================
// ФУНКЦИЯ: Открытие демо-позиции
// ==========================
function openDemoTrade(coin, action, size, price, fees, targetProfitPercent = 0.01) {
  if (action !== 'BUY' && action !== 'SELL') return false;

  const cost = size * price;
  const fee = cost * fees;

  if (action === 'BUY') {
    if (globalState.balance < cost + fee) {
      console.log(`❌ Недостаточно средств для покупки ${coin}: нужно $${(cost + fee).toFixed(2)}`);
      return false;
    }

    globalState.balance -= (cost + fee);
    globalState.positions[coin] += size;
    globalState.marketMemory.lastBuyPrices[coin].push(price);
    globalState.marketMemory.consecutiveBuys[coin] = (globalState.marketMemory.consecutiveBuys[coin] || 0) + 1;

    const trade = {
      coin,
      type: 'LONG',
      size,
      entryPrice: price,
      targetPrice: price * (1 + targetProfitPercent),
      stopLossPrice: price * 0.995,
      fee,
      timestamp: new Date().toLocaleString(),
      balanceBefore: globalState.balance + cost + fee,
      balanceAfter: globalState.balance,
      status: 'OPEN'
    };

    globalState.history.push(trade);
    globalState.stats.totalTrades++;

    console.log(`✅ ОТКРЫТ ЛОНГ: ${size.toFixed(6)} ${coin} по $${price.toFixed(2)}`);
    console.log(`   🎯 Цель: $${trade.targetPrice.toFixed(2)} (+${targetProfitPercent * 100}%)`);
    console.log(`   🛑 Стоп: $${trade.stopLossPrice.toFixed(2)} (-0.5%)`);
    console.log(`   💸 Комиссия: $${fee.toFixed(4)}`);
    return true;
  }

  if (action === 'SELL' && globalState.positions[coin] >= size) {
    const revenue = size * price;
    const fee = revenue * fees;

    globalState.balance += (revenue - fee);
    globalState.positions[coin] -= size;
    globalState.marketMemory.consecutiveBuys[coin] = 0;

    const openTrade = globalState.history.find(t => t.coin === coin && t.status === 'OPEN');
    if (openTrade) {
      openTrade.exitPrice = price;
      openTrade.profitPercent = (price - openTrade.entryPrice) / openTrade.entryPrice;
      openTrade.status = 'CLOSED';
    }

    const trade = {
      coin,
      type: 'SELL',
      size,
      price,
      fee,
      timestamp: new Date().toLocaleString(),
      balanceBefore: globalState.balance - revenue + fee,
      balanceAfter: globalState.balance
    };

    globalState.history.push(trade);
    globalState.stats.totalTrades++;

    if (trade.balanceAfter > trade.balanceBefore) {
      globalState.stats.profitableTrades++;
    } else {
      globalState.stats.losingTrades++;
    }

    globalState.stats.winRate = globalState.stats.totalTrades > 0
      ? (globalState.stats.profitableTrades / globalState.stats.totalTrades) * 100
      : 0;

    globalState.stats.totalProfit = globalState.balance - 10;
    if (globalState.balance > globalState.stats.peakBalance) {
      globalState.stats.peakBalance = globalState.balance;
    }
    globalState.stats.maxDrawdown = ((globalState.stats.peakBalance - globalState.balance) / globalState.stats.peakBalance) * 100;

    console.log(`✅ ЗАКРЫТ ЛОНГ: ${size.toFixed(6)} ${coin} по $${price.toFixed(2)}`);
    console.log(`   💰 Прибыль: ${(openTrade?.profitPercent * 100).toFixed(2)}%`);
    console.log(`   💸 Комиссия: $${fee.toFixed(4)}`);
    return true;
  }

  return false;
}

// ==========================
// ФУНКЦИЯ: Проверка открытых позиций
// ==========================
async function checkOpenPositions(currentPrices) {
  const fearIndex = await getFearAndGreedIndex();

  for (const coin of globalState.watchlist) {
    const openTrade = globalState.history.find(t => t.coin === coin.name && t.status === 'OPEN');
    if (!openTrade) continue;

    const currentPrice = currentPrices[coin.name];
    if (!currentPrice) continue;

    const profitPercent = (currentPrice - openTrade.entryPrice) / openTrade.entryPrice;

    if (currentPrice >= openTrade.targetPrice) {
      console.log(`🎯 ДОСТИГНУТА ЦЕЛЬ +1% по ${coin.name} — фиксируем прибыль!`);
      openDemoTrade(coin.name, 'SELL', globalState.positions[coin.name], currentPrice, globalState.takerFee);
    } else if (fearIndex < 20 && profitPercent > 0.005) {
      console.log(`😱 Страх <20 + прибыль → фиксируем по ${coin.name} (закон Инь-Ян)`);
      openDemoTrade(coin.name, 'SELL', globalState.positions[coin.name], currentPrice, globalState.takerFee);
    } else if (currentPrice <= openTrade.stopLossPrice) {
      console.log(`🛑 Сработал стоп-лосс -0.5% по ${coin.name}`);
      openDemoTrade(coin.name, 'SELL', globalState.positions[coin.name], currentPrice, globalState.takerFee);
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
    const openTrade = globalState.history.find(t => t.coin === coin.name && t.status === 'OPEN');
    if (!openTrade) continue;

    const currentPrice = currentPrices[coin.name];
    if (!currentPrice) continue;

    const progressToTarget = (currentPrice - openTrade.entryPrice) / (openTrade.targetPrice - openTrade.entryPrice) * 100;
    const distanceToTarget = ((openTrade.targetPrice - currentPrice) / currentPrice) * 100;

    console.log(`\n📈 ${coin.name}:`);
    console.log(`   Вход: $${openTrade.entryPrice.toFixed(2)} | Текущая: $${currentPrice.toFixed(2)}`);
    console.log(`   🎯 Цель: $${openTrade.targetPrice.toFixed(2)} (${distanceToTarget > 0 ? '+' : ''}${distanceToTarget.toFixed(2)}% до цели)`);
    console.log(`   📊 Прогресс: ${Math.min(100, Math.max(0, progressToTarget)).toFixed(1)}%`);
    console.log(`   🛑 Стоп: $${openTrade.stopLossPrice.toFixed(2)}`);

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
  console.log(`   Чистая прибыль: $${s.totalProfit.toFixed(2)} (${((s.totalProfit / 10) * 100).toFixed(1)}%)`);
  console.log(`   Макс. просадка: ${s.maxDrawdown.toFixed(1)}%`);
  console.log(`   Текущий баланс: $${globalState.balance.toFixed(2)}`);
}

// ==========================
// ГЛАВНАЯ ФУНКЦИЯ — ЦИКЛ БОТА
// ==========================
(async () => {
  console.log('🤖 ЗАПУСК БОТА v4.2 — ФИЛОСОФ РЫНКА PRO (BINGX ИСПРАВЛЕННАЯ ВЕРСИЯ)');
  console.log('📌 deposit(сумма) — пополнить баланс в REPL');
  console.log('📈 LONG с целями, стопами, прогрессом до выхода');

  while (globalState.isRunning) {
    try {
      console.log(`\n[${new Date().toLocaleTimeString()}] === ФИЛОСОФСКИЙ АНАЛИЗ ===`);

      const fearIndex = await getFearAndGreedIndex();
      console.log(`😱 Индекс страха и жадности: ${fearIndex}`);

      const currentPrices = await getCurrentPrices();
      await checkOpenPositions(currentPrices);

      showOpenPositionsProgress(currentPrices);

      let bestOpportunity = null;
      let bestReasoning = [];

      for (const coin of globalState.watchlist) {
        const candles = await getBingXHistory(coin.name, '1h', 50);
        if (candles.length < 10) continue;

        const analysis = analyzeCoinWithWisdom(candles, coin.name, fearIndex);
        if (!analysis) continue;

        console.log(`\n🔍 ${coin.name}:`);
        analysis.reasoning.forEach(r => console.log(`   • ${r}`));

        if (analysis.shouldBuy && !bestOpportunity) {
          bestOpportunity = analysis;
          bestReasoning = analysis.reasoning;
        }

        // ⏱️ УВЕЛИЧЕННАЯ ЗАДЕРЖКА — 800 мс, чтобы избежать 429
        await new Promise(r => setTimeout(r, 800));
      }

      if (bestOpportunity && globalState.balance > 1) {
        console.log(`\n💎 ФИЛОСОФСКИЙ ВЫВОД: ${bestOpportunity.coin}`);
        bestReasoning.forEach(r => console.log(`   • ${r}`));

        const baseSize = (globalState.balance * 0.2) / bestOpportunity.currentPrice;
        const finalSize = baseSize * bestOpportunity.positionSizeFactor;

        if (finalSize > 0) {
          console.log(`\n🟢 ВХОД: покупаем ${finalSize.toFixed(6)} ${bestOpportunity.coin}`);
          openDemoTrade(bestOpportunity.coin, 'BUY', finalSize, bestOpportunity.currentPrice, globalState.takerFee, 0.01);
        }
      } else {
        console.log(`\n⚪ Нет философски обоснованных возможностей — ждём...`);
      }

      if (Date.now() % 60000 < 10000) {
        console.log(`\n💰 ТЕКУЩИЙ БАЛАНС: $${globalState.balance.toFixed(2)}`);
        for (const coin of globalState.watchlist) {
          if (globalState.positions[coin.name] > 0) {
            const avgPrice = globalState.marketMemory.lastBuyPrices[coin.name].reduce((a, b) => a + b, 0) / globalState.marketMemory.lastBuyPrices[coin.name].length || 0;
            console.log(`   → ${coin.name}: ${globalState.positions[coin.name].toFixed(6)} @ $${avgPrice.toFixed(2)}`);
          }
        }
      }

      if (globalState.stats.totalTrades > 0 && globalState.history.length % 3 === 0) {
        printStats();
      }

    } catch (error) {
      console.error('💥 Ошибка в цикле:', error.message);
    }

    await new Promise(r => setTimeout(r, 60000));
  }
})();

module.exports = {
  globalState,
  deposit
};

global.deposit = deposit;
global.balance = () => globalState.balance;
global.stats = () => globalState.stats;
global.history = () => globalState.history;

console.log('\n✅ Бот v4.2 "Философ Рынка PRO" запущен!');
console.log('Он думает, а не следует. Он чувствует, а не считает.');
