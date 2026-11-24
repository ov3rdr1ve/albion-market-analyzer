/**
 * Gold Price chart — TradingView-style, powered by Lightweight Charts + our
 * own indicator math (js/indicators.js).
 *
 * Data source is AODP /stats/gold, which serves at most 720 HOURLY points
 * (~30 days), server-wide. So:
 *   - The finest candle interval possible is 1h (no 5m/15m — that data does
 *     not exist). Coarser intervals (4h/12h/1D) are rolled up client-side.
 *   - We fetch the full 720-point window ONCE; interval, look-back, style and
 *     indicator edits are pure client-side redraws (no refetch). Only a manual
 *     Reload or region change hits the network.
 *
 * Indicators are fully configurable (multiple SMAs/EMAs with per-line period &
 * colour, editable MACD/RSI/Bollinger parameters) and the whole config is
 * persisted to localStorage, TradingView-style.
 *
 * Panes: 0 = price (candles/line + MA overlays + Bollinger), 1 = MACD,
 * 2 = RSI. No build step — LightweightCharts + INDICATORS are plain globals.
 */
(function () {
  "use strict";

  const C = {
    up: "#26a69a", down: "#ef5350", line: "#4d9fff",
    boll: "#7c8cff", macd: "#4d9fff", signal: "#f4a340",
    histUp: "#26a69a", histDown: "#ef5350", rsi: "#c07cff",
    grid: "#2a2c31", text: "#b0b3b8",
  };
  const MAX_COUNT = 720; // AODP hard cap for gold history
  const CONFIG_KEY = "gold-chart-config";

  // Default, fully-editable indicator configuration.
  function defaultConfig() {
    return {
      interval: 14400, // 4h default
      lookback: 720,
      style: "candles",
      mas: [
        { type: "SMA", period: 20, color: "#f4a340" },
        { type: "EMA", period: 50, color: "#4d9fff" },
      ],
      macd: { on: true, fast: 12, slow: 26, signal: 9 },
      rsi: { on: true, period: 14 },
      boll: { on: false, period: 20, mult: 2 },
    };
  }

  let config = loadConfig();
  let chart = null;
  let cache = null; // full { time, price }[] (up to 720), region-specific
  let resizeObs = null;

  function $(id) { return document.getElementById(id); }

  function loadConfig() {
    const def = defaultConfig();
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || "null");
      if (saved && typeof saved === "object") {
        return {
          ...def, ...saved,
          mas: Array.isArray(saved.mas) ? saved.mas : def.mas,
          macd: { ...def.macd, ...(saved.macd || {}) },
          rsi: { ...def.rsi, ...(saved.rsi || {}) },
          boll: { ...def.boll, ...(saved.boll || {}) },
        };
      }
    } catch (e) { /* fall through to default */ }
    return def;
  }
  function saveConfig() {
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); } catch (e) { /* storage unavailable */ }
  }

  function setStatus(msg, color) {
    const s = $("gold-status");
    if (s) { s.textContent = msg; s.style.color = color || "#9ca3af"; }
  }

  // Aligned (null-padded) indicator array → { time, value }[] for the chart.
  function lineData(times, arr) {
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] !== null && arr[i] !== undefined) out.push({ time: times[i], value: arr[i] });
    }
    return out;
  }

  function destroyChart() {
    if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
    if (chart) { chart.remove(); chart = null; }
  }

  // ── Indicator settings panel ────────────────────────────────────────────────
  function buildIndicatorPanel() {
    const panel = $("gold-ind-panel");
    if (!panel) return;
    panel.innerHTML = "";

    // Moving averages (dynamic list).
    const maBlock = document.createElement("div");
    maBlock.className = "gold-ind-block";
    maBlock.innerHTML = `<h4>${tx("Moving Averages", "r_moving_averages")}</h4>`;
    const maList = document.createElement("div");
    maBlock.appendChild(maList);

    const renderMaRows = () => {
      maList.innerHTML = "";
      config.mas.forEach((ma, idx) => {
        const row = document.createElement("div");
        row.className = "gold-ma-row";

        const typeSel = document.createElement("select");
        ["SMA", "EMA"].forEach((t) => {
          const o = document.createElement("option");
          o.value = t; o.textContent = t; if (t === ma.type) o.selected = true;
          typeSel.appendChild(o);
        });
        typeSel.addEventListener("change", () => { ma.type = typeSel.value; commit(); });

        const periodLbl = document.createElement("span");
        periodLbl.className = "gold-param-label"; periodLbl.textContent = "period";
        const periodInp = document.createElement("input");
        periodInp.type = "number"; periodInp.min = "1"; periodInp.max = "500"; periodInp.value = ma.period;
        periodInp.addEventListener("change", () => {
          const v = parseInt(periodInp.value, 10);
          ma.period = Number.isFinite(v) && v > 0 ? v : ma.period;
          periodInp.value = ma.period; commit();
        });

        const colorInp = document.createElement("input");
        colorInp.type = "color"; colorInp.value = ma.color;
        colorInp.addEventListener("change", () => { ma.color = colorInp.value; commit(); });

        const rm = document.createElement("button");
        rm.className = "gold-mini-btn gold-ma-remove"; rm.textContent = "×"; rm.title = "Remove";
        rm.addEventListener("click", () => { config.mas.splice(idx, 1); renderMaRows(); commit(); });

        row.append(typeSel, periodLbl, periodInp, colorInp, rm);
        maList.appendChild(row);
      });
    };
    renderMaRows();

    const addBtn = document.createElement("button");
    addBtn.className = "gold-mini-btn"; addBtn.textContent = tx("+ Add MA", "r_add_ma");
    addBtn.style.marginTop = "2px";
    const palette = ["#f4a340", "#4d9fff", "#e0c341", "#26a69a", "#c07cff", "#ef5350"];
    addBtn.addEventListener("click", () => {
      config.mas.push({ type: "SMA", period: 100, color: palette[config.mas.length % palette.length] });
      renderMaRows(); commit();
    });
    maBlock.appendChild(addBtn);
    panel.appendChild(maBlock);

    // Numeric-parameter oscillator block builder.
    const paramBlock = (title, cfg, fields) => {
      const block = document.createElement("div");
      block.className = "gold-ind-block";
      const row = document.createElement("div");
      row.className = "gold-param-row";

      const on = document.createElement("input");
      on.type = "checkbox"; on.checked = !!cfg.on;
      on.addEventListener("change", () => { cfg.on = on.checked; commit(); });
      const onLbl = document.createElement("label");
      onLbl.style.cssText = "display:inline-flex;align-items:center;gap:5px;font-weight:600;min-width:96px;cursor:pointer";
      onLbl.append(on, document.createTextNode(title));
      row.appendChild(onLbl);

      fields.forEach((f) => {
        const lbl = document.createElement("span");
        lbl.className = "gold-param-label"; lbl.textContent = f.label;
        const inp = document.createElement("input");
        inp.type = "number"; inp.min = String(f.min ?? 1); inp.step = f.step || "1";
        inp.value = cfg[f.key];
        inp.addEventListener("change", () => {
          const v = f.float ? parseFloat(inp.value) : parseInt(inp.value, 10);
          cfg[f.key] = Number.isFinite(v) && v > 0 ? v : cfg[f.key];
          inp.value = cfg[f.key]; commit();
        });
        row.append(lbl, inp);
      });
      block.appendChild(row);
      panel.appendChild(block);
    };

    paramBlock("MACD", config.macd, [
      { key: "fast", label: "fast" }, { key: "slow", label: "slow" }, { key: "signal", label: "signal" },
    ]);
    paramBlock("RSI", config.rsi, [{ key: "period", label: "length" }]);
    paramBlock("Bollinger", config.boll, [
      { key: "period", label: "length" }, { key: "mult", label: "stdDev", step: "0.1", float: true },
    ]);
  }

  // Save config + redraw (settings changed).
  function commit() { saveConfig(); draw(); }

  // ── Draw ─────────────────────────────────────────────────────────────────────
  function draw() {
    const container = $("gold-chart");
    if (!container) return;
    if (typeof LightweightCharts === "undefined") {
      setStatus(tx("Chart library failed to load", "r_chart_lib_failed"), "#ef5350"); return;
    }
    if (!cache || cache.length === 0) {
      setStatus(tx("No gold data — click Reload", "r_no_gold_data"), "#e0a341"); return;
    }

    // Look-back window: keep only the last `lookback` hours of the fetched set.
    const lookbackHours = config.lookback;
    const cutoff = cache[cache.length - 1].time - lookbackHours * 3600;
    const points = cache.filter((p) => p.time >= cutoff);

    destroyChart();

    const bucket = config.interval;
    const candles = bucketToOHLC(points, bucket);

    let times, closes;
    if (config.style === "line") {
      times = points.map((p) => p.time);
      closes = points.map((p) => p.price);
    } else {
      times = candles.map((c) => c.time);
      closes = candles.map((c) => c.close);
    }

    chart = LightweightCharts.createChart(container, {
      layout: {
        background: { type: "solid", color: "#1b1c1f" }, textColor: C.text,
        panes: { separatorColor: "#2d2f34", separatorHoverColor: "#3a3d44" },
      },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      rightPriceScale: { borderColor: "#2d2f34" },
      timeScale: { borderColor: "#2d2f34", timeVisible: true, secondsVisible: false },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      autoSize: false, width: container.clientWidth, height: container.clientHeight,
    });

    // Pane 0: price.
    if (config.style === "line") {
      const s = chart.addSeries(LightweightCharts.LineSeries, { color: C.line, lineWidth: 2 }, 0);
      s.setData(points.map((p) => ({ time: p.time, value: p.price })));
    } else {
      const s = chart.addSeries(LightweightCharts.CandlestickSeries, {
        upColor: C.up, downColor: C.down, borderVisible: false,
        wickUpColor: C.up, wickDownColor: C.down,
      }, 0);
      s.setData(candles);
    }

    const legend = [{ color: config.style === "line" ? C.line : C.up, label: tx("Gold price", "r_gold_price") }];

    // Bollinger (price pane).
    if (config.boll.on) {
      const b = bollinger(closes, config.boll.period, config.boll.mult);
      const up = chart.addSeries(LightweightCharts.LineSeries, { color: C.boll, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false }, 0);
      const lo = chart.addSeries(LightweightCharts.LineSeries, { color: C.boll, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false }, 0);
      up.setData(lineData(times, b.upper));
      lo.setData(lineData(times, b.lower));
      legend.push({ color: C.boll, label: `BB ${config.boll.period}·${config.boll.mult}σ` });
    }

    // Moving averages (price pane) — each configured line.
    config.mas.forEach((ma) => {
      const vals = ma.type === "EMA" ? ema(closes, ma.period) : sma(closes, ma.period);
      const s = chart.addSeries(LightweightCharts.LineSeries, { color: ma.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false }, 0);
      s.setData(lineData(times, vals));
      legend.push({ color: ma.color, label: `${ma.type} ${ma.period}` });
    });

    let paneIdx = 1;

    // MACD pane.
    if (config.macd.on) {
      const m = macd(closes, config.macd.fast, config.macd.slow, config.macd.signal);
      const hist = chart.addSeries(LightweightCharts.HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, paneIdx);
      const histData = [];
      for (let i = 0; i < m.histogram.length; i++) {
        if (m.histogram[i] === null) continue;
        histData.push({ time: times[i], value: m.histogram[i], color: m.histogram[i] >= 0 ? C.histUp : C.histDown });
      }
      hist.setData(histData);
      chart.addSeries(LightweightCharts.LineSeries, { color: C.macd, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, paneIdx).setData(lineData(times, m.macd));
      chart.addSeries(LightweightCharts.LineSeries, { color: C.signal, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, paneIdx).setData(lineData(times, m.signal));
      legend.push({ color: C.macd, label: `MACD ${config.macd.fast}/${config.macd.slow}/${config.macd.signal}` });
      paneIdx++;
    }

    // RSI pane.
    if (config.rsi.on) {
      const r = chart.addSeries(LightweightCharts.LineSeries, { color: C.rsi, lineWidth: 2, priceLineVisible: false }, paneIdx);
      r.setData(lineData(times, rsi(closes, config.rsi.period)));
      r.createPriceLine({ price: 70, color: "#5a5c62", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "70" });
      r.createPriceLine({ price: 30, color: "#5a5c62", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "30" });
      legend.push({ color: C.rsi, label: `RSI ${config.rsi.period}` });
    }

    try {
      const panes = chart.panes();
      if (panes[0] && panes[0].setStretchFactor) {
        panes[0].setStretchFactor(3);
        for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(1);
      }
    } catch (e) { /* pane sizing is best-effort */ }

    chart.timeScale().fitContent();
    renderLegend(legend);

    resizeObs = new ResizeObserver(() => {
      if (chart) chart.resize(container.clientWidth, container.clientHeight);
    });
    resizeObs.observe(container);

    const first = new Date(points[0].time * 1000).toLocaleString();
    setStatus(tx("{n} candles · since {date} · {region}", "r_gold_candles_status").replace("{n}", candles.length).replace("{date}", first).replace("{region}", regionLabel()), "#7ab87a");
  }

  function renderLegend(items) {
    const el = $("gold-legend");
    if (!el) return;
    el.innerHTML = items.map((it) =>
      `<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:14px;height:3px;background:${it.color};border-radius:2px"></span>${it.label}</span>`
    ).join("");
  }

  function regionLabel() {
    try {
      const key = getApiServerKey();
      return (API_SERVERS[key] && API_SERVERS[key].label) || key;
    } catch (e) { return ""; }
  }

  // ── Fetch ────────────────────────────────────────────────────────────────────
  async function load() {
    const btn = $("gold-load-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Loading…"; }
    setStatus(tx("Fetching gold prices…", "r_fetching_gold"));
    try {
      cache = await fetchGoldHistory(MAX_COUNT);
      if (!cache || cache.length === 0) {
        setStatus(tx("No gold data returned for this region", "r_no_gold_for_region"), "#e0a341");
        destroyChart(); return;
      }
      draw();
    } catch (e) {
      console.error("gold chart load:", e);
      setStatus(tx("Failed to load gold data", "r_gold_load_failed"), "#ef5350");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "↻ Reload"; }
    }
  }

  // ── Collapse (self-contained, mirrors the table collapse) ────────────────────
  const COLLAPSE_KEY = "table-collapsed-gold-chart";
  function isCollapsed() {
    try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch (e) { return false; }
  }
  function setCollapsed(collapsed) {
    const body = $("gold-chart-body");
    const ind = $("gold-collapse-indicator");
    if (body) body.style.display = collapsed ? "none" : "";
    if (ind) ind.textContent = collapsed ? " ▶" : " ▼";
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0"); } catch (e) { /* storage unavailable */ }
    if (collapsed) destroyChart();
    else cache ? draw() : load();
  }

  // ── Control wiring ───────────────────────────────────────────────────────────
  function syncIntervalButtons() {
    document.querySelectorAll(".gold-tf-btn").forEach((b) => {
      b.classList.toggle("active", parseInt(b.dataset.interval, 10) === config.interval);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!$("gold-chart-section")) return;

    // Interval buttons.
    document.querySelectorAll(".gold-tf-btn").forEach((b) => {
      b.addEventListener("click", () => {
        config.interval = parseInt(b.dataset.interval, 10);
        syncIntervalButtons(); saveConfig(); draw();
      });
    });
    syncIntervalButtons();

    // Range + style selects — restore saved value.
    const rangeSel = $("gold-range");
    if (rangeSel) {
      rangeSel.value = String(config.lookback);
      rangeSel.addEventListener("change", () => {
        config.lookback = parseInt(rangeSel.value, 10); saveConfig(); draw();
      });
    }
    const styleSel = $("gold-style");
    if (styleSel) {
      styleSel.value = config.style;
      styleSel.addEventListener("change", () => {
        config.style = styleSel.value; saveConfig(); draw();
      });
    }

    // Indicator panel toggle.
    const indToggle = $("gold-ind-toggle");
    if (indToggle) {
      indToggle.addEventListener("click", () => {
        const p = $("gold-ind-panel");
        p.style.display = p.style.display === "none" ? "block" : "none";
      });
    }
    buildIndicatorPanel();

    $("gold-load-btn").addEventListener("click", load);

    // Section collapse.
    const toggle = $("gold-collapse-toggle");
    if (toggle) {
      toggle.addEventListener("click", (e) => {
        if (e.target.closest("button, input, select, textarea, label")) return;
        setCollapsed($("gold-chart-body").style.display !== "none");
      });
    }
    try {
      if (typeof tableCollapsers !== "undefined") tableCollapsers.push(setCollapsed);
    } catch (e) { /* app.js not ready — individual toggle still works */ }

    setCollapsed(isCollapsed()); // expanded branch triggers the initial load
  });

  window.loadGoldChart = load;
})();
