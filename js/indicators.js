/**
 * Technical indicators for the Gold Price chart.
 *
 * Pure math — no DOM, no network. Each function takes a plain array of close
 * prices (numbers) and returns an array the SAME length as the input, with
 * `null` in the warm-up region where the value is undefined. Callers zip the
 * result against timestamps by index, which is exactly the shape TradingView
 * Lightweight Charts wants ({ time, value } / whitespace gaps for the nulls).
 *
 * Conventions chosen to match TradingView's built-ins:
 *   - EMA is seeded with the SMA of the first `period` values.
 *   - MACD = EMA(fast) − EMA(slow); signal = EMA(macd, signalPeriod).
 *   - RSI uses Wilder's smoothing; RSI=100 when average loss is 0.
 *   - Bollinger uses POPULATION standard deviation (÷N).
 *
 * Exported for tests (module.exports) and attached to globalThis for the
 * browser (no build step — plain <script> include).
 */

/** Simple moving average. Returns aligned array, null during warm-up. */
function sma(values, period) {
  const out = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average, SMA-seeded. Aligned array, null during warm-up. */
function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  // Seed with the SMA of the first `period` values.
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * MACD. Returns { macd, signal, histogram } — three aligned arrays.
 * macd = EMA(fast) − EMA(slow); signal = EMA(macd, signalPeriod);
 * histogram = macd − signal (null wherever either side is null).
 */
function macd(values, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = values.map((_, i) =>
    emaFast[i] === null || emaSlow[i] === null ? null : emaFast[i] - emaSlow[i]
  );

  // EMA of the macd line, but only over its non-null tail (the signal EMA must
  // start from the first defined macd value, not from index 0).
  const firstIdx = macdLine.findIndex((v) => v !== null);
  const signalLine = new Array(values.length).fill(null);
  if (firstIdx !== -1) {
    const tail = macdLine.slice(firstIdx);
    const sig = ema(tail, signal);
    for (let i = 0; i < sig.length; i++) signalLine[firstIdx + i] = sig[i];
  }

  const histogram = values.map((_, i) =>
    macdLine[i] === null || signalLine[i] === null ? null : macdLine[i] - signalLine[i]
  );
  return { macd: macdLine, signal: signalLine, histogram };
}

/**
 * Relative Strength Index (Wilder smoothing). Aligned array; the first
 * `period` entries are null (need `period` price changes to seed). RSI is 100
 * when the average loss is 0 (all-gains / flat), 0 when the average gain is 0.
 */
function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gainSum += change; else lossSum -= change;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = rsiFrom(avgGain, avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = rsiFrom(avgGain, avgLoss);
  }
  return out;
}

function rsiFrom(avgGain, avgLoss) {
  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Bollinger Bands. Returns { middle, upper, lower } aligned arrays.
 * middle = SMA(period); band = ±mult × population stdev over the window.
 */
function bollinger(values, period = 20, mult = 2) {
  const middle = sma(values, period);
  const upper = new Array(values.length).fill(null);
  const lower = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const mean = middle[i];
    if (mean === null) continue;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j] - mean;
      variance += d * d;
    }
    variance /= period; // population stdev (÷N), TradingView-style
    const sd = Math.sqrt(variance);
    upper[i] = mean + mult * sd;
    lower[i] = mean - mult * sd;
  }
  return { middle, upper, lower };
}

/**
 * Bucket a series of { time, price } points (time in UNIX seconds) into OHLC
 * candles of `bucketSeconds` width. The candle's `time` is the bucket's start
 * (floor(time/bucket)*bucket). open = first point in bucket, close = last,
 * high/low = extremes. Input need not be sorted; output is ordered by time.
 */
function bucketToOHLC(points, bucketSeconds) {
  const buckets = new Map();
  for (const p of points) {
    const start = Math.floor(p.time / bucketSeconds) * bucketSeconds;
    const b = buckets.get(start);
    if (!b) {
      buckets.set(start, { time: start, open: p.price, high: p.price, low: p.price, close: p.price, _lastTime: p.time, _firstTime: p.time });
    } else {
      if (p.price > b.high) b.high = p.price;
      if (p.price < b.low) b.low = p.price;
      if (p.time < b._firstTime) { b._firstTime = p.time; b.open = p.price; }
      if (p.time >= b._lastTime) { b._lastTime = p.time; b.close = p.price; }
    }
  }
  return Array.from(buckets.values())
    .sort((a, b) => a.time - b.time)
    .map(({ time, open, high, low, close }) => ({ time, open, high, low, close }));
}

const INDICATORS = { sma, ema, macd, rsi, bollinger, bucketToOHLC };

if (typeof module !== "undefined" && module.exports) {
  module.exports = INDICATORS;
}
if (typeof globalThis !== "undefined") {
  Object.assign(globalThis, INDICATORS);
  globalThis.INDICATORS = INDICATORS;
}
