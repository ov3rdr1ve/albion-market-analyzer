/**
 * Spanish (ES-ES) overlay, part 3 — the row-level strings render-*.js builds at
 * runtime and passes to tx(englishText, slug).
 *
 * Split from parts 1/2 purely for file size (the repo caps source files at 800
 * lines); js/i18n-strings-es.js merges all three into one UI_STRINGS_ES.
 *
 * Two kinds of key live here:
 *   - r_*   one string per message. `{name}` placeholders are substituted by
 *           the caller with .replace(), so every placeholder in the English
 *           MUST survive translation or the number/city it carries is lost.
 *   - <prefix>_<label>  data-file labels translated through a slug built from
 *           the English (prof_/tool_/water_/creature_/food_/roll_/cat_/bf_).
 */
const UI_STRINGS_ES_ROWS = {
  // ── Precios, celdas compartidas (app.js) ────────────────────────────────
  r_price_overridden: "Precio ajustado",
  r_tip_override_price: "Haz clic para ajustar el precio",
  r_tip_clear_override: "Quitar el ajuste (en todas las ciudades, volver al precio de mercado)",
  r_tip_aggregate_cost:
    "Materiales de arriba más tarifas. Para cambiarlo, edita el precio de un material en la columna Materiales.",
  r_ea: "c/u",
  r_vol: "vol",
  r_price_last_seen: "Precio visto por última vez",
  r_book_buy_order: "Orden de compra",
  r_book_sell_order: "Orden de venta",
  r_no_data: "sin datos",
  r_no_data_click_to_set: "sin datos — haz clic para fijarlo",
  r_no_instant_orders_click_to_set: "sin órdenes de venta — haz clic para fijarlo",
  r_tip_no_instant_orders: "Hay órdenes de compra, pero ninguna orden de venta para comprar al instante. Haz clic para fijar un precio.",
  r_tip_change_sell_city: "Haz clic para cambiar la ciudad de venta",
  r_no_market_data: "sin datos de mercado",
  r_silver: "plata",
  r_gross: "bruto",
  r_setup: "instalación",
  r_tax: "impuesto",
  r_no_fees_instant_buy: "(sin tarifas — compra instantánea)",
  r_at: "en",
  r_from_lower: "de",
  r_instead_of: "en vez de",
  r_substitutes_for: "Sustituye a",
  r_focus: "concentración",
  r_focus_ea: "concentración c/u",
  r_per_focus: "/concentración",
  r_silver_per_focus: "plata/concentración",
  r_total: "total",
  r_incl: "incl.",

  // ── Calculadora de tarifas ──────────────────────────────────────────────
  r_unnamed: "(sin nombre)",
  r_tip_edit_row: "Editar esta fila — al guardar se actualiza en su sitio",
  r_tip_load_row: "Cargar una copia en la calculadora — al guardar se añade una fila nueva",
  r_tip_delete_row: "Eliminar esta fila guardada",
  r_update_row: "✓ Actualizar fila",
  r_cancel_edit: "Cancelar edición",

  // ── Cadenas de fabricación / refinado ───────────────────────────────────
  r_tip_made_from_breakdown: "Hecho a partir del desglose de abajo",
  r_via_chain: "(vía cadena)",
  r_not_listed_via_chain: "(sin oferta — vía cadena)",
  r_tip_unlisted_via_chain:
    "No hay oferta en ningún mercado al que llegue esta ruta, así que la fila se valora por lo que cuesta fabricarlo: el desglose de abajo.",
  // Panel "rutas alternativas" de Consumibles: ingredientes que compras y
  // podrías fabricar tú mismo.
  r_cons_alt_routes: "rutas alternativas",
  r_tip_cons_alt_toggle:
    "Ingredientes que podrías fabricar tú mismo en vez de comprarlos. La fila de arriba los compra todos en el mercado; aquí ves lo que cuesta cada cadena y lo que suma al beneficio.",
  r_cons_alt_intro: "Ingredientes que esta fila compra y podrías fabricar tú mismo:",
  r_cons_alt_make: "fabricar {item} tú mismo",
  r_cons_alt_saves: "ahorra",
  r_tip_cons_alt_saves:
    "Plata que esta fabricación se queda por unidad al fabricar el ingrediente en cadena en vez de comprarlo. La fila de arriba se valora al precio de compra del mercado, así que este beneficio todavía no está contado.",
  r_cons_alt_profit: "beneficio",
  r_cons_alt_vs: "frente a",
  r_via_transmute: "(vía transmutación)",
  r_tip_via_transmute:
    "Sale más barato comprar {item} y transmutarlo hacia arriba que comprar este bruto ({price} frente al mercado). Se refina como cualquier bruto.",
  r_tip_cheaper_to_refine: "Más barato refinar que comprar",
  r_tip_non_focus_consumable:
    "Usa un consumible no fabricable con concentración — {savings} de plata de ahorro de cadena por lote pasan a la columna plata/concentración de esta receta",
  r_tip_non_focus_no_cost:
    "(plata/concentración se queda en '—' porque ESTA receta no tiene coste de concentración, pero el bono es real)",
  r_uses_non_focus_consumable: "(usa consumible no fabricable con concentración)",
  r_tip_no_rrr_refund:
    "Este insumo no tiene devolución de recursos (carnicería / salsa de pescado — cada unidad se consume por completo)",
  r_no_rrr_refund: "(sin devolución RRR)",
  r_consumed: "consumidos",
  r_no_return: "sin devolución",
  r_no_recipe: "sin receta",
  r_chain: "cadena",
  r_direct: "directo",
  r_tip_chain_refining:
    "Refinado en cadena: el material secundario lo refinas tú desde niveles inferiores (suele salir más barato).",
  r_tip_direct_refining:
    "Refinado directo: el material secundario se compra ya hecho en el mercado — se muestra junto a la fila de cadena para comparar.",
  r_tip_enchanted_rock:
    "Refinado a partir de roca en bruto encantada (.{ench}): un refinado toma {mult}× bloques inferiores por {mult}× bloques normales y {mult}× concentración. No existe el bloque encantado.",
  r_rock_lower: "roca",
  r_tip_heart_substitute:
    "El corazón de facción sustituye a 1x {raw} — más barato que el bruto (el corazón se consume; sin devolución de recursos)",
  r_substitute_cheaper: "(sustituto — más barato que {raw})",
  r_tip_mat_substitute:
    "Ocupa la ranura de {raw} en esta receta — misma fabricación, misma concentración, más barato de comprar.",
  r_tip_planner_transmute:
    "Su bruto no se compra al precio de {raw}: se compra {start} en {city} y se transmuta hacia arriba ({steps} paso(s)) por {cost} cada uno.",

  // ── Fabricación / consumibles ───────────────────────────────────────────
  r_no_spec: "(sin especialización)",
  r_no_spec_craft_tip:
    "Sin especialización de {type} en {city} — solo RRR base. {specCity} es la ciudad especializada{note}.",
  r_unreachable_red_zone: "inalcanzable con las rutas de zona roja desactivadas",
  r_no_spec_consumable_tip:
    "Sin bono de {type} en {city} — solo el 18% de RRR base. Caerleon (comida) / Brecilien (pociones) son las ciudades especializadas.",
  r_p10k_craft_tip: "{profit} de beneficio/fabricación (tras coste de materiales) × {crafts} fabricaciones ({focus} de concentración c/u)",
  r_p10k_unit_tip: "{profit} de beneficio/unidad (tras coste de materiales) × {units} unidades ({focus} de concentración c/u)",
  r_p10k_farming_tip: "Rendimiento de barra completa: {profit} por ciclo REGADO (tras coste de semillas) × {cycles} ciclos ({focus} concentración c/u). Plata/concentración muestra lo que da el riego.",
  r_farming_no_focus_play: "Ninguna jugada de concentración en esta fila",
  r_no_focus_combine_tip:
    "Aquí no hay concentración que gastar: es una fabricación combinada (objeto base terminado + sellos/emblemas/fichas) que cuesta 0 de concentración según los datos del juego, y ninguno de sus insumos se puede refinar, así que una barra de 10k de concentración no compra nada. Tampoco llena ningún diario de fabricación.",
  r_not_focus_craftable: "No se puede fabricar con concentración — este objeto no tiene craftingfocus",
  r_not_focus_craftable_itemsxml:
    "No se puede fabricar con concentración según items.xml — el RRR base se sigue aplicando a los insumos (este objeto no tiene el atributo craftingfocus)",
  r_capital: "capital",
  r_capital_tip:
    "Se compra una vez y se puede revender — el animal sobrevive a cada ciclo, así que no forma parte del coste por unidad",
  r_pasture_no_focus:
    "Un ciclo de producción no gasta concentración — el animal come, espera 22 h y entrega el subproducto",
  r_ppf_batch_tip: "{added} añadidos por lote ÷ {focus} de concentración — lo que compra la concentración en sí (RRR {rrr}% aplicado a {target}), no el beneficio total del lote",
  r_p10k_batch_tip: "{profit} de beneficio/lote (tras coste de materiales) × {batches} {verb} ({focus} de concentración c/u)",
  r_output_meat: "la carne producida",
  r_input_refund: "la devolución de insumos",
  r_yield_per_craft_tip:
    "Una fabricación produce {n} unidades; las cantidades de ingredientes, el coste y el beneficio se muestran por unidad.",
  r_yields_per_craft: "(produce {n}/fabricación)",

  // ── Planificador de fabricación ─────────────────────────────────────────
  r_tip_focus_on_refine:
    "Tu concentración se gasta en este refinado (T{tier}), bajando el coste del objeto fabricado",
  r_tip_self_refined:
    "Refinado por ti mismo subiendo la escalera de {type} (más barato que comprar la barra). Haz clic para fijar lo que cuesta la barra en {city}.",
  r_tip_open_refine_row: "Abre este refinado en la tabla Refinado / Transportes.",
  r_refine_lower: "refinar",
  r_tip_focus_refine_used:
    "Gasta tu concentración en ESTE paso de refinado (el nivel más barato de la escalera) y usa el resultado en la fabricación — de todos los sitios donde esta fila puede poner un punto de concentración, este es el que deja el objeto terminado más rentable. Todos los demás pasos de la escalera se refinan sin concentración. Haz clic para abrirlo en la tabla Refinado / Transportes.",
  r_focus_refine_ladder: "en la escalera de {mat}",
  r_tip_focus_craft:
    "Gasta tu concentración en la FABRICACIÓN: la tasa de retorno extra ahorra más en los materiales de esta receta que concentrar cualquier paso de refinado por debajo, así que el objeto terminado acaba siendo el más rentable.",
  r_per_craft: "/fabricación",
  // Línea "mejor ruta": cómo consigue de verdad la fila cada material
  r_paths_best: "mejor ruta",
  r_paths_buy: "comprarlo",
  r_paths_buy_item: "comprar {item}",
  r_paths_refine: "refinarlo tú mismo",
  r_paths_with_heart: "(con {heart})",
  r_tip_paths_heart:
    "Un corazón de facción sustituye a una unidad del recurso bruto — más barato que el bruto al que reemplaza. El corazón se consume por completo (sin retorno de recursos).",
  r_tip_paths_transmute:
    "Su recurso bruto no se compra a su propio precio: se compra un nodo inferior más barato y se transmuta hacia arriba.",
  // ── Costes de construcción (filas) ──────────────────────────────────────
  r_bld_part_shell: "estructura",
  r_bld_part_laborers: "trabajadores",
  r_bld_part_furniture: "mobiliario",
  r_tip_building_fee:
    "Tarifa de colocación de cada paso de mejora, después del Descuento global que fija el precio del oro",
  r_tip_bld_upgrade_path:
    "Cada paso de mejora desde cero: {chain} = {total}. El paso de este nivel cuesta {step}.",
  r_tip_bld_fitted_extra:
    "Los contratos y el mobiliario suman {extra}, comprados una sola vez en este nivel.",
  r_tip_bld_partial:
    "Parcial: {parts} sin precio, así que no suman nada a este total. Haz clic en ese precio para ponerlo.",
  r_bld_part_contract: "contrato de trabajador",
  r_bld_part_beds: "camas",
  r_bld_part_tables: "mesas",
  r_bld_trophy_happiness: "de felicidad por trofeos",
  r_bld_optional: "opcionales",
  r_bld_no_trophies: "no cabe ningún trofeo",
  r_bld_slots_spare: "ranuras libres",
  r_bld_slots_overflow:
    "las ranuras de mobiliario no dan ni para una cama por trabajador",
  r_bld_yield: "de rendimiento",
  r_bld_contract_no_listing: "sin oferta — haz clic en el precio para ponerlo",
  r_bld_contract_none_priced: "contrato de trabajador — ninguna línea con precio aún",
  r_tip_bld_furnishing:
    "Una cama sirve a 1 trabajador, una mesa a 4 (6 desde T5); las ranuras libres van a trofeos. La felicidad solo se acumula entre trofeos DISTINTOS, ninguno por encima del nivel del edificio.",
  r_tip_bld_journal_no_data:
    "Haz un escaneo completo (o el de Trabajadores) para valorar los diarios — el escaneo de edificios no los obtiene a propósito.",
  r_tip_bld_journal_lower:
    "Un diario T{journal} está por debajo del nivel de este trabajador, así que ya rinde el 150 % — los trofeos no pueden subirlo y aquí son opcionales.",
  r_tip_bld_journal_same:
    "El nivel del propio trabajador es el diario más rentable con el que alimentarlo, y un diario del mismo nivel sí necesita la felicidad de los trofeos para alcanzar su rendimiento.",

  r_full_journal_sell: "venta del diario lleno",
  r_empty_journal_buy: "compra del diario vacío",
  r_tip_override_journal_price: "Haz clic para ajustar el precio de {what}",
  r_laborer_journal_tip:
    "Beneficio puro {profit} + {extra} de valor del trabajador: {fame} de fama/fabricación llenan un diario de {laborer} T{tier} ({maxfame}); un T8 devuelve {payout} con rendimiento ×{yield}.",
  r_laborer_journal_no_price:
    "Todavía no hay precio para el refinado que devuelve el trabajador de esta profesión.",
  r_laborer_journal_none: "Esta fabricación no llena ningún diario de fabricación.",
  r_cp_laborer_journal_tip:
    "Fabricación {profit} + {extra} del trabajador: {fame} de fama/fabricación llenan un diario de {laborer} T{tier} ({maxfame}); un T8 devuelve {payout} a ×{yield}. {verdict}",
  r_laborer_beats_selling: "Gana a vender el diario.",
  r_laborer_loses_to_selling: "Vender el diario paga más.",
  r_cp_laborer_per_journal: "{payout} / diario · ×{yield} · {crafts} fabricaciones",
  r_cp_sell_pin_dropped: "fijado en {pin} — no se puede vender allí desde {city}",
  r_cp_sell_pin_dropped_tip:
    "Fijado en {pin}, adonde esta ciudad de fabricación no llega, así que la fila vende al precio de mercado. Caerleon sí llega al Mercado Negro; el resto necesita las Rutas.",
  r_cp_sell_pin_filtered: "filtrado a {city} — tu fijación no se aplica",
  r_cp_sell_pin_filtered_tip:
    "El filtro de Ciudad de la tabla muestra cada fila valorada en {city}. Vuelve a Todas para que cada fila venda donde más paga, fijación incluida.",
  r_cp_laborer_mix_tip: "Devuelve {mix}.",
  r_cp_laborer_bar_tip: "Una barra de 10.000 de concentración gastada así vale {bar}.",
  // Línea "mejor ruta" de una fila obtenida por encantamiento (comprar el @n-1 y encantarlo)
  r_paths_enchant: "encantarlo tú mismo",
  r_tip_paths_enchant:
    "Más barato que fabricarlo: compra el objeto de encantamiento inferior y súbele el encantamiento en una estación de fabricación; las runas se consumen por completo y no se llena ningún diario de fabricación.",
  r_per_craft_unit: "/fabricación",

  // ── Refinado / transportes ──────────────────────────────────────────────
  r_p10k_refine_tip: "{profit} de beneficio/refinado (tras coste de materiales) × {refines} refinados ({focus} de concentración c/u)",
  r_pg10k_refine_tip:
    "Brutos recolectados por ti (coste 0, aquí y en toda la cadena): {profit} de beneficio/refinado × {refines} refinados ({focus} c/u). Barras, tarifas e impuesto se siguen cobrando.",
  r_p10k_sub_tier_note:
    "La concentración se gasta en el paso T{tier} de la cadena, así que la barra rinde {outputs} unidades terminadas.",

  // ── Gasto de facción y Favor ────────────────────────────────────────────
  r_note_heart_refine: "También sirve como sustituto de refinado T4+",
  r_note_baby_breeding: "También sirve como insumo de la cadena de cría de monturas",
  r_cape_crafted_prefix: "fabricada:",
  r_cape_crest_fp_unit: "PF",
  r_cape_crest_favor_unit: "Favor",
  r_cape_inputs_incomplete: "⚠ materiales incompletos — haz clic en el precio que falte para fijarlo",
  r_note_loot_chest: "Cofre de botín — haz clic en el rendimiento para fijar/ajustar la plata esperada",
  r_note_siphoned_energy: "150 de Favor → 1 Energía Sifonada, vendida en bruto",
  r_note_direct_favor: "Compra directa con Favor (sin receta de energía)",
  r_note_antiquarian_spider: "El Anticuario — vendida en bruto o criada hasta la montura araña",
  r_note_brecilien_raw: "Brecilien (Eralia Wayfarer) — vendida en bruto",
  r_note_brecilien_owl: "Brecilien (Eralia Wayfarer) — vendida en bruto o criada hasta la montura Búho Místico",
  r_not_fp_purchase: "No es una compra con PF",
  r_not_favor_purchase: "No es una compra con Favor",
  r_fame_per_favor_tip: "Fama de combate ÷ coste en Favor (libro de fama no comerciable — fama, no plata)",
  r_fame_per_fav: "fama/Fav",
  r_silver_per_favor_tip: "Plata neta ÷ coste en Favor (150 de Favor = 1 Energía Sifonada)",
  r_no_silver_per_favor:
    "Sin plata/Favor — fija el rendimiento del cofre o escanea los precios de fichas/monturas",
  r_fame_book_no_price: "Libro de fama no comerciable — sin precio de mercado",
  r_override_chest_yield: "Haz clic para ajustar la plata esperada (puedes fijarla desde cualquier ciudad)",
  r_no_silver_fame_book: "Sin valor en plata — libro de fama",
  r_breeding_baby_only: "La cría solo se aplica a las filas de crías",
  r_toggle_base_mount_cost: "Mostrar/ocultar el coste de montura base + materiales",
  r_base_mount_deducted: "Montura base + materiales descontados de la venta de la montura",
  r_inputs_missing_tip: "Faltan precios de insumos — el neto está sobrestimado hasta que los fijes",
  r_inputs_incomplete: "insumos incompletos",
  r_toggle_breed_inputs: "Mostrar/ocultar los insumos de cría (montura ensillada, comida, materiales)",
  r_breeding_finish: "(Cría → {mount})",
  r_own_baby: "Cría propia",
  r_baby_sell_word: "vender",
  r_baby_raise_word: "criar",
  r_vs: "vs",
  r_baby_sale_tip: "Cría que ya tienes: véndela ya (instantáneo, tras impuesto) vs críala un ciclo (el beneficio de esta fila más el precio de compra de la cría que ya no pagas)",
  r_breed_wins: "gana criar",
  r_best_fp: "Mejor PF",
  r_per_cycle: "/ciclo",
  r_best_fp_tip: "Dónde rinde más el PF en esta cadena: beneficio del ciclo con esos insumos pagados en PF (el resto comprado), por PF. Pagarlo todo es la cifra P/PF (criado).",
  r_raw_wins: "gana vender en bruto",
  r_breed_ratio_tip: "Plata por {cur} si nutres y ensillas la cría en vez de venderla en bruto",
  r_no_saddled_price:
    "Sin precio de mercado de la montura ensillada — despliega para fijar a mano los insumos de cría",
  r_no_focus_use_path: "Este objeto no tiene ninguna vía de uso que consuma concentración",
  r_missing_input_upper_bound: "insumo sin precio tratado como gratis; el neto es una cota superior",
  r_mount_sale_net_tax: "Venta de la montura (neta de impuesto)",
  r_inputs_base_mount_mats: "Insumos (montura base + materiales)",
  r_net_silver: "Plata neta",
  r_base_mount_consumed: "Montura base (se consume 1)",
  r_materials_consumed_no_return: "Materiales (consumidos, sin retorno)",
  r_favor_source_energy: "Origen del Favor — Energía Sifonada",
  r_energy_backs_favor:
    "respalda las {n} de Favor; no se descuenta del neto por valor de Favor",
  r_favor_value_net: "(valor de Favor)",
  r_siphoned_energy_at_market: "Energía Sifonada a precio de mercado",
  r_pure_profit_incl_energy: "Beneficio puro incl. energía",
  r_energy_price_missing: "falta precio de la energía o de un insumo",

  // ── Cría y monturas ─────────────────────────────────────────────────────
  r_baby: "Cría",
  r_offspring: "descendencia",
  r_offspring_over_100:
    "Más del 100 %: el excedente es una probabilidad de una SEGUNDA cría del mismo ciclo.",
  r_rare_focus_only: "rara (solo con concentración)",
  r_grow_title: "Necesita {total} de nutrición ({pieces}x de {each} c/u)",
  r_grow: "de crecimiento",
  r_nurture: "Nutrición",
  r_nurtured: "nutridas",
  r_nurture_focus_tip:
    "{focus} de concentración por nutrición según tus niveles de ⚙ Especialización — {max} con 100/100, 1.000 antes de maestría. El nivel solo cambia el NÚMERO de nutriciones.",
  r_focus_max_spec: "de concentración (especialización máxima)",
  r_focus_your_spec: "de concentración (tu especialización)",
  r_no_nurture_data: "Sin datos de nutrición",
  r_no_saddler_recipe: "Sin receta de guarnicionero",
  r_breeding_nurture: "Cría (nutrición)",
  r_saddling_craft: "Ensillado (fabricación)",
  r_no_food_category: "Sin categoría {food}",
  r_feed_detail: "(de {city}; {food} más barata a {rate} de plata/nutrición; total {total})",
  r_no_market_data_override: "(sin datos de mercado — haz clic en el precio para ajustarlo)",
  r_no_data_override: "(sin datos — haz clic para ajustar)",
  r_nurtures_tip: "{n} nutriciones × {focus} de concentración (según tu ⚙ especialización) para nutrir del todo cada cría",
  r_focus_per_baby: "de concentración/cría",
  r_cycle_margin: "margen del ciclo",
  r_baby_price: "precio de la cría",
  r_ppf_tip: "{pct}% de descendencia extra × {value} ({source}) ÷ {focus} de concentración",
  r_ppf_saddler_tip: "Gasta la concentración en la fabricación de MONTURA: {added} de cuero extra devuelto ÷ {focus} de concentración. Aquí vale más que nutrir la descendencia de esta fila.",
  r_offspring_maxed: "La descendencia base ya está al 100%",
  r_set_prices_to_calc: "Fija el precio de la cría o el de venta para calcular",
  r_silver_per_favor_outlay:
    "{profit} de plata ÷ {favor} de Favor desembolsado (trata la cría comprada con Favor como gratis en plata)",
  r_silver_per_fp_outlay:
    "{profit} de plata ÷ {fp} de PF desembolsado (trata la cría y los corazones comprados con PF como gratis en plata)",
  r_not_fp_priced: "No tiene precio en PF",
  r_mp_chance_tip: "MP en {city}: {price} × 0,1% de probabilidad de MP = +{gain}/ciclo",
  r_incl_mp: "incl. MP",

  // ── Tirada de artefactos ────────────────────────────────────────────────
  r_sell_badge: "✓ vender",
  r_tip_keep_sell: "QUEDÁRSELO Y VENDER: los ingresos {rev} superan el umbral de repetición {threshold}. Vende este.",
  r_tip_sell_beats_salvage: "VENDER: ingresos {rev} &gt; desguace {salvage}. Vender gana a desguazar.",
  r_tip_reroll: "REPETIR: los ingresos {rev} están por debajo del umbral de caza {threshold}. Desguaza y vuelve a tirar.",
  r_tip_salvage:
    "DESGUAZAR: ingresos {rev} &lt; desguace {salvage}. Rómpelo en fragmentos y véndelos — no repitas, repetir no tiene valor esperado positivo aquí.",
  r_artifacts: "Artefactos",
  r_tip_meld_any:
    "Fusión sin filtro de clase: 36 fragmentos por tirada, cualquier artefacto de Guerrero, Mago o Cazador de ese tipo.",
  r_tip_meld_class:
    "Fusión filtrada a artefactos de {cat}: 50 fragmentos por tirada. Pagas 14 fragmentos extra para reducir el abanico a resultados solo de {cat}.",
  r_tip_campaign_margin:
    "Beneficio esperado ÷ plata esperada gastada en toda la campaña ({rolls} tiradas de media, no una). Este es el retorno honesto de los fragmentos que comprometes.",
  r_tip_profit_per_fragment:
    "Plata que vale cada {frag} POR ENCIMA de su precio de mercado si lo fusionas en vez de venderlo — beneficio de la campaña ÷ los {frags} fragmentos que consume.",
  r_per_meld: "por fusión",
  r_rolls_per_keeper: "{rolls} tiradas / {frags} fragmentos esperados por acierto",

  // ── Transmutación ───────────────────────────────────────────────────────
  r_tip_transmute_fee:
    "Plata fija de transmutación + tarifa de uso de la estación de fabricación (del campo Tarifa de estación)",

  // ── Recolección ─────────────────────────────────────────────────────────
  r_gather_tip_fishing:
    "Pesca (T{tier}) — capturado con {tool}. Se muestra el agua mejor pagada ahora mismo: {fish} ({water}){rare}.",
  r_gather_tip_fishing_ancient:
    "Pesca de las Tierras Ancestrales (T{tier}) — con {tool}, solo dentro de una incursión. El leyfin es toda la captura; la tasa es una estimación (la incursión tiene tiempo limitado).",
  r_gather_tip_seaweed:
    "Subproducto de la pesca — las algas (baratas y pesadas) salen constantemente al pescar; son material de cocina, no un pescado de plato.",
  r_gather_tip_tracking:
    "Rastreo (T{tier}) — cazado con {tool}. Botín principal: Restos de {creature} (cazas la criatura que mejor pague){art}.",
  r_gather_tip_land: "{profession} — recolectado con {tool}{note}.",
  r_gather_rare_folded: "y el mejor raro de {water} incluido (~{pct}% de las capturas)",
  r_gather_artifact_folded:
    "con el mejor Artefacto de Cambiaformas (~{pct}% de las muertes) y el botín de Mercado Negro de presas raras incluidos",
  r_gather_ench_note: "; Plata/kg y Plata/Hora incluyen los drops encantados (.1–.{max})",
  r_saltwater_lower: "agua salada",
  r_biome_lower: "bioma",
  r_no_rare_below_t3: "(sin raro por debajo de T3)",
  r_no_artifact_priced: "(ningún artefacto tiene precio ahora mismo)",
  r_common_fish: "pescado común",
  r_rare_animal: "Animal Raro",
  r_weight_tip_seaweed:
    "Peso real en el juego de las algas (1 kg) — pesadas para un subproducto tan barato, así que su Plata/kg es baja",
  r_weight_tip_fish:
    "Peso real en el juego del pescado común (la captura principal) — el pescado rinde mucho mejor por kg que los recursos minados",
  r_weight_tip_remains:
    "Peso real en el juego de unos Restos de Animal Raro (0,05 kg) — extremadamente ligeros, así que rinden estupendamente por kg",
  r_weight_tip_unit: "Peso de una unidad (0,1 × 1,5^nivel)",
  r_rate_tip_seaweed:
    "Algas estimadas por hora mientras pescas (subproducto frecuente) — ver SEAWEED_UNITS_PER_HOUR en data-gathering.js",
  r_rate_tip_fish:
    "Total estimado de pescado capturado por hora en este nivel (comunes + la parte de raros) — ver FISH_UNITS_PER_HOUR en data-gathering.js",
  r_rate_tip_tracking:
    "Restos de Animal Raro estimados por hora = muertes/hora est. × restos/muerte. Ver TRACK_KILLS_PER_HOUR / TRACK_REMAINS_PER_KILL en data-gathering.js",
  r_rate_tip_land:
    "Unidades en bruto estimadas por hora en este nivel (equipo/especialización decentes, zona del mismo nivel) — ver GATHER_UNITS_PER_HOUR",
  r_perkg_tip_fish:
    "Plata neta total por captura ÷ peso mezclado — eficiencia de carga, con el pescado raro del bioma (más pesado y caro) incluido",
  r_perkg_tip_tracking:
    "Plata neta total por muerte ÷ peso mezclado — eficiencia de carga, con el bono del Artefacto de Cambiaformas (2 kg) incluido",
  r_perkg_tip_land: "Plata neta total por unidad ÷ peso — eficiencia de carga",
  r_perkg_tip_ench: "con los drops encantados (.1–.4) incluidos (mismo peso, más plata)",
  r_perhour_tip_fish:
    "Producción total de pesca: la mejor captura común más el bono de raro del bioma, × pescado/hora estimado. El número de referencia.",
  r_perhour_tip_tracking:
    "Producción total de rastreo: Restos de Animal Raro más el Artefacto de Cambiaformas y el botín de Mercado Negro, × muertes/hora estimadas.",
  r_perhour_tip_land:
    "Producción total: plata neta por unidad{ench} × unidades/hora estimadas. El número de referencia para comparar actividades de recolección.",
  r_incl_ench_bonus: "(incl. el bono de encantado .1–.4)",
  r_bonus_what_fish: "los peces raros del bioma están",
  r_bonus_what_tracking: "el Artefacto de Cambiaformas + el botín de Mercado Negro de presas raras están",
  r_bonus_what_ench: "los drops encantados (.1–.4) están",
  r_baseline_remains: "solo restos",
  r_baseline_common: "solo comunes",
  r_baseline_flat: "plano",
  r_chip_rare: "raro",
  r_chip_loot: "botín",
  r_chip_ench: "enc.",
  r_bonus_mark_tip:
    "Total — {what} ya incluidos en este número (≈+{pct}% sobre los {flat}/h de {baseline}). No hay que sumar nada.",

  // ── Agricultura / trabajadores / diarios ────────────────────────────────
  r_tip_cycle_time: "Duración del ciclo (asume Premium); 24/ciclo = ciclos por día",
  r_tip_profit_per_cycle: "Beneficio por ciclo de cosecha × {outputs} productos",
  r_tip_cycles_per_day: "Extrapolado del ciclo: {cycles} ciclos/día",
  r_farming_alt_bonus: "+10% {city} {profit}",
  r_farming_alt_no_bonus: "{city} {profit}",
  r_tip_farming_alt_bonus:
    "La ciudad con el +10% paga menos aquí, así que la parcela rinde más en {farm}",
  r_tip_farming_alt_no_bonus:
    "El mismo ciclo cultivado fuera de la ciudad con el +10%: la diferencia es lo que vale el bonus",
  r_tip_seed_cost: "Rendimiento <100% — se aplica el coste neto de semilla por cosecha",
  r_seed_cost_applies: "se aplica el coste de semilla",
  r_tip_self_sustaining: "Economía de semillas autosuficiente (rendimiento ≥ 100%)",
  r_self_sustaining: "autosuficiente",
  r_tip_seed_surplus: "Rendimiento >100% — {seeds} semillas por ciclo por encima de la par, vendidas por {silver}",
  r_seed_surplus: "excedente",
  r_tip_seed_surplus_leg: "{seeds} semillas excedentes por ciclo, valen {silver} vendidas aquí",
  r_seeds: "semillas",
  r_animal: "animal",
  r_tip_produce_cycle: "Ciclo de producción: el animal come una vez y entrega sus huevos/leche 22 h después",
  r_tip_pasture_yield: "{feed} × pienso por ciclo → {produce} de producto (Premium lo duplica)",
  r_tip_farm_leg: "Las semillas se traen desde {buy}; la parcela está aquí, así que esta ciudad decide el +10%",
  r_tip_worm_leg: "{worms} lombrices por ciclo, valen {silver} vendidas aquí",
  r_worms: "lombrices",
  r_tip_crop_harvest: "{slots} parcelas × {perSeed} cultivos por semilla = {total} por ciclo (Premium lo duplica)",
  r_tip_animal_capital: "Único: el animal sobrevive a cada recolección, así que es capital, no un coste del ciclo",
  r_tip_pasture_no_focus: "El enfoque no compra más producto — alimentar a un animal adulto no cuesta enfoque. Criar es una jugada sobre una cría, valorada en la tabla de Monturas.",
  r_tip_watering_delta: "el beneficio que un ciclo regado obtiene sobre la misma parcela sin regar",
  r_tip_watering_worthless: "Regar no compra nada apreciable a estos precios",
  r_tip_recoup_fast: "Menos de un ciclo para recuperar el contrato",
  r_tip_recoup_slow: "Recuperar el contrato llevaría {cycles} ciclos",
  r_tip_brecilien_fee_journal: "Tarifa del planificador de viaje de Brecilien por diario lleno",
  r_tip_journal_general:
    "Diario de Trofeo General — se llena con CUALQUIER fama que ganes, así que compite con el diario de profesión por la misma fama.",
  r_tip_journal_trophy:
    "Diario de {profession} — se llena con la fama de esta profesión; un trabajador lo convierte en Trofeo. Necesita más fama que el diario de recursos, pero suele venderse por más.",
  r_tip_journal_resource:
    "Diario de recursos de {profession} — se llena con la fama de esta profesión; un trabajador lo convierte en recursos en bruto.",
  r_tip_silver_per_1k_fame:
    "Plata total por 1.000 de fama base = (venta lleno tras el 6,5% de impuesto − compra vacío) ÷ fama para llenar × 1.000. La fama es la limitación, así que este es el número de referencia.",
  r_tip_fame_to_fill:
    "Fama base necesaria para llenar este diario (maxfame de items.xml). Solo cuenta la fama base — la fama extra de premium no llena diarios.",

  // ── Velocidad de llenado ────────────────────────────────────────────────
  r_to_fill: "para llenar",
  r_tip_fill_speed:
    "Unas {hours} de recolección en T{gather} llenan este diario ({fame} de fama base a ~{rate} de fama/h). El margen ÷ ese tiempo es la plata/hora mostrada.",
  r_tip_fill_out_of_window:
    "Recolectar en T{gather} solo llena diarios de T{lo} a T{gather}, y este queda fuera de esa ventana.",
  r_tip_fill_no_schedule:
    "Este diario no tiene tabla de fama, así que no hay tiempo de llenado que estimar.",
  r_tip_fill_no_rate:
    "No existe una estimación de fama base/hora para la fama que llena este diario.",
  r_selffill_idles: "inactivo {hours}h",
  r_selffill_feeds: "alimenta ×{n}",
  r_tip_selffill:
    "{hours} de recolección en T{gather} llenan este diario T{tier}; el trabajador devuelve {payout} más el diario vacío — {rate} / h de tu tiempo.",
  r_tip_selffill_idle:
    "Más lento que el ciclo de 22h: un trabajador queda inactivo unas {hours}h.",
  r_tip_selffill_feeds:
    "Alimenta a unos {n} trabajadores.",
  r_tip_selffill_no_model:
    "Se llena con fama de combate — sin modelo de llenado, así que no hay tasa.",
  r_tip_selffill_no_craft:
    "Ninguna fabricación del catálogo llena este nivel de diario.",
  r_selffill_crafts: "fabricaciones",
  r_selffill_per_journal: "/ diario",
  r_selffill_per_kfame: "/ 1k fama",
  r_tip_craftfill:
    "{crafts} fabricaciones T{tier} de {item} ({fame} de fama cada una) llenan este diario; el trabajador devuelve {payout} al {yield}% de rendimiento más el diario vacío — {rate} / fabricación.",
  r_tip_craftfill_verdict_beats: "Supera venderlo lleno por {n} / fabricación.",
  r_tip_craftfill_verdict_loses: "Vendido lleno pagaría {n} / fabricación más.",
  r_craftfill_beats_market: "supera venderlo por {n} / fabricación",
  r_craftfill_market_wins: "se vende por {n} / fabricación más",
  r_tip_craftfill_fame_unpriced:
    "Sin margen de diario con precio, no hay nada con que compararlo.",
  r_tip_craftfill_vs_best:
    "Comprarlo lleno indica T{best}.",
  r_jlp_per_journal: "/ diario",
  r_jlp_per_hour: "/ h autollenado",
  r_jlp_no_rate: "sin tasa de llenado a este nivel de recolección",
  r_jlp_laborers: "trabajadores",
  r_jlp_vs_selling: "frente a venderlo lleno",
  r_jlp_sell_unpriced: "diario lleno sin precio",
  r_jlp_laborer: "trabajador",
  r_tip_jlp_per_hour:
    "Unas {hours} de recolección llenan uno, así que {rate} / h bruto.",
  r_tip_jlp_no_data:
    "Todavía no hay precio para nada de lo que devolvería un trabajador con este diario — ejecuta un escaneo.",
  r_tip_jlp_payload:
    "Dado a un trabajador T{laborer}, este diario devuelve {payload} al {yield}% tras 22 h y vuelve vacío — solo se gasta la fama.",
  r_tip_jlp_city:
    "Con precios de {city}.",
  r_tip_jlp_vs_sell:
    "Supera venderlo lleno ({sell}) por {adv}.",
  r_tip_jlp_vs_sell_loses:
    "Vendido lleno deja {sell}, que es {adv} más que dárselo.",
  r_tip_jlp_no_sell:
    "El diario lleno no tiene precio aquí, así que no hay con qué compararlo.",
  r_selffill_journal: "diario",
  r_tip_selffill_city:
    "Con precios de {city}.",
  r_tip_selffill_no_tier:
    "Ningún diario que este trabajador pueda sostener se llena al nivel de recolección de esta fila — un diario se llena desde su nivel hasta dos por encima.",
  r_tip_selffill_no_prices:
    "Todavía no hay precio para lo que devolvería este trabajador — ejecuta un escaneo.",
  r_selffill_per_cycle: "/ ciclo",
  r_selffill_to_fill: "para llenar",
  r_selffill_fame: "de fama",
  r_selffill_per_hour: "/ h",
  r_selffill_per_craft: "/ fabricación",
  r_tip_selffill_verdict_beats: "Supera venderlo lleno por {n} / h.",
  r_tip_selffill_verdict_loses: "Vendido lleno pagaría {n} / h más.",
  r_selffill_beats_market: "supera venderlo por {n} / h",
  r_selffill_market_wins: "se vende por {n} / h más",
  r_tip_selffill_fame_unpriced:
    "Sin margen de diario con precio, no hay nada con que compararlo.",

  // ── Mejor jugada de diario (columna fusionada) ──────────────────────────
  r_play_buy_filled: "comprar lleno",
  r_play_self_fill: "llenarlo tú",
  r_play_buy_filled_long: "comprar el diario lleno",
  r_play_self_fill_long: "llenarlo tú mismo",
  r_play_tip_buy_head: "COMPRAR LLENO:",
  r_play_tip_self_head: "LLENARLO TÚ:",
  r_play_tip_units:
    "Unidades distintas: por ciclo de trabajador frente a por unidad de tu esfuerzo.",
  r_play_tip_no_buy:
    "No hay precio de diario lleno, así que solo la jugada de llenarlo tú tiene cifra.",
  r_tip_best_journal_lower:
    "Un diario T{tier} al {yield}% deja {profit} / ciclo{delta}, frente al {own}% de su propio nivel.",
  r_tip_best_journal_own:
    "El diario T{tier} del propio trabajador ({yield}%) es la mejor compra; ningún nivel inferior deja más.",
  r_tip_leveling_path:
    "{acquire}, sube a T{end} (~{cyc} ciclos ≈ {days} d) y véndelo. Neto de diarios y del {tax}% de impuesto.",
  r_lvl_hire_apprentice: "contrata a un aprendiz T2",
  r_lvl_buy_contract: "compra un contrato T{tier}",
  r_tip_click_sell_city: "clic para cambiar la ciudad de venta",

  // ── Resumen y gráfico ───────────────────────────────────────────────────
  r_tip_best_category:
    "La mejor oportunidad de {category} — la fila de mayor producción (beneficio × volumen diario) de esa tabla. Ir a la abre allí.",
  r_tip_top_profit:
    "Una de las diez jugadas de {category} más rentables del tablero. Ir a la abre en su propia tabla.",
  r_tip_bm_board:
    "Una jugada de {category} que vende en el Mercado Negro. Ir a la abre en su propia tabla.",
  r_tip_top_focus:
    "Uno de los diez mejores usos de {category} para una barra de Concentración. Ir a la abre en su propia tabla.",
  r_tip_focus_math:
    "{profit} de beneficio × {plays} jugadas ({focus} de Concentración cada una)",
  r_jump_to: "Ir a",
  r_tip_board_detail:
    "Muestra la fila propia de esta jugada en su tabla — sus materiales, su cadena y todos los precios que puedes ajustar.",
  r_board_detail_gone:
    "Esta fila ya no está en su tabla — vuelve a escanear, o abre la tabla.",
  r_price_gone: "no está",
  r_price_yours: "tuya",
  r_bm_ladder_bid: "puja",
  r_moving_averages: "Medias móviles",
  r_add_ma: "+ Añadir MM",
  r_chart_lib_failed: "No se pudo cargar la librería del gráfico",
  r_no_gold_data: "Sin datos de oro — haz clic en Recargar",
  r_gold_price: "Precio del oro",

  r_gold_candles_status: "{n} velas · desde {date} · {region}",
  r_fetching_gold: "Obteniendo precios del oro…",
  r_no_gold_for_region: "No se han devuelto datos de oro para esta región",
  r_gold_load_failed: "No se pudieron cargar los datos de oro",

  // ── Panel de especialización ────────────────────────────────────────────
  r_close: "Cerrar",
  r_filter_nodes: "Filtrar nodos… p. ej. espada",
  r_set_all: "Fijar todo",
  r_all_max: "Todo a 100 (máx.)",
  r_all_max_tip: "Pone todos los nodos a 100 — la rama entera al máximo.",
  r_reset_defaults: "Restablecer",
  r_reset_defaults_tip: "Vuelve a los valores por defecto: maestrías a 100 y todas las especializaciones a 0 — el punto de partida para escribir solo los niveles que tienes de verdad.",
  r_spec_foot: "Un nodo que no hayas escrito cuenta como 0 — 100 solo para la maestría que encabeza cada grupo. Los niveles bajos cuestan más enfoque: coste = base × 0,5 ^ (Σ bonus × 100 × nivel ÷ 10.000).",
  r_spec_nodes_set: "{set} ajustados · {max} por defecto",
  r_spec_all_max: "nada escrito — maestrías 100, especializaciones 0",

  r_note_chest_tomes: "de los tomos (2× Gran Maestro + 1× Maestro, valorados frente al Tomo de Perspicacia de Adepto).",
  r_note_override_yield: "Ajusta la plata esperada haciendo clic en el precio (clic derecho)",
  r_tip_click_override: "Haz clic para ajustar",
  r_tip_roll_cost: "{count} × {frag} a {price} + {fee}% de tarifa de orden de compra = una fusión. Volver a tirar cuesta lo mismo otra vez, menos los 10 fragmentos que recuperas al desguazar.",
  r_tip_roll_cost_transmute: "{count} × {frag} a {unit} con todo incluido = una fusión, a partir de {buy} transmutado. Tarifa del {fee}% solo sobre lo comprado; desguazar devuelve 10.",
  r_tip_artifact_token_substitute: "Los artesanos pueden llenar el hueco de {art} con {token}: misma fabricación, misma concentración, más barato. Limita el precio de este artefacto.",
  r_tip_frag_transmute: "{count}× {frag} = {total}× {start} comprados y luego transmutados: {steps}. {cost} por {frag} con todo incluido (tarifa de compra solo sobre la parte comprada).",

  r_crafts: "fabricaciones",
  r_units: "unidades",
  r_refines: "refinados",
  r_p10k_breed_tip: "Beneficio extra solo por la concentración (tras coste de materiales): +{gain} por cría nutrida (+{pct}% de crías) × {babies} crías ({focus} de concentración c/u)",
  r_p10k_breed_self: "cría propia",
  r_p10k_breed_self_tip: "Crías propias: ganancia solo por la concentración +{gain} por cría nutrida (+{pct}% de crías) × {babies} crías ({focus} de concentración c/u)",
  r_p10k_breed_gathered: "recolectado",
  r_p10k_gathered: "recolectado",
  r_p10k_gathered_tip: "Misma barra con los materiales recolectables recolectados por ti (coste 0); tasas, viajes y otros insumos se pagan: {profit} de beneficio c/u",
  r_p10k_breed_gathered_tip: "Crías compradas, cuero y alimento recolectados: ganancia solo por la concentración +{gain} por cría nutrida (+{pct}% de crías) × {babies} crías ({focus} c/u)",
  r_selffound: "auto-obtenido",
  r_selffound_tip: "Misma fabricación con materiales auto-obtenidos (recursos a coste cero, tasas y tarifas mantenidas): venta × (1 − impuesto) − costes mantenidos = {value}",
  r_cl_row_selffound_tip: "El mismo plan con materiales auto-obtenidos (recursos a coste cero, tasas y tarifas mantenidas): {qty} × {unit} = {value}",
  r_fp_focus_baby_tip: "Cría gratis (comprada con PF): {profit} de beneficio/ciclo de cría × {cycles} ciclos ({focus} de concentración de nutrición c/u)",

  // ── Estaciones de fabricación (filtro de la tabla) ──────────────────────
  station_warriors_forge: "Forja del Guerrero",
  station_hunters_lodge: "Cabaña del Cazador",
  station_mages_tower: "Torre del Mago",
  station_toolmaker: "Fabricante de herramientas",
  station_alchemists_lab: "Laboratorio del Alquimista",
  station_cook: "Cocina",
  station_mill: "Molino",
  station_butcher: "Carnicería",
  station_saddler: "Guarnicionero",
  station_artifact_foundry: "Fundición de Artefactos",
  station_energy_manipulator: "Manipulador de Energía",

  // ── Estaciones y pasos de cadena ────────────────────────────────────────
  r_station_butcher: "carnicería",
  r_station_mill: "molino",
  r_station_alchemist: "alquimista",
  r_station_cook: "cocina",
  r_batches: "lotes",
  r_output_ea: "producto c/u",
  r_feed: "comida",
  r_transmute_lower: "transmutar",

  // ── Estados vacíos, botones y etiquetas sueltas ─────────────────────────
  r_no_profitable_loops: "No hay bucles rentables ahora mismo.",
  r_no_items_match_filter: "Ningún objeto coincide con el filtro.",
  r_caerleon_bm_routes: "Rutas de Caerleon y Mercado Negro",
  r_scanning: "Escaneando…",
  r_stop_monitor: "■ Detener monitor",
  r_ench_filter: "Enc.",
  r_tame: "Domesticado",
  r_full: "Lleno",
  r_empty: "Vacío",
  r_trophy_journal: "Diario de trofeo",

  // ── Etiquetas de datos: profesiones, herramientas, criaturas, comida ────
  prof_mining: "Minería",
  prof_lumberjacking: "Tala",
  prof_skinning: "Despellejado",
  prof_harvesting: "Cosecha",
  prof_quarrying: "Cantería",
  prof_fishing: "Pesca",
  prof_ancient_lands_fishing: "Pesca de las Tierras Ancestrales",
  prof_tracking: "Rastreo",
  prof_gathering: "Recolección",
  tool_pickaxe: "un pico",
  tool_wood_axe: "un hacha de leñador",
  tool_skinning_knife: "un cuchillo de despellejar",
  tool_sickle: "una hoz",
  tool_stone_hammer: "un martillo de piedra",
  tool_fishing_rod: "una caña de pescar",
  tool_tracking_toolkit: "un kit de rastreo",
  tool_gathering_tool: "una herramienta de recolección",
  water_saltwater: "Agua salada",
  water_freshwater: "Agua dulce",
  creature_panther: "Pantera",
  creature_werewolf: "Hombre lobo",
  creature_hellfire_imp: "Diablillo infernal",
  creature_stone_golem: "Gólem de piedra",
  creature_dawnbird: "Ave del alba",
  food_crops_herbs: "Cultivos/Hierbas",
  food_meat: "Carne",
  food_chocolate: "Chocolate",
  food_mounts: "Monturas",

  // ── Tipos de fragmento y filtros de clase (tirada) ──────────────────────
  roll_rune: "Runa",
  roll_soul: "Alma",
  roll_relic: "Reliquia",
  roll_avalonian: "Avaloniano",
  roll_any: "Cualquiera",
  roll_warrior: "Guerrero",
  roll_mage: "Mago",
  roll_hunter: "Cazador",

  // ── Categorías (gasto de facción/Favor y resumen) ───────────────────────
  cat_heart: "Corazón",
  cat_iron_chest: "Cofre de hierro",
  cat_baby_t5: "Cría T5",
  cat_baby_t8: "Cría T8",
  cat_conqueror_s_chest: "Cofre del Conquistador",
  cat_siphoned_energy: "Energía Sifonada",
  cat_avalonian_shard: "Fragmento Avaloniano",
  cat_tome: "Tomo",
  cat_antiquarian_baby: "Cría del Anticuario",
  cat_faerie_fire: "Fuego Feérico",
  cat_mystic_owl_baby: "Cría de Búho Místico",
  cat_energy_mount: "Montura de energía",
  cat_avalonian_crest: "Blasón Avaloniano",
  cat_smuggler_crest: "Blasón de Contrabandista",
  cat_demon_crest: "Blasón de Demonio",
  cat_brecilien_crest: "Blasón de Brecilien",
  cat_cape_t4: "Capa T4",
  cat_cape_t5: "Capa T5",
  cat_cape_t6: "Capa T6",
  cat_cape_t7: "Capa T7",
  cat_cape_t8: "Capa T8",
  cat_avalonian_cape: "Capa Avaloniana",
  cat_smuggler_cape: "Capa de Contrabandista",
  cat_demon_cape: "Capa de Demonio",
  cat_brecilien_cape: "Capa de Brecilien",
  cat_flipping: "Reventa",
  cat_crafting: "Fabricación",
  cat_transport_refining: "Transporte / Refinado",
  cat_consumables: "Consumibles",
  cat_breeding_mounts: "Cría y monturas",
  cat_farming: "Agricultura",
  cat_enchanting: "Encantamiento",
  cat_transmute: "Transmutación",
  cat_quality_rerolling: "Recalibrado de calidad",
  cat_artifact_rolling: "Tirada de artefactos",
  cat_faction_spending: "Gasto de facción",
  cat_laborers: "Trabajadores",

  // ── Etiquetas de la tabla de tarifas de Brecilien ───────────────────────
  bf_relic: "Reliquia",
  bf_soul: "Alma",
  bf_rune: "Runa",
  bf_avalonian_shard: "Fragmento Avaloniano",
  bf_crystal_shard: "Fragmento de Cristal",
  bf_fire_dragon_scales: "Escamas de Dragón de Fuego",
  bf_essence: "Esencia",
  bf_essence_potion: "Poción de esencia",
  bf_avalonian_energy: "Energía Avaloniana",
  bf_siphoned_energy: "Energía Sifonada",
  bf_plain_0: "Normal (.0)",
  bf_uncommon_1: "Poco común (.1)",
  bf_rare_2: "Raro (.2)",
  bf_exceptional_3: "Excepcional (.3)",
  bf_pristine_4: "Prístino (.4)",
  bf_resources_raw_refined_same_fee_scales_with_enchant:
    "Recursos — en bruto y refinados (misma tarifa; escala con el encantamiento)",
  bf_artifact_materials_special_tokens: "Materiales de artefacto y fichas especiales",

  // Mi Lista de Fabricación (columna "+" y panel de la lista)
  r_cl_add_to_list: "Añadir a Mi Lista de Fabricación",
  r_cl_remove_from_list: "En Mi Lista de Fabricación — haz clic para quitarla",
  r_cl_qty: "Cant.",
  r_cl_qty_tip: "Cuántas veces piensas ejecutar esta fila",
  r_cl_row: "Fila",
  r_cl_row_total: "Beneficio total",
  r_cl_row_unpriced: "Sin precio todavía — escanea {table} para rellenar esta fila.",
  r_cl_row_computing: "Calculando… esta fila se rellenará cuando termine {table}.",
  r_cl_empty: 'Nada en la lista todavía — haz clic en el "+" de cualquier fila para añadirla.',
  r_cl_no_materials: "Todavía no hay materiales comprables en la lista.",
  r_cl_total_to_buy: "Total a comprar",
  r_cl_total_cost_tip: "Plata gastada en insumos",
  r_cl_focus_days: "≈{days} días a 10.000/día",
  r_cl_qty_zero_tip: "0 mantiene la fila sin contarla",
  r_cl_qty_expr_tip: "escribe una suma como 96+96 y pulsa Enter",
  r_cl_qty_10k_tip: "Fija la cantidad que compra una barra de 10.000 de enfoque",
  r_cl_qty_10k_spend: "{qty} × {cost} de enfoque = {spend}",
  r_cl_qty_10k_days: "enfoque por día, durante {days} días",
  r_cl_row_cost_tip: "Cantidad × lo que cuesta comprar una unidad — la misma plata que suma el pie de tabla",
  r_cl_row_fp_tip: "Puntos de Facción que necesita esta cantidad: Cantidad × los PF que cuesta una unidad",
  r_cl_total_fp_tip: "Puntos de Facción que gastan las cantidades planificadas",
  r_fp: "PF",
  r_favor: "Favor",
  r_cl_row_favor_tip: "Favor que necesita esta cantidad en el Manipulador de Energía: Cantidad × el Favor que cuesta una unidad",
  r_cl_total_favor_tip: "Favor que gastan las cantidades planificadas en el Manipulador de Energía",
  r_cl_qty_th_tip: "Cuántas veces ejecuta el plan esta fila. 0 aparca la fila: sigue con precios, pero no cuenta en ningún sitio.",
  r_cl_cost_th_tip: "Cant. × lo que cuesta comprar una unidad. Las unidades que el presupuesto de Concentración no cubre cuestan más: la tasa de retorno base compra más materiales.",
  r_cl_total_th_tip: "Cant. × beneficio por unidad. Las unidades con Concentración usan el beneficio con Concentración; el resto, la tasa de retorno base.",
  r_cl_p10k_th_tip: "En esta lista: el Beneficio total de la fila más una barra más de 10.000 de Concentración. Filas de cría: solo la ganancia de la concentración en una barra.",
  r_cl_p10k_combined_tip: "Beneficio total {total} + una barra completa de 10.000 de Concentración {p10k}",
  r_cl_p10k_parked_tip: "Una barra completa de 10.000 de Concentración. Esta fila está aparcada en 0, así que no aporta beneficio planificado.",
  r_cl_p10k_self_tip: "El mismo plan con todas las crías propias (sin coste de compra de la cría) más una barra de 10.000 de Concentración en crías propias: {value}",
  r_cl_p10k_gathered_tip: "El mismo plan con los materiales recolectables recolectados por ti (coste 0) más una barra de 10.000 de Concentración igual: {value}",
  r_cl_focus_budget_tip: "Puntos de enfoque que este plan puede gastar. Con Premium se regeneran unos 10.000 al día y la reserva llega a 30.000.",
  r_cl_focus_per_day: "enfoque/día",
  r_cl_focus_per_day_tip: "Solo se puede nutrir una vez cada 24 h, así que esta lista gasta el enfoque en cuotas diarias; la más larga dura {days} días.",
  r_cl_focus_unfunded: "{focus} sin enfoque",
  r_cl_focus_unfunded_tip: "Enfoque que el presupuesto no cubre. Esas unidades se calculan con la tasa de retorno base: compran más materiales y ganan menos.",
  r_cl_total_revenue_tip: "Valor bruto de venta antes de impuestos",
  r_cl_total_profit_shared_tip: "Cada fila se valora con todo el presupuesto de foco; este total reparte un único presupuesto entre todas las filas.",
  r_cl_confirm_clear: "¿Vaciar Mi Lista de Fabricación?",
  r_cl_net_of_rrr: "descontada la tasa de retorno de recursos",
  r_cl_refined_by_you: "refinado por ti",
  r_cl_cost: "coste",
  r_cl_revenue: "ingresos",
  r_cl_profit: "beneficio",
  r_cl_with_laborers: "con trabajadores",
  r_cl_laborers_unit: "trabajadores",
  r_cl_laborers_needed_tip: "Un trabajador trabaja un diario por ciclo de 22 h. Escribe cuántos trabajadores tienes y las cantidades se ajustan.",
  r_cl_total_laborer_tip: "La misma cesta, pero cada fila de fabricación entrega su diario a un trabajador en vez de venderlo — las dos jugadas son excluyentes",
};
if (typeof module !== "undefined" && module.exports)
  module.exports = { UI_STRINGS_ES_ROWS };
