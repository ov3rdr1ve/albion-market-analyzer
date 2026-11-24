/**
 * Boot step: the click-to-edit price override editor on every priced cell.
 *
 * Split out of js/app.js (800-line limit). Called from its DOMContentLoaded
 * handler.
 */
function setupPriceEditor() {
  // ─── Click-to-edit price override ──────────────────────────────────────────
  let activeEditor = null;
  document.addEventListener("click", (e) => {
    const el = e.target.closest(".price-editable");
    if (!el) return;

    // Promote inline <span> editors to parent <td> for stable layout
    const td = el.tagName === "SPAN" ? el.closest("td") : el;
    if (!td || td.querySelector("input")) return;

    // Close any existing editor — DOM scan as safety net
    document.querySelectorAll(".pe-editing").forEach((editingTd) => {
      if (editingTd._closeEditor) editingTd._closeEditor();
      editingTd.classList.remove("pe-editing");
      editingTd.querySelectorAll("input, select, button").forEach(el => el.remove());
    });
    // Catch orphaned editors (class removed but DOM not cleaned due to render failure) —
    // found by MARKUP, not by the .pe-editing marker: the zombie state is exactly
    // "popup present, class gone".
    document.querySelectorAll("td.price-editable select, td .pe-popup").forEach((node) => {
      const orphanTd = node.closest("td");
      if (orphanTd && orphanTd._oldHtml) orphanTd.innerHTML = orphanTd._oldHtml;
    });
    activeEditor = null;

    td._oldHtml = td.innerHTML;
    td.style.position = "relative";

    const realItemId = el.getAttribute("data-item-id");
    const city = el.getAttribute("data-city");
    // Quality cells (data-quality) key every override read/write and the market
    // slice per quality — resolveEditSource, js/price-edit-dropdown.js.
    const { itemId, marketSource } = resolveEditSource(
      realItemId, el.getAttribute("data-quality"), lastMarketData, lastQualityMarketData);

    // City dropdown — built by js/price-edit-dropdown.js so the option labels,
    // default selection, and food cross-tier handling all live in one tested
    // module. Default-selects the cheapest (buy) / highest (sell) city visible
    // in the dropdown; for food cells (meat/plants/chocolate), each city's
    // option carries that city's cheapest tier and cityToItemId maps city ->
    // tierId so commit() saves to the right itemId.
    const cityListAttr = el.getAttribute("data-city-list");
    const foodModeAttr = el.getAttribute("data-food-mode") === "1";
    // preferCity pins the dropdown default to the cell's data-city so a
    // no-change Enter commits the override at the city the user clicked,
    // not at whichever city happened to be best-priced. Prevents the
    // "edit Caerleon, override saves at Lymhurst, row looks unchanged" bug.
    const built = buildCityOptions(
      itemId,
      cityListAttr === "buy" ? "buy" : "sell",
      marketSource,
      { foodMode: foodModeAttr, preferCity: city },
    );
    const { options: optMeta, defaultIndex, cityToItemId, isFood, foodCategory } = built;
    const select = document.createElement("select");
    select.className = "pe-city-select"; // styled in css/price-editor.css
    // An option row prices, dates and sizes the book at one city, and those are
    // three different kinds of fact — so they are three differently coloured
    // spans, exactly as the table's price cell paints its number, its age and
    // its volume. A native <option> cannot colour parts of its text, so the
    // control runs in Chromium's customizable-select mode; the authored button
    // and <selectedcontent> are what make the CLOSED control show the same
    // coloured row as the list. Where base-select is unsupported the browser
    // ignores them and the spans flatten to the plain label's text.
    const selBtn = document.createElement("button");
    selBtn.appendChild(document.createElement("selectedcontent"));
    select.appendChild(selBtn);
    optMeta.forEach((m, i) => {
      const opt = document.createElement("option");
      opt.value = m.city;
      if (typeof cityOptionHtml === "function") opt.innerHTML = cityOptionHtml(m);
      else opt.textContent = m.label;
      if (i === defaultIndex) opt.selected = true;
      select.appendChild(opt);
    });
    // No-data fallback: nothing got auto-selected; pre-select the originally
    // rendered city so the dropdown isn't blank.
    if (defaultIndex < 0) select.value = city;

    // Resolve the effective itemId for a given selected city. Food mode
    // switches itemId per city; non-food keeps it constant.
    const effectiveItemIdFor = (c) => (isFood ? (cityToItemId.get(c) || itemId) : itemId);

    // Two inputs hold the buy-order (buy_price) and sell-order (sell_price)
    // prices. A radio next to each picks which one is ACTIVE — the active price
    // is what the app uses for this item/city in every context, ignoring the
    // Instant/Market toggle (e.g. tick Sell order on a material to model an
    // instant buy at the ask). Prefill: editorFieldValue (override, else market).
    const fieldValueFor = (eid, c, side) => editorFieldValue(eid, c, side, marketSource);
    // Default active order for a city: a saved choice, else "auto" — follow the
    // Pricing Model toggle, exactly as the unedited cell does.
    //
    // It used to default to the FIELD the toggle implied, and stored that as a
    // pin. So every cell the user had ever price-edited stopped responding to
    // the Instant/Market radios for good — the reported "in some tables I can't
    // switch to instant buy". A pin is now only what the user explicitly ticks.
    const defaultUseFor = (eid, c) => getOverrideUse(eid, c) || "auto";

    // Which INPUT an "auto" entry is currently reading, for focus and prefill.
    const sideForUse = (use, c) => {
      if (use === "buy" || use === "sell") return use;
      return cityListAttr === "buy"
        ? (getOrderType("buy") === "instant" ? "sell" : "buy")
        : (getOrderType("sell") === "instant" ? "buy" : "sell");
    };

    const makeFieldInput = (val) => {
      const inp = document.createElement("input");
      inp.type = "number";
      inp.className = "pe-price-input"; // hides native spinner arrows (see styles.css)
      inp.value = val;
      inp.style.cssText =
        "width:90px;background:#1f2937;color:#e5e7eb;border:1px solid #3e5e82;padding:2px 4px;font-size:0.85rem;border-radius:3px";
      return inp;
    };
    const initCity = select.value;
    const initEid = effectiveItemIdFor(initCity);
    const buyInput = makeFieldInput(fieldValueFor(initEid, initCity, "buy"));
    const sellInput = makeFieldInput(fieldValueFor(initEid, initCity, "sell"));
    const inputFor = (side) => (side === "buy" ? buyInput : sellInput);

    // Track whether the user actually edited each field. Both inputs are
    // PREFILLED from the live market, so without this an untouched field would
    // freeze its market price in as a phantom override on commit — which the ✗
    // clear then preserves as the "other side", leaving the row stuck showing ⚡
    // (the reported "clear doesn't clear the refining material price" bug).
    let buyDirty = false;
    let sellDirty = false;
    buyInput.addEventListener("input", () => { buyDirty = true; });
    sellInput.addEventListener("input", () => { sellDirty = true; });

    // "Pin to this order" checkboxes. THREE states, not two: buy pinned, sell
    // pinned, or NEITHER ticked — which is "auto", follow the Pricing Model
    // toggle. Un-ticking the active one is how you get back to auto.
    let selectedUse = defaultUseFor(initEid, initCity);
    const buyCheck = document.createElement("input");
    const sellCheck = document.createElement("input");
    [buyCheck, sellCheck].forEach((cb) => {
      cb.type = "checkbox";
      cb.style.cssText = "margin:0 4px 0 0; cursor:pointer;";
      cb.title = "Pin this price whatever the Pricing Model says. Both clear = follow the toggle.";
    });
    // One line saying which of the three states the editor is in — a pin is
    // invisible otherwise, and an invisible pin is what made whole tables look
    // like they were ignoring the Pricing Model toggle.
    const modeNote = document.createElement("div");
    modeNote.style.cssText = "font-size:0.62rem;color:#9ca3af;white-space:nowrap;padding-bottom:2px";
    const syncChecks = () => {
      buyCheck.checked = selectedUse === "buy";
      sellCheck.checked = selectedUse === "sell";
      modeNote.textContent = selectedUse === "auto"
        ? "Follows Pricing Model"
        : `Pinned to the ${selectedUse} order`;
      modeNote.style.color = selectedUse === "auto" ? "#9ca3af" : "#d9a441";
    };
    // How old the two numbers in the inputs are, for the selected city, in the
    // same green/amber/red ramp the table badges a price with. Without it the
    // editor asked the user to overwrite a number without saying whether it was
    // captured minutes or days ago — the dropdown showed volume and nothing else.
    // An overridden side has no market age at all (displayOrderDates returns
    // null for it): the number there is the user's own.
    const sellAgeSpan = document.createElement("span");
    const buyAgeSpan = document.createElement("span");
    [sellAgeSpan, buyAgeSpan].forEach((s) => { s.className = "pe-cap-age"; });
    const syncOrderAges = () => {
      const c = select.value;
      const eid = effectiveItemIdFor(c);
      const entry = marketSource?.[eid]?.[c];
      const dates = typeof displayOrderDates === "function"
        ? displayOrderDates(eid, c, entry)
        : { sellDate: null, buyDate: null };
      const paint = (span, dateStr) => {
        const a = typeof formatPriceAge === "function" ? formatPriceAge(dateStr) : null;
        span.textContent = a ? a.label : "";
        span.style.color = a ? a.color : "";
        span.title = a ? bookDatesTitle(entry) : "";
      };
      paint(sellAgeSpan, dates.sellDate);
      paint(buyAgeSpan, dates.buyDate);
    };

    buyCheck.addEventListener("change", () => {
      selectedUse = buyCheck.checked ? "buy" : "auto";
      syncChecks();
      buyInput.focus({ preventScroll: true });
    });
    sellCheck.addEventListener("change", () => {
      selectedUse = sellCheck.checked ? "sell" : "auto";
      syncChecks();
      sellInput.focus({ preventScroll: true });
    });

    const focusActiveInput = () => {
      const inp = inputFor(sideForUse(selectedUse, select.value));
      inp.focus({ preventScroll: true });
      inp.type = "text";
      inp.setSelectionRange(0, inp.value.length);
      inp.type = "number";
    };

    // When city changes, reload both fields AND the active-order pick for that
    // city (food mode also resolves to the cheapest tier via effectiveItemIdFor).
    select.addEventListener("change", () => {
      const eid = effectiveItemIdFor(select.value);
      buyInput.value = fieldValueFor(eid, select.value, "buy");
      sellInput.value = fieldValueFor(eid, select.value, "sell");
      // Re-prefilled for the new city → neither field is user-edited yet.
      buyDirty = false;
      sellDirty = false;
      selectedUse = defaultUseFor(eid, select.value);
      syncChecks();
      syncOrderAges();
      focusActiveInput();
    });

    // Scroll-anchor the edited row so the redraw's reflow doesn't move it in the
    // viewport. The pass is asynchronous now, so the correction is re-applied
    // after every phase and gives up if the user scrolls (js/scroll-anchor.js).
    const captureAnchor = () => captureRowAnchor(td);

    // Persist both inputs for the selected city. Each side's override is set
    // when its input is a positive number; on an intentional commit, an empty/0
    // input clears just that side. The city force is kept in sync — pinned
    // while any override remains, dropped on an intentional full-clear — so the
    // override survives reloads AND section-locked feed/sell searches (Caerleon-
    // section breeding rows only search ["Caerleon"] for feed by default; without
    // a force, an override at another city is invisible to that row).
    /**
     * What is STORED for a cell, as a comparable string.
     *
     * The editor closes in a dozen ways — Enter, the buttons, Escape, blur,
     * another cell taking over — and most of them change nothing at all. A
     * re-render is seconds of work across every open table, so it has to be
     * earned: this is the before/after the commit paths compare. Covers both
     * order fields, the pin, and the city forces on both sides, for every id the
     * popup can write to.
     */
    const storedSnapshot = (ids, selectedCity) => JSON.stringify(
      [...new Set(ids)].sort().map((id) => [
        id,
        getOverrideField(id, selectedCity, "buy"),
        getOverrideField(id, selectedCity, "sell"),
        typeof getOverrideUse === "function" ? getOverrideUse(id, selectedCity) : null,
        getCityForce(id, "buy"),
        getCityForce(id, "sell"),
      ]),
    );
    // Every id one commit can touch: the cell's own, the substituted food tier,
    // and — in food mode — the whole category, whose forces persistOverrides
    // wipes before re-pinning the user's pick.
    const touchedIds = (effectiveItemId) => (isFood
      ? [effectiveItemId, itemId,
        ...((typeof FOOD_ITEMS !== "undefined" && foodCategory && FOOD_ITEMS[foodCategory]) || [])]
      : [effectiveItemId, itemId]);

    const persistOverrides = (effectiveItemId, selectedCity, intentional) => {
      const before = storedSnapshot(touchedIds(effectiveItemId), selectedCity);
      const buyVal = parseInt(buyInput.value);
      const sellVal = parseInt(sellInput.value);
      const buyHasVal = !isNaN(buyVal) && buyVal > 0;
      const sellHasVal = !isNaN(sellVal) && sellVal > 0;
      // A side is stored when the user deliberately set it — edited this
      // session (dirty), already an override, or PINNED right now. Both inputs
      // are prefilled from the market, so storing an untouched one would freeze
      // its market price in as a phantom override the ✗ clear keeps as the
      // "other side".
      const keepBuy = selectedUse === "buy" || buyDirty
        || getOverrideField(effectiveItemId, selectedCity, "buy") !== null;
      const keepSell = selectedUse === "sell" || sellDirty
        || getOverrideField(effectiveItemId, selectedCity, "sell") !== null;
      // Under a pin the picked side has to carry a value; under "auto" either
      // side will do, since the toggle chooses between whatever is there.
      const activeHasVal = selectedUse === "buy" ? buyHasVal
        : selectedUse === "sell" ? sellHasVal
          : (keepBuy && buyHasVal) || (keepSell && sellHasVal);
      const anyVal = activeHasVal;
      if (activeHasVal) {
        setOverrideEntry(effectiveItemId, selectedCity, {
          buyOrder: keepBuy && buyHasVal ? buyVal : undefined,
          sellOrder: keepSell && sellHasVal ? sellVal : undefined,
          use: selectedUse,
        });
      } else if (intentional) {
        clearOverridePrice(effectiveItemId, selectedCity);
      }
      const side = cityListAttr === "buy" ? "buy" : "sell";
      if (isFood) {
        // Clear stale forces across the whole food category first (pre-fix
        // commits pinned whichever meat tier was rendered), then re-pin the
        // user's deliberate (tier @ city) pick. Other tiers stay unpinned so
        // cross-tier discovery still works on subsequent edits.
        const ids = (typeof FOOD_ITEMS !== "undefined" && foodCategory
          && FOOD_ITEMS[foodCategory]) || [];
        ids.forEach((id) => clearCityForce(id, side));
        if (anyVal) {
          setCityForce(effectiveItemId, side, selectedCity);
          // Persist the tier pick itself too — without it findCheapestFeed
          // re-ranked the whole category on every refresh and the next
          // cheapest tier displaced the user's choice.
          if (typeof PinnedFeed !== "undefined") PinnedFeed.set(foodCategory, effectiveItemId);
        } else if (intentional) {
          clearCityForce(effectiveItemId, side);
          if (typeof PinnedFeed !== "undefined") PinnedFeed.clear(foodCategory);
        }
      } else {
        if (anyVal) setCityForce(itemId, side, selectedCity);
        else if (intentional) clearCityForce(itemId, side);
      }
      return {
        anyVal,
        changed: storedSnapshot(touchedIds(effectiveItemId), selectedCity) !== before,
      };
    };

    // Re-render after a commit/clear. Asynchronous (js/render-async.js): the
    // pass draws the edited table first and hands the thread back between
    // phases, so the window stays usable instead of freezing for a second or
    // more. Both branches of the old synchronous version — the normal one and
    // the Quality Rerolling table scanned on its own, where lastMarketData is
    // still null — live in planRerenderPass().
    const rerenderAfterEdit = (itemIds) => {
      const reapply = createAnchorRestorer(captureAnchor());
      return scheduleRerender("price-edit", {
        priorityTableId: td.closest("table")?.id || null,
        // What this commit can have moved, so the pending marks land on the rows
        // that show this price rather than on every number in the app. The same
        // list persistOverrides diffs against (touchedIds), so a food-mode edit
        // covers the whole substituted category.
        itemIds,
        // After every phase, not once: each phase can change the height of the
        // page above the edited row, and each correction is idempotent. The
        // pending mark is re-applied for the same reason — the edited table is
        // redrawn in the FIRST phase, so the marked cell is a new node long
        // before the pass (and the wait the mark is reporting) is over.
        onPhase: () => {
          reapply();
          if (typeof reapplyPendingEditMark === "function") reapplyPendingEditMark();
        },
      });
    };

    /**
     * Put the cell back the way it was found.
     *
     * Unconditional, and that matters: the redraw used to run synchronously one
     * statement later and wipe the whole tbody, so leaving the editor's markup
     * behind was harmless. It is not any more — the popup would stay on screen
     * (and the cell invisible) for the debounce plus the first phase. The
     * redraw removes the node it restores; markPendingEdit dims it, spins a
     * small ring in it and accents its row in the meantime (js/pending-edit-mark.js)
     * to say the number is about to change — the broad mark covers the profit
     * columns, this one covers the cell the user is actually looking at.
     */
    const restoreCell = (rerendering) => {
      // The popup goes first, unconditionally: a re-render can detach this cell
      // mid-gesture, and a detached cell must not carry the editor's inputs
      // into anything that clones live rows (the craft list held-row cache —
      // the phantom input bug). Restoring the markup is only useful while the
      // cell is still connected.
      if (container.isConnected) container.remove();
      if (!td.isConnected) return;
      td.innerHTML = td._oldHtml;
      td.style.position = "";
      if (rerendering) markPendingEdit(td);
    };

    let _committing = false;
    const commit = (intentional = false) => {
      if (_committing) return;
      _committing = true;
      // The pass is asked for inside the try and the cell restored in the
      // finally on purpose: a throw in persistOverrides (localStorage quota)
      // or in the scheduling must not strand the popup on screen with
      // _committing blocking every retry.
      let rerendering = false;
      try {
        const selectedCity = select.value;
        const effectiveItemId = effectiveItemIdFor(selectedCity);
        const { changed } = persistOverrides(effectiveItemId, selectedCity, intentional);
        // Nothing stored moved — opening a cell, reading its order book and
        // clicking away is a LOOK, not an edit, and it was costing a full pass
        // over every open table (a whole app of numbers spinning when you
        // changed nothing).
        if (changed) rerendering = rerenderAfterEdit(touchedIds(effectiveItemId));
      } finally {
        td.classList.remove("pe-editing");
        delete td._closeEditor;
        activeEditor = null;
        restoreCell(rerendering);
      }
    };

    const thisEditor = {
      closeQuietly: () => {
        let changed = false;
        let touched = null;
        // Persist and cleanup wrapped together so a throwing persist cannot
        // skip the restore — the finally always puts the cell back.
        try {
          if (!_committing) {
            _committing = true;
            // Only persist when the picked order has a positive value —
            // closeQuietly fires when another editor takes over, so it must not
            // clear values or touch forces for an untouched/empty popup.
            const v = parseInt(inputFor(selectedUse).value);
            const hasVal = !isNaN(v) && v > 0;
            if (hasVal) {
              const selectedCity = select.value;
              const effectiveItemId = effectiveItemIdFor(selectedCity);
              changed = persistOverrides(effectiveItemId, selectedCity, false).changed;
              touched = touchedIds(effectiveItemId);
            }
          }
        } finally {
          td.classList.remove("pe-editing");
          delete td._closeEditor;
          // No redraw of its own — another editor is opening and will trigger one
          // when it closes. But the pass that IS running was stopped by this
          // editor being open (js/render-async.js), so ask for it again: without
          // this, tables it never reached would sit stale until the next commit.
          restoreCell(false);
        }
        // A pass stopped by this editor owes the tables it never reached
        // (js/render-gating.js keeps that ledger), so ask again when there IS
        // such a debt — or when the quiet persist actually stored something.
        // Asking unconditionally is what made clicking from one price cell to
        // the next recalculate the whole app for no reason.
        const owed = typeof deferredTableIds === "function" && deferredTableIds().length > 0;
        // Scoped only when this close is the whole reason for the pass. A table
        // that owes a render owes ALL of it — its rows were never drawn against
        // the current prices — so those numbers are all pending, not just this
        // item's.
        if (changed || owed) {
          scheduleRerender("editor-closed", owed ? {} : { itemIds: touched });
        }
      },
    };
    activeEditor = thisEditor;
    td.classList.add("pe-editing");
    td._closeEditor = thisEditor.closeQuietly;

    const onKeydown = (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        commit(true); // intentional commit
      }
      if (ev.key === "Escape") {
        ev.preventDefault();
        _committing = true;
        td.classList.remove("pe-editing");
        delete td._closeEditor;
        activeEditor = null;
        // Put the old markup back rather than blanking the cell: the redraw
        // that used to wipe it one statement later is asynchronous now, so a
        // blanked cell would stay blank for as long as the pass takes.
        // Escape stores nothing by definition, so there is nothing to redraw.
        restoreCell(false);
      }
    };
    const commitIfFocusLeaves = (ev) => {
      if (td.contains(ev.relatedTarget)) return; // focus moved to sibling element, keep editor open
      setTimeout(() => {
        if (_committing) return;
        if (activeEditor !== thisEditor) return; // another editor took over
        if (td.contains(document.activeElement)) return; // focus returned to td (e.g. after dropdown change)
        commit();
      }, 150);
    };
    [buyInput, sellInput, buyCheck, sellCheck, select].forEach((el2) => {
      el2.addEventListener("keydown", onKeydown);
      el2.addEventListener("blur", commitIfFocusLeaves);
    });

    // OK / Clear buttons
    const makeBtn = (label, title, color) => {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.title = title;
      btn.style.cssText =
        `background:none;border:1px solid ${color};color:${color};` +
        "padding:1px 6px;font-size:0.9rem;border-radius:3px;cursor:pointer;margin-left:4px;line-height:1.4";
      return btn;
    };
    const okBtn = makeBtn("✓", "Save override", "#5e9e78");
    const clearBtn = makeBtn(
      "✗",
      tx("Clear override (all cities, back to market price)", "r_tip_clear_override"),
      "#9e5858",
    );

    okBtn.addEventListener("blur", commitIfFocusLeaves);
    clearBtn.addEventListener("blur", commitIfFocusLeaves);

    okBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      commit(true); // intentional commit
    });
    clearBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const selectedCity = select.value;
      const effectiveItemId = effectiveItemIdFor(selectedCity);
      // ✗ means "this item is not overridden any more" — drop every entry it
      // has, at EVERY city and on both order sides.
      //
      // Both widenings were reported bugs. Clearing only the clicked SIDE left a
      // phantom other-side entry frozen in from the prefilled input, so the price
      // could never be cleared. Clearing only the clicked CITY was the same story
      // one level up: no row reads an override per city — they all pick their
      // city globally (findBestBuyCity / findBestSellCity) and an override at any
      // city bypasses the volume gate — so the delete just promoted the next
      // city's entry and ⚡ stayed put until the user had clicked ✗ once per city
      // they had ever edited.
      let removed = false;
      let rerendering = false;
      const clearIds = isFood
        // A food cell stands for "feed at this city" across tiers, so the whole
        // category goes — same scope as the force wipe below.
        ? ((typeof FOOD_ITEMS !== "undefined" && foodCategory
            && FOOD_ITEMS[foodCategory]) || [effectiveItemId])
        : [effectiveItemId, itemId];
      // Forces on BOTH sides: persistOverrides pins the side the cell was
      // rendered on, but the same item can carry a force from a cell on the
      // other side, and a surviving force re-pins the row to the cleared city.
      const forceIds = isFood
        ? ((typeof FOOD_ITEMS !== "undefined" && foodCategory
            && FOOD_ITEMS[foodCategory]) || [effectiveItemId])
        : [itemId, effectiveItemId];
      // Deleting and cleanup wrapped together so a throwing delete cannot skip
      // the restore and strand the popup.
      try {
        [...new Set(clearIds)].forEach((id) => {
          if (clearOverridePriceAllCities(id)) removed = true;
        });
        [...new Set(forceIds)].forEach((id) => {
          ["buy", "sell"].forEach((s) => { if (clearCityForce(id, s)) removed = true; });
        });
        // The tier pin goes with everything else — ✗ is "back to market",
        // which means cheapest-tier ranking, not a phantom pinned tier.
        if (isFood && foodCategory
          && typeof PinnedFeed !== "undefined" && PinnedFeed.clear(foodCategory)) removed = true;
        // A clear on a cell that was never overridden deletes nothing, so it
        // redraws nothing — the numbers it would recompute are already on screen.
        if (removed) rerendering = rerenderAfterEdit([...new Set([...clearIds, ...forceIds])]);
      } finally {
        td.classList.remove("pe-editing");
        delete td._closeEditor;
        activeEditor = null;
        restoreCell(rerendering);
      }
      // Stop the cell reading as overridden RIGHT NOW. restoreCell puts the old
      // markup back — ⚡ and the amber colour — and the repaint is debounced (and
      // skipped entirely while another editor is open), so a correct clear used
      // to look like it had done nothing, which is half of "it takes several
      // tries". The number itself is fixed by the pass. Scoped to the cleared
      // ids: one td can hold several price spans (chain breakdown lines) and the
      // other items' markers are still true.
      // realItemId too: a quality cell's markup carries the plain item id while
      // its override lives under the synthetic ID#Qn key.
      const clearedIds = new Set([...clearIds, realItemId]);
      const unmark = (node) => {
        node.querySelectorAll(".ov-mark").forEach((n) => n.remove());
        node.style.color = "";
      };
      const spans = td.querySelectorAll(".price-editable[data-item-id]");
      if (spans.length) {
        spans.forEach((s) => { if (clearedIds.has(s.dataset.itemId)) unmark(s); });
      }
      if (td.matches(".price-editable") && clearedIds.has(td.dataset.itemId)) unmark(td);
    });

    // Wrap each input with a caption (incl. the "use this order" checkbox) so
    // the two order prices are labeled and the active one can be picked.
    const fieldWrap = (labelText, inp, check, ageSpan) => {
      const w = document.createElement("div");
      w.style.cssText = "display:flex; flex-direction:column; gap:1px;";
      const cap = document.createElement("label");
      cap.style.cssText =
        "display:flex; align-items:center; font-size:0.62rem; color:#9ca3af; text-transform:uppercase; letter-spacing:0.03em; cursor:pointer;";
      cap.appendChild(check);
      cap.appendChild(document.createTextNode(labelText));
      if (ageSpan) cap.appendChild(ageSpan);
      w.appendChild(cap);
      w.appendChild(inp);
      return w;
    };

    syncChecks();
    syncOrderAges();
    const container = document.createElement("div");
    // Stable marker: sweepers (the orphan sweep above, the craft list's
    // _clCloseOpenEditors, the held-row harvest) find the popup by markup even
    // when the .pe-editing class on the cell is already gone.
    container.className = "pe-popup";
    // FIXED, not absolute: an absolutely positioned editor is clipped by the
    // table's own horizontal scroll container, which ate the ✗ button on the
    // rightmost column however far it was nudged. Fixed escapes every
    // overflow ancestor; placement is then pure arithmetic (see below).
    container.style.cssText = "position:fixed; z-index:9999; display:flex; gap:4px; align-items:flex-end; background:#1f2937; padding:6px; border:1px solid #3e5e82; box-shadow:0 8px 24px rgba(0,0,0,0.85); border-radius:4px; min-width:max-content;";
    container.appendChild(select);
    // In-game order book layout: sell orders on the left, buy orders on the right.
    container.appendChild(fieldWrap("Sell order", sellInput, sellCheck, sellAgeSpan));
    container.appendChild(fieldWrap("Buy order", buyInput, buyCheck, buyAgeSpan));
    container.appendChild(okBtn);
    container.appendChild(clearBtn);
    container.appendChild(modeNote);

    td.innerHTML = `<div style="visibility:hidden">${td._oldHtml}</div>`;
    td.appendChild(container);
    focusActiveInput();

    // Centre the editor on its cell, then pull it back inside the window — the
    // last column would otherwise put half of it where nothing can reach it.
    // Re-run while the editor lives, since scrolling the table moves the cell
    // out from under it; the listeners retire themselves once it is gone.
    const placeEditor = () => {
      if (!container.isConnected) return false;
      const cell = td.getBoundingClientRect();
      const rect = container.getBoundingClientRect();
      const { left, top } = clampEditorPosition(
        cell,
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight },
      );
      container.style.left = `${left}px`;
      container.style.top = `${top}px`;
      return true;
    };
    const reposition = () => {
      if (placeEditor()) return;
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    placeEditor();
    // A second pass after layout settles: the caption row and the number inputs
    // change the box's width once the browser has measured them.
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(placeEditor);
  });
  // ───────────────────────────────────────────────────────────────────────────
}
