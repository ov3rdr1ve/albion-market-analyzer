// Spanish (ES-ES) UI-chrome strings, keyed by the same slugs as the generated
// js/i18n-strings-en.js. Intentionally PARTIAL: any slug absent here falls back
// to English via t() (js/i18n.js). Terminology follows Albion Online's official
// ES-ES client (Concentración = Focus, Plata = Silver, Aspectos = Skins…).
//
// Covered: every slug the generated EN table carries (section titles, column
// headers, buttons, placeholders, labels AND the long help tooltips), plus the
// runtime slugs render-*.js passes to tx(). Part 2 of the table, for the newer
// panels and runtime strings, lives in js/i18n-strings-es-extra.js and is
// merged in at the bottom of this file.
const UI_STRINGS_ES = {
  // ── Global header / controls ────────────────────────────────────────────
  server: "Servidor:",
  language: "Idioma:",
  show_all: "Mostrar todo",
  fetching_data: "Obteniendo datos…",
  last_scan: "Último escaneo:",
  pricing_model: "Modelo de precios:",
  buy_leg: "Compra:",
  buy_instant: "Instantáneo",
  buy_market_order: "Orden de mercado",
  sell_leg: "Venta:",
  sell_instant: "Instantáneo",
  sell_market_order: "Orden de mercado",
  include_caerleon: "Incluir Caerleon y Guarida de Contrabandistas",
  use_focus: "Usar Concentración (Fabricar/Refinar/Criar)",
  premium_account: "Cuenta Premium (4% imp., si no 8%)",
  all_specs_label: "Todas las especializaciones:",
  spec_action_none: "—",
  spec_action_zero: "Poner todo a 0",
  spec_action_max: "Poner todo a 100 (máx.)",
  spec_action_reset: "Restablecer (recuperar mis niveles)",
  zoom_label: "Zoom:",
  scales_the_whole_app_ctrl_shortcuts: "Escala toda la aplicación. Ctrl+= / Ctrl+- / Ctrl+0 hacen lo mismo.",
  scan_market_now: "Escanear mercado",
  collapse_all: "⊟ Contraer todo",
  expand_all: "⊞ Expandir todo",
  clear_overrides: "✗ Borrar ajustes",
  export_overrides: "↑ Exportar configuración",
  import_overrides: "↓ Importar configuración",

  // ── Group headers (section bands) ───────────────────────────────────────
  group_market: "Mercado y comercio",
  group_market_sub: "Precios en vivo, reventa, tarifas y volumen negociado",
  group_crafting: "Fabricación y refinado",
  group_crafting_sub: "Convertir materiales en objetos vendibles",
  group_upgrades: "Mejoras de objetos",
  group_upgrades_sub: "Encantamiento, transmutación y relanzar calidad",
  group_production: "Recolección y producción",
  group_production_sub: "Cosecha, granjas, animales, obreros y diarios",
  group_faction: "Guerra de facciones",
  group_faction_sub: "Gastar Puntos de Facción y Favor",
  group_roads: "Caminos de Avalon",
  group_roads_sub: "Portales mapeados y directorio de zonas",
  group_reference: "Referencia",
  group_reference_sub: "Tablas fijas de bonificaciones — sin escaneo de mercado",

  // ── Section titles (h2) ─────────────────────────────────────────────────
  fees_calculator: "Calculadora de tarifas",
  top_opportunity_best_of_each_category:
    "Mejor oportunidad (lo mejor de cada categoría)",
  top_10_pure_profit: "Top 10 Beneficio puro",
  black_market_opportunities: "Oportunidades del Mercado Negro",
  bm_bid: "Puja del Mercado Negro",
  bid_age: "Antigüedad de la puja",
  buy_city: "Ciudad de compra",
  top_10_profit_10k_focus: "Top 10 Beneficio / 10k Conc.",
  artifact_rolling: "Tirada de artefactos",
  crafting_w_focus: "Fabricación (con Concentración)",
  // Swapped in by updateFocusHeading (js/app.js) when focus is off. Not in the
  // generated EN table — the slug lives in JS, not in index.html — so app.js
  // carries the English literal and this is the ES side of it.
  crafting_no_focus: "Fabricación (sin Concentración)",
  specialization: "Especialización",
  specs: "⚙ Especialización",
  crafting_planner_refine_craft_journal_one_be:
    "Planificador de fabricación (Refinar ▸ Fabricar ▸ Diario, mejor paso de Concentración)",
  flipping_all_cities: "Reventa (todas las ciudades)",
  skins_trading_tradeable_vanity:
    "Comercio de aspectos (aspectos comerciables)",
  refining_transports_all_cities: "Refinado / Transportes (todas las ciudades)",
  laborers_all_modes: "Trabajadores (todos los modos)",
  general_trophies_label: "Trofeos generales: +",
  matching_trophies_label: "Trofeos del tipo: +",
  happiness_from_general_trophies_5_each_the_o:
    "Trofeos generales (cualquier trabajador), 5 cada uno; 40 = los 8 colocados. Los únicos que acepta un artesano, por eso topan al 120% en su propio nivel. Cada punto = +0,5% de rendimiento.",
  happiness_from_trophies_of_the_laborer_s_own:
    "Trofeos del propio tipo (madera, mineral, piel, pesca…), 10 cada uno; 70 = T2-T8 colocados. Los artesanos no tienen ninguno, así que esta casilla no les afecta.",
  house_tier_label: "Casa:",
  the_house_your_laborers_live_in_a_building_h:
    "La casa donde viven tus trabajadores. Un edificio solo admite mobiliario de su propio nivel o inferior, así que una casa T6 no tiene ningún trofeo T7 ni T8 que colocar: las dos casillas de arriba quedan limitadas por ella.",
  the_house_you_own_a_building_holds_furniture:
    "La casa que posees. Un edificio solo admite mobiliario de su propio nivel o inferior, así que el mobiliario por encima de este nivel se oculta: podrías fabricarlo, pero no colocarlo.",
  consumables_all_cities: "Consumibles (todas las ciudades)",
  breeding_mounts: "Cría y monturas",
  faction_point_calculator_fp_hearts_crests:
    "Calculadora de Puntos de Facción (PF → corazones y blasones)",
  faction_spending_fp_favor_silver:
    "Gasto de facción (PF / Favor → Plata)",
  enchanting: "Encantamiento",
  transmute: "Transmutar",
  quality_rerolling: "Recalibrado de calidad",
  farming: "Agricultura",
  gathering_most_profitable_to_harvest:
    "Recolección (lo más rentable de recolectar)",
  journal_filling_best_tier_type_to_fill:
    "Llenado de diarios (mejor nivel y tipo para llenar)",
  city_bonuses_reference: "Bonos de ciudad (referencia)",
  brecilien_travel_planner_fees_out_of_brecili:
    "Tarifas del planificador de viaje de Brecilien (salida de Brecilien)",
  highest_trade_volume_top_items:
    "Mayor volumen de comercio (objetos destacados)",

  // ── Scan buttons ────────────────────────────────────────────────────────
  scan_rolling: "Escanear tiradas",
  scan_crafting: "Escanear fabricación",
  scan_planner: "Escanear planificador",
  scan_flipping: "Escanear reventa",
  scan_black_market: "Escanear mercado negro",
  scan_skins: "Escanear aspectos",
  scan_transport: "Escanear transporte",
  scan_consumables: "Escanear consumibles",
  scan_mounts: "Escanear monturas",
  scan_faction_spending: "Escanear gasto de facción",
  scan_enchanting: "Escanear encantamiento",
  scan_transmute: "Escanear transmutación",
  scan_rerolling: "Escanear recalibrado",
  scan_farming: "Escanear agricultura",
  scan_gathering: "Escanear recolección",
  scan_journals: "Escanear diarios",
  scan_laborers: "Escanear trabajadores",
  refresh_volume: "Actualizar volumen",
  save_row: "+ Guardar fila",
  clear_all: "Borrar todo",
  clear_form: "Borrar formulario",

  // ── Column headers ──────────────────────────────────────────────────────
  item: "Objeto",
  item_code: "Código de objeto",
  item_note: "Objeto / Nota",
  item_route: "Objeto / Ruta",
  route: "Ruta",
  route_all_cities: "Ruta (todas las ciudades)",
  route_buy_filled_run_sell: "Ruta (comprar lleno → llevar/vender)",
  route_buy_mats_sell_gear: "Ruta (comprar mats → vender equipo)",
  route_buy_mats_sell_gear_2: "Ruta (comprar mats → vender equipo)",
  route_buy_sell: "Ruta (comprar → vender)",
  route_craft_buy_sell: "Ruta (fabricar/comprar → vender)",
  city: "Ciudad",
  city_route: "Ciudad / Ruta",
  best_city: "Mejor ciudad",
  bonus_city: "Ciudad con bono",
  top_city: "Mejor ciudad",
  price_top_city: "Precio (mejor ciudad)",
  top_city_volume: "Volumen mejor ciudad",
  total_volume_all_cities: "Volumen total (todas las ciudades)",
  category: "Categoría",
  type: "Tipo",
  tier: "Nivel",
  station: "Estación",
  weight: "Peso",
  qty: "Cant.",
  slot: "Ranura",
  mode: "Modo",
  cycle: "Ciclo",
  output: "Producto",
  throughput: "Producción",
  pipeline: "Cadena",
  ingredients: "Ingredientes",
  materials: "Materiales",
  materials_refine_vs_buy: "Materiales (refinar ▲ vs comprar)",
  required_materials: "Materiales necesarios",
  enchant_mats: "Mats de encantamiento",
  resource: "Recurso",
  refined: "Refinado",
  consumable: "Consumible",
  laborer: "Trabajador",
  journal: "Diario",
  journal_fill: "Llenado de diario",
  best_journal: "Mejor diario",
  best_journal_est: "Mejor diario (est.)",
  best_journal_play: "Mejor jugada de diario",
  fame_to_fill: "Fama para llenar",
  silver_1k_fame: "Plata / 1k Fama",
  fill_speed_max_profit: "Velocidad de llenado / Beneficio máx.",
  feed_a_laborer: "Dárselo a un trabajador",
  self_fill_cycle: "Autollenado / ciclo",
  self_fill_rate: "Tasa de autollenado",
  daily_bonus_clear_label: "Limpiar este grupo",
  daily_production_bonus_label: "Bono de producción diaria:",
  daily_bonus_group_placeholder: "Escribe para filtrar…",
  daily_production_bonus_desc: "Las estaciones rotan a diario un bono de producción del 10% o 20% sobre hasta dos grupos de objetos. Elige los que ofrezca tu estación: cada uno sube la devolución de materiales solo en sus filas de crafteo, refinado o despiece.",
  match_journal_tier: "Igualar el nivel del diario",
  skin: "Aspecto",
  transition: "Transición",
  quality_transition: "Transición de calidad",
  roll_type_artifact: "Tipo de tirada / Artefacto",

  // prices / money
  buy: "Comprar",
  sell: "Vender",
  best_buy: "Mejor compra",
  best_sell: "Mejor venta",
  best_sell_price: "Mejor precio de venta",
  buy_price: "Precio de compra",
  sell_price: "Precio de venta",
  buy_cost: "Coste de compra",
  buy_contract: "Contrato de compra",
  raw_cost: "Coste en bruto",
  silver_cost: "Coste en plata",
  favor_cost: "Coste en Favor",
  fp_cost: "Coste en PF",
  cost: "Coste",
  input_cost: "Coste de insumos",
  total_input: "Insumos totales",
  total_input_cost: "Coste total de insumos",
  reroll_cost: "Coste de recalibrado",
  reroll_ev: "VE de recalibrado",
  roll_cost: "Coste de tirada",
  filled_cost: "Coste lleno",
  empty_buy: "Compra vacío",
  empty_sell: "Venta vacío",
  full_sell: "Venta lleno",
  fragment_buy: "Fragmento — Comprar",
  source_buy: "Fuente — Comprar",
  artifact_sell_price: "Precio de venta de artefacto",
  breakeven_buy_t8: "Equilibrio (comprar T8)",
  breakeven: "Equilibrio",
  sell_revenue: "Ingresos por venta",
  net_revenue: "Ingresos netos",
  sell_yield: "Venta / Rendimiento",
  sell_unit: "Venta / Unidad",
  sell_vol: "Vol. venta",
  sell_vol_24h: "Vol. venta (24h)",
  daily_vol: "Vol. diario",
  vol: "Vol.",
  vol_24h: "Vol./24h",

  // profit / margins
  profit: "Beneficio %",
  profit_2: "Beneficio",
  margin: "Margen",
  margin_2: "Margen %",
  pure_profit: "Beneficio puro",
  net_profit: "Beneficio neto",
  net_silver: "Plata neta",
  net_unit: "Neto / Unidad",
  profit_craft: "Beneficio / Fabricación",
  profit_cycle: "Beneficio / Ciclo",
  profit_of_one_harvest_cycle_at_the_chosen_fa:
    "Beneficio de un ciclo de cosecha en la ciudad de cultivo elegida. La línea dos es el mismo ciclo al otro lado del bonus del +10%; la diferencia es lo que vale el bonus. Se ordena por la línea uno.",
  profit_day: "Beneficio / Día",
  r_cl_perday: "/día",
  r_cl_floss_nurture: "Cría solo {n} crías",
  r_cl_floss_nurture_one: "Cría solo {n} cría",
  r_cl_floss_craft: "Enfoca solo {n}",
  r_cl_floss_tail: "las sin enfoque dan pérdida",
  r_cl_floss_tip: "Fijar cantidad en {n}",
  r_cl_perday_tip: "Beneficio total / (horas de crecimiento / 24) = {total} / ({hours}h / 24). Incluye la cantidad; el crecimiento sigue a Premium.",
  profit_cycle_extrapolated_over_24h_the_secon:
    "Beneficio / Ciclo extrapolado a 24 h. La línea dos es el mismo ciclo al otro lado del bonus del +10%. Se ordena por la línea uno.",
  profit_ox: "Beneficio / Buey",
  payload_cycle: "Carga / Ciclo",
  yield_cycle: "Rendimiento / Ciclo",
  ev_w_nurture: "VE con crianza",
  best_leveling_path: "Mejor ruta de nivelación",
  best_focus: "Mejor Concentración",
  seed_baby: "Semilla / Cría",

  // focus metrics
  focus_cost: "Coste de Concentración",
  "10k_focus_mats": "Mats de 10k Concentración",
  "profit_10k_focus": "Beneficio / 10k Conc.",
  "profit_gathered_10k_focus": "Beneficio Recolectado / 10k Conc.",
  mats_10k_focus: "Mats / 10k Concentración",
  mats_to_buy_10k_focus: "Mats a comprar (10k Concentración)",
  seeds_to_plant_10k_focus: "Semillas a plantar (10k Concentración)",
  vol_sort: "vol",
  sort_by_the_24h_sell_volume_at_each_row_s_sell: "Ordenar por el volumen de venta de 24h en la ciudad de venta de cada fila.",
  seeds_a_full_10_000_focus_bar_plants_the_who: "Semillas que planta una barra de 10.000 de foco (9 ranuras por ciclo). Línea dos: semillas a comprar con el retorno que da Usar Foco — regada se resiembra, sin riego no.",
  silver_focus: "Plata/Concentración",
  silver_focus_2: "Plata / Concentración",
  sil_focus: "Plata/Conc.",

  // per-unit rates
  silver_hour_est: "Plata / Hora (est.)",
  silver_kg: "Plata / kg",
  units_h_est: "Unidades / h (est.)",
  jump: "Salto",

  // faction S/FP rates (keep abbreviations)
  s_favor: "P/Favor",
  s_fp_bred: "P/PF (criado)",
  s_fp_breed: "P/PF (criar)",
  s_fp_direct: "P/PF (directo)",
  s_fp_raw: "P/PF (bruto)",

  // city-bonus labels
  butcher_10_pb: "Carnicero (+10 PB)",
  crafting_15: "Fabricación (+15%)",
  refining_40: "Refinado (+40%)",
  farm_byproducts_10: "Subproductos de granja (+10%)",
  farm_crops_10: "Cultivos de granja (+10%)",
  farm_herbs_10: "Hierbas de granja (+10%)",
  base: "Base",

  // tier abbreviations stay as-is (T4…T8); city abbreviations stay as-is
  // (Caer, Mart, Thet, Brec, Lym, Bdg, FtSt).

  // ── Placeholders (search filters) ───────────────────────────────────────
  filter_e_g_baby: "Filtrar… p.ej. cría",
  filter_e_g_bag: "Filtrar… p.ej. bolsa",
  filter_e_g_cape_skeleton_gladiator:
    "Filtrar… p.ej. capa, esqueleto, gladiador",
  filter_e_g_carrot: "Filtrar… p.ej. zanahoria",
  filter_e_g_crafting: "Filtrar… p.ej. fabricación",
  filter_e_g_fish_rare_ore: "Filtrar… p.ej. pez, raro, mineral",
  filter_e_g_leather: "Filtrar… p.ej. cuero",
  filter_e_g_martlock: "Filtrar… p.ej. martlock",
  filter_e_g_mercenary: "Filtrar… p.ej. mercenario",
  filter_e_g_ore: "Filtrar… p.ej. mineral",
  filter_e_g_ore_trophy_t8: "Filtrar… p.ej. mineral, trofeo, T8",
  filter_e_g_ox: "Filtrar… p.ej. buey",
  filter_e_g_planks: "Filtrar… p.ej. tablones",
  filter_e_g_relic: "Filtrar… p.ej. reliquia",
  filter_e_g_t4_2_planks: "Filtrar… p.ej. T4.2 tablones",
  filter_e_g_t5: "Filtrar… p.ej. t5",
  filter_e_g_t6: "Filtrar… p.ej. t6",
  filter_e_g_t6_bag: "Filtrar… p.ej. t6 bolsa",
  filter_e_g_t6_stew: "Filtrar… p.ej. t6 estofado",
  filter_e_g_table_plate_t8: "Filtrar… p.ej. mesa, placa, T8",
  e_g_5000: "p.ej. 5000",
  e_g_6500: "p.ej. 6500",
  e_g_martlock_caerleon: "p.ej. Martlock → Caerleon",
  e_g_t6_bag: "p.ej. bolsa T6",

  // ── Fees Calculator form + misc static labels ───────────────────────────
  fc_intro:
    "Introduce precio de compra / venta + cantidad para ver la plata neta tras las tarifas de mercado de Albion",
  quantity: "Cantidad",
  fc_instant: "Instantáneo",
  fc_market_order: "Orden de mercado",
  fc_premium_label: "Premium (4% imp., si no 8%)",
  total_buy_cost: "Coste total de compra",
  net_sell_revenue: "Ingresos netos de venta",
  fc_per_item: "por objeto",
  fc_margin: "margen",
  saved_trades: "Operaciones guardadas",
  unlock_tokens: "fichas de desbloqueo",
  per_100_nutrition: "/100 nutrición",
  all_factions: "Todas las facciones",
  all_transitions: "Todas las transiciones",
  loading: "Cargando…",
  loading_catalogs: "Cargando catálogos…",
  run_scan_to_populate:
    'Pulsa "Escanear mercado" para llenar las mejores oportunidades.',
  top_opp_subtitle:
    "Autocalculado de cada tabla escaneada — ordenado por Beneficio puro × Volumen diario",
  bm_board_subtitle:
    "Todas las jugadas rentables que TERMINAN en el Mercado Negro, de todas las tablas escaneadas — con la antigüedad de la puja en la que se apoya cada una",
  re_read_the_black_market_bids_this_board_lea:
    "Vuelve a leer las pujas del Mercado Negro en las que se apoya este tablero y lo reconstruye. Recurre a un escaneo completo del mercado si aún no se han obtenido precios.",
  bm_bid_age_title:
    "Hace cuánto se leyó esa puja — un número del Mercado Negro que el libro ya no tiene lo dice aquí",
  top_profit_subtitle:
    "Los diez mayores beneficios en plata de todas las tablas escaneadas — una jugada cada uno",
  top_focus_subtitle:
    "Los diez mejores usos de una barra de Concentración — Fabricación, Refinado, Consumibles, Agricultura y Monturas, las cinco tablas que gastan Concentración",
  profit_per_play_the_plays_one_10_000_focus_b:
    "Beneficio por jugada (tras coste de materiales) × las jugadas que compra una barra de 10 000 de Concentración",
  tome_t4: "T4 — Iniciado",
  tome_t5: "T5 — Experto",
  tome_t6: "T6 — Maestro",
  tome_t7: "T7 — Gran maestro",
  tome_t8: "T8 — Anciano",
  skins_desc:
    "Fichas de desbloqueo de vestuario comerciables — la única forma comerciable de aspectos; los aplicados están vinculados a la cuenta. Mejor compra = ciudad más barata, Mejor venta = más cara.",
  gathering_desc:
    "Una fila por actividad × nivel (T2–T8). Plata/kg y Plata/Hora son totales: los drops encantados, los peces raros del bioma y el botín de rastreo van integrados en el número.",
  journal_desc:
    "Compra un diario vacío, llénalo con fama que ganarías igualmente y véndelo lleno. Beneficio = venta en lleno (tras 6,5% de impuesto) − compra en vacío; ordenado por Plata / 1k Fama.",
  brecilien_desc:
    "Tarifa por unidad del Planificador de Viaje para sacar mercancías de Brecilien; los recursos duplican por nivel de encantamiento. Solo de referencia — las tablas ya no la aplican.",
  // ── Row-level dynamic strings (tx() in render-*.js) ─────────────────────
  r_buy: "Comprar",
  r_sell: "Vender",
  r_farm: "Cultivar",
  r_craft: "Fabricar",
  r_butcher: "Carnicero",
  r_refine: "Refinar",
  r_mill: "Moler",
  r_cook: "Cocinar",
  r_brew: "Destilar",
  r_buy_butcher: "Comprar y carnear",
  r_pasture: "Pastoreo",
  r_flip: "Reventa",
  r_breed: "Cría",
  r_refine_craft: "Refinar+Fabricar",
  r_crop: "Cultivo",
  r_herb: "Hierba",
  r_byproduct: "Subproducto",
  r_seeds: "semillas",
  r_seeds_to_buy: "a comprar",
  r_seed_return: "de retorno de semillas",
  r_self_seeding: "se resiembra sola",
  r_seeds_10k_farming_actions: "{cycles}x ciclos · {plots} parcelas @ {focus} concentración c/u",
  r_outlier_ignored_click_to_set: "valor atípico ignorado — clic para fijar",
  r_tip_outlier_ignored: "{city} cotiza {price}, muy lejos de lo que cotizan las demás ciudades, así que se ignoró. Clic para fijar un precio.",
  r_seeds_10k_farming_tip: "Una barra riega {cycles} ciclos = {plots} parcelas a {focus} por ciclo ({perSeed} por semilla × {slots} ranuras). Regada, la parcela devuelve el {pct}% de sus semillas.",
  r_seeds_10k_farming_tip_dry: "Una barra riega {cycles} ciclos = {plots} parcelas a {focus} por ciclo ({perSeed} por semilla × {slots} ranuras). Sin riego (Usar Foco off), devuelve el {pct}%.",
  r_breeding_saddled: "(Cría → Ensillado)",
  r_breeding: "(Cría)",
  r_craft_paren: "(Fabricar)",
  r_sell_salvage_no_reroll: "✓ Vender o desguazar — sin reroll",
  r_dont_roll_unprofitable: "✗ No tirar — no rentable",
  r_hunt_only: "Solo cazar",
  r_keep_any_profitable: "Conservar los rentables",
  r_reroll_badge: "↩ reroll",
  r_salvage_badge: "♻ desguazar",
  r_skip_badge: "⊘ omitir",
  r_rolling_unprofitable:
    "Tirar no es rentable a precios actuales. No tires; si ya tienes stock, vende el artefacto de mayor valor.",
  r_saddled_sell_price: "Precio de venta de montura ensillada",
  r_hunt_mode: "↑ Modo caza",
  r_bred_paren: " (Criado)",
  r_craft_paren_sp: " (Fabricar)",
  r_baby_per_cycle: "Cría (por ciclo)",
  r_food_per_cycle: "Comida por ciclo",
  r_saddler_materials: "Materiales de guarnicionero (por montura ensillada)",
  r_focus_efficiency: "Eficiencia de Concentración",
  r_base_mount_consumed: "Montura base (1 consumida)",
  r_materials_consumed_no_return: "Materiales (consumidos, sin retorno)",
  r_net_silver_breakdown: "Desglose de plata neta",
  r_no_data: "sin datos",
  r_no_data_click_set: "sin datos — clic para fijar",
  r_no_food_no_data: "sin comida / sin datos",
  r_awaiting_scan: "Esperando escaneo…",
  r_no_saved_trades:
    'Aún no hay operaciones guardadas — rellena la calculadora y pulsa "+ Guardar fila".',
  r_never: "Nunca",
  r_totals: "Totales",
  r_row: "fila",
  r_rows: "filas",
  r_batches: "lotes",
  r_output_ea: "de producto c/u",
  r_full: "lleno",
  r_empty: "vacío",
  r_full_journal_sell: "venta de diario lleno",
  r_empty_journal_buy: "compra de diario vacío",

  // ── Help tooltips (data-i18n-title) ─────────────────────────────────────
  // City names (Brecilien, Bridgewatch, Caerleon, Fort Sterling, Lymhurst,
  // Martlock, Thetford) are identical in ES → left to English fallback.
  "10_byproduct_yield_bonus_eggs_milk":
    "+10% de bono de rendimiento de subproductos (huevos / leche)",
  "10_production_points_on_these_meat_tiers":
    "+10 puntos de producción en estos niveles de carne",
  "10_seed_yield_bonus_on_these_crops":
    "+10% de bono de rendimiento de producto en estos cultivos",
  "10_seed_yield_bonus_on_these_herbs":
    "+10% de bono de rendimiento de producto en estas hierbas",
  "15_craft_bonus_for_these_item_types":
    "+15% de bono de fabricación para estos tipos de objeto",
  "40_refining_bonus_for_this_resource":
    "+40% de bono de refinado para este recurso",
  game_server_data_region_albion_online_data_p:
    "Servidor de juego / región de datos — Albion Online Data Project",
  all_in_net_silver_per_unit_estimated_units_h:
    "Plata neta total por unidad × unidades/hora estimadas — el número clave para comparar actividades. Drops encantados, peces raros y botín de rastreo van incluidos.",
  all_in_net_silver_per_unit_weight_haul_effic:
    "Plata neta total por unidad ÷ peso — eficiencia de transporte para monturas y bolsas limitadas por peso. Los drops de bono van incluidos; la cantería no tiene.",
  base_fame_needed_to_fill_the_journal_items_x:
    "Fama base necesaria para llenar el diario (maxfame de items.xml). La fama extra de Premium no cuenta.",
  base_royal_city_production_bonus_every_city:
    "Bono base de producción de ciudad real (todas las ciudades)",
  best_journal_to_fill_while_doing_this_activi:
    "Mejor diario para llenar mientras recolectas aquí, como plata/hora extra = plata-por-fama × tu fama base/hora. Un diario se llena desde su nivel hasta +2.",
  buy_mode_sell_mode_i_instant_m_market_order:
    "Modo de compra / Modo de venta (I=Instantáneo, M=Orden de mercado)",
  collapse_every_table_down_to_just_its_headin:
    "Contrae cada tabla hasta solo su encabezado, para saltar rápido entre secciones.",
  cost_in_faction_points_earned_from_faction_w:
    "Coste en Puntos de Facción (ganados en guerra de facción / alistamiento) para comprar este objeto al NPC de Alistamiento de Facción. Compara su equivalente en plata con las columnas P/PF.",
  cost_to_buy_one_empty_journal_the_input_you_:
    "Coste de COMPRAR un diario vacío (el insumo que llenas con fama).",
  cost_to_buy_one_filled_journal_for_this_cycl:
    "PRECIO de mercado de un diario lleno (clic para ajustar). El coste que se resta del beneficio es este precio + 2,5% de tarifa de preparación, y es el único coste inicial por ciclo.",
  cycles_needed_to_recoup_the_t8_buy_cost_via_:
    "Ciclos necesarios para recuperar el coste de compra T8 con el beneficio por ciclo de esta fila (1 ciclo ≈ 22h)",
  download_all_your_manual_price_volume_overri:
    "Descarga toda tu configuración como archivo JSON: precios y volúmenes, ciudades fijadas, los niveles de ⚙ Especialización de cada tabla, los portales mapeados y los ajustes de la cabecera.",
  estimated_units_gathered_per_hour_at_this_ti:
    "Unidades estimadas por hora en este nivel — baja al subir de nivel. La pesca usa su ritmo de minijuego; el Rastreo, muertes/hora × restos/muerte.",
  expand_every_collapsed_table_back_to_its_ful:
    "Expande cada tabla contraída de nuevo a todas sus filas.",
  expected_extra_silver_per_item_from_optimal:
    "Plata extra por objeto al recalibrar la calidad del objeto de forma óptima en vez de venderlo en Normal, en la ciudad de venta de esta fila. Solo tras un escaneo completo o Escanear recalibrado (precios por calidad).",
  expected_value_including_focus_nurture_offsp:
    "Beneficio del ciclo más TODA la probabilidad de descendencia, base + crianza. El beneficio ya incluye lo que permite Usar Concentración, así que aquí aparece — con la concentración activa.",
  profit_incl_offspring_chance:
    "Venta menos insumos, más la cría que devuelve el ciclo: la base siempre, y la crianza con Concentración activa. Un animal común con crianza completa supera el 100 %: ese excedente es una segunda cría.",
  extra_silver_per_craft_from_filling_the_craf:
    "Plata extra por fabricación al llenar el diario con la fama de esta fabricación: fama/fab × la plata-por-fama del mejor diario. Los precios de abajo son editables con un clic.",
  favor_cost_at_the_energy_manipulator_150_fav:
    "Coste en Favor en el Manipulador de Energía (150 Favor = 1 Energía Sifonada; Cofre del Conquistador = 6.750)",
  fetch_the_latest_market_prices_volumes_for_e:
    "Obtén los últimos precios y volúmenes de mercado de cada objeto catalogado desde el Albion Online Data Project, y recalcula todas las tablas de abajo.",
  for_baby_rows_silver_fp_if_you_instead_nurtu:
    "Para filas de Cría: plata/PF si en cambio crías y ensillas la cría. Otras filas N/D.",
  full_sell_after_6_5_tax_empty_buy_the_silver:
    "Venta en lleno tras el 6,5% de impuesto − compra en vacío. La plata neta por diario llenado.",
  gathering_resource_journal_laborer_turns_it_:
    "Recolección = diario de recursos (el trabajador lo convierte en recursos en bruto); Trofeo = diario de trofeo (el trabajador lo convierte en un Trofeo); General = Trofeo General, que se llena con CUALQUIER fama.",
  gross_revenue_silver_the_cycle_s_payload_sel:
    "Lo que vale la carga de un diario lleno. Las filas de trofeo muestran el precio UNITARIO (clic para ajustar); los demás modos, plata por ciclo tras impuesto.",
  load_price_volume_overrides_from_a_previousl:
    "Carga una configuración exportada previamente. Para precios y volúmenes se pregunta fusionar o reemplazar, los portales de las Rutas siempre se fusionan, y las ⚙ Especializaciones y los interruptores se reemplazan.",
  what_that_same_journal_is_worth_handed_to_a_:
    "Llena tú este diario y dáselo a un trabajador; vuelve vacío. Plata bruta por HORA de recolección, con un trabajador T8. ×N = trabajadores que mantendrías alimentados.",
  how_long_this_journal_takes_to_fill_at_the_g:
    "Tiempo de llenado con el nivel del propio diario y la plata/hora que implica (margen ÷ horas). Un diario se llena desde su nivel hasta +2; fuera de esa ventana, un guion.",
  the_other_play_fill_the_journal_yourself_wit:
    "La otra jugada: llena el diario TÚ MISMO con fama de recolección en vez de comprarlo lleno. El trabajador devuelve el mismo diario vacío, así que nunca se compra ni se vende ningún diario y toda la carga es beneficio — pero tus horas de recolección son el recurso escaso. Muestra cuánto tarda en llenarse un diario con su propio nivel y la plata por hora de recolección que implica, además de cuántos trabajadores mantiene alimentados la fama de un solo jugador (ciclo de 22h cada uno). El nivel puede diferir del de Mejor diario: esa columna puede comprar cualquier nivel en el mercado, este bucle solo puede llenar los niveles que alcanza tu nivel de recolección.",
  the_two_ways_to_work_this_laborer_each_price:
    "Dos jugadas en unidades distintas — nunca las compares. Arriba: llenarlo tú, plata por HORA de recolección, neta del valor de venta de esa fama. Abajo: comprarlo lleno, por ciclo de 22 h.",
  the_two_ways_to_work_this_laborer_for_one_22:
    "Las dos formas de trabajar a este trabajador durante un ciclo de 22 h, ambas en plata por ciclo para que se puedan comparar directamente. COMPRAR LLENO: compra un diario lleno en el mercado, úsalo y vende el vacío — neto de la compra, y libre de elegir cualquier nivel porque el mercado los vende todos. Un diario ≥1 nivel por debajo del trabajador rinde el 150% completo (vs ~102,5–117,5% en su propio nivel), así que un nivel inferior a menudo da más. LLENARLO TÚ: llena un diario con fama que ya estabas ganando, úsalo y recupera el mismo diario vacío — no se compra ni se vende nada, así que toda la carga es beneficio, pero el nivel queda fijado por lo que puedas llenar (la ventana de ±2 de recolección o, para un trabajador de fabricación, el nivel al que fabricas). La mejor jugada encabeza la celda y es por lo que ordena esta columna; el esfuerzo de llenado que la acompaña va en horas para los recolectores y en FABRICACIONES para los trabajadores de fabricación (Herrero, Flechero, Imbuidor, Hojalatero), que no tienen tiempo de lanzamiento y por tanto ninguna tasa por hora.",
  what_this_building_s_crew_is_worth_per_hour_:
    "Lo que vale la cuadrilla de este edificio por hora de TU recolección si llenas sus diarios tú mismo en vez de comprarlos llenos. El diario vuelve vacío y se reutiliza siempre, así que no se compra ni se vende nada y toda la carga es beneficio — tus horas de recolección son el recurso escaso. Muestra el tiempo de llenado con el nivel del propio diario, la plata/hora que implica y cuántos trabajadores mantiene alimentados la fama de un solo jugador.",
  what_this_building_s_crew_turns_a_point_of_y:
    "Plata por HORA de tu recolección si llenas tú los diarios de esta cuadrilla, neta de lo que esa fama podría haberse vendido. Las cuadrillas de fabricación se valoran por fabricación.",
  what_this_building_s_crew_pays_per_22h_labor:
    "Lo que paga la cuadrilla de este edificio por ciclo de trabajador de 22 h si llenas sus diarios tú mismo en vez de comprarlos llenos. El diario vuelve vacío y se reutiliza siempre, así que no se compra ni se vende nada y toda la carga es beneficio — pero el nivel queda fijado por lo que puedas llenar. Bajo la plata: qué diario es y cuánto tarda en llenarse uno con su propio nivel (las cuadrillas de fabricación se cuentan en FABRICACIONES, al no tener tiempo de lanzamiento), a cuántos trabajadores mantiene alimentados la fama de un solo jugador y la ciudad en la que se valora la jugada. Ordena por plata por ciclo, la unidad que comparten las cuadrillas de fabricación y las de recolección.",
  margin_fame_to_fill_1_000_the_headline_ranki:
    "Margen ÷ fama-para-llenar × 1.000 — la clasificación principal. Mayor = cada punto de fama de recolección vale más.",
  marginal_silver_gained_per_focus_point_spent:
    "Plata que compra la Concentración en este refinado con tus niveles de ⚙ Especialización, no el beneficio de la ruta — el bruto extra de la jugada ganadora de Mejor Concentración, por punto.",
  market_price_of_a_pre_leveled_contract_for_t:
    "Precio de mercado de un contrato preniveleado EN EL NIVEL DE ESTA FILA. Clic para corregirlo; tu valor alimenta la Mejor ruta de nivelación. Equilibrio usa siempre el precio T8.",
  most_profitable_journal_tier_to_feed_this_la:
    "Nivel de diario más rentable para ALIMENTAR a este trabajador. Un diario ≥1 nivel por debajo del trabajador rinde el 150% completo (vs ~102,5–117,5% en su propio nivel), a menudo dando más por ciclo con botín de menor nivel y más barato. Muestra el nivel de diario ganador @ rendimiento y su beneficio/ciclo; ▲ marca cuándo un diario de nivel inferior supera al del propio nivel del trabajador.",
  most_profitable_leveling_path_acquire_a_cont:
    "Mejor ruta de nivelación: consigue un contrato en el nivel inicial, súbelo con los diarios de este modo y véndelo en el mejor nivel final. Neto de coste e impuesto, todas las combinaciones.",
  net_profit_total_fp_outlay_baby_hearts_when_:
    "Beneficio neto ÷ desembolso total de PF (cría + corazones) al criar y ensillar",
  net_revenue_buy_cost_buy_cost_includes_its_o:
    "Ingresos netos − Coste de compra (el coste de compra incluye su propia tarifa de preparación del 2,5%) — la plata real que conservas tras todas las tarifas de mercado.",
  net_silver_after_market_fees_4_premium_tax_2:
    "Plata neta tras las tarifas de mercado (4% de impuesto Premium + 2,5% de tarifa de preparación)",
  net_silver_earned_per_focus_point_spent_cook:
    "Plata que compra la Concentración en esta fila con tus niveles de ⚙ Especialización, no el beneficio total — el valor extra de ingredientes de la jugada ganadora de Mejor Concentración, por punto.",
  net_silver_earned_per_focus_point_spent_craf:
    "Plata que compra la Concentración en esta fabricación con tus ⚙ Especializaciones, no su beneficio total: el material extra que devuelve la tasa de retorno ÷ Concentración por fabricación. El Planificador la compara con refinar.",
  silver_the_focus_itself_buys_on_this_row_per:
    "Plata que compra la Concentración en esta fila, por punto — la jugada ganadora ÷ su coste de Concentración, no el beneficio total del ciclo.",
  which_focus_spending_leaves_the_refined_reso:
    "Qué jugada de Concentración deja más rentable el recurso refinado que vendes. En una fila en cadena cada nivel es candidato; gana el que más plata quita a la barra.",
  which_focus_spending_leaves_this_consumable_:
    "Qué jugada de Concentración deja más rentable este consumible. Los ingredientes se compran, así que solo el paso de cocinar/preparar (o una fabricación en cadena) la admite.",
  which_focus_spending_leaves_this_row_s_finis:
    "Qué gasto de Concentración deja más rentable el objeto terminado de esta fila, y cuánto añade. Esta fila COMPRA sus materiales, así que el paso de fabricación es el único que puede recibir Concentración — concentrar el refinado de un material es la tubería del Planificador de Fabricación, que ordena ambas jugadas con el mismo criterio. Se ordena por la plata que la jugada añade por fabricación.",

  which_focus_spending_leaves_this_row_s_finis_2:
    "Qué jugada de Concentración deja más rentable esta montura y cuánto añade: criar la descendencia, o concentrar la fabricación de montura. Una montura fabricada solo puede concentrar la fabricación.",
  which_focus_spending_leaves_this_row_s_harve:
    "Qué jugada de Concentración deja más rentable esta cosecha y cuánto añade por ciclo: regar en una parcela de cultivo o hierba, criar en un animal de pasto.",
  net_silver_from_selling_the_baby_raw_baby_fp:
    "Plata neta por vender la cría en bruto ÷ coste de PF de la cría (3K T5 / 15K T8) — saltarte la cría por completo",
  net_silver_per_focus_point_spent_nurturing_o:
    "Plata que compra la Concentración en esta fila con tus niveles de ⚙ Especialización, no su beneficio total — la jugada ganadora (criar, o la fabricación de montura) por punto.",
  net_silver_you_pocket_per_cycle_payload_cycl:
    "Ingresos de carga + venta del diario vacío − coste del diario lleno, con el Margen % sobre el coste lleno debajo. Pasa el ratón para la aritmética; clic para cambiar la ciudad de venta.",
  applies_one_specialization_level_to_every_tab:
    "Aplica un mismo nivel de especialización a todas las tablas a la vez, igual que si lo pusieras en cada panel ⚙ Especialización. Restablecer devuelve los niveles que escribiste en los paneles ⚙ y nunca los borra.",
  premium_accounts_pay_4_market_sales_tax_non_:
    "Las cuentas Premium pagan un 4% de impuesto de venta, las no Premium un 8%. Alternarlo revalúa todas las tablas. La tarifa del 2,5% se suma en las patas que el Modelo de precios coloca como órdenes.",
  buy_at_the_ask_filled_immediately_no_order_i:
    "Compra al precio de venta, ejecutado al instante. No se coloca ninguna orden, así que la compra no paga la tarifa de preparación del 2,5%.",
  buy_at_the_bid_and_wait_to_be_filled_places_:
    "Compra al precio de compra y espera a que se ejecute. Coloca una orden, así que la compra paga la tarifa de preparación del 2,5%.",
  sell_into_the_standing_bid_filled_immediatel:
    "Vende contra la orden de compra existente, ejecutado al instante. No se coloca ninguna orden, así que solo se descuenta el impuesto de venta.",
  list_at_the_ask_and_wait_to_be_filled_places:
    "Publica al precio de venta y espera a que se ejecute. Coloca una orden, así que la venta paga la tarifa de preparación del 2,5% además del impuesto de venta.",
  price_to_sell_one_full_journal_before_the_6_:
    "Precio de VENTA de un diario lleno (antes del 6,5% de impuesto de mercado).",
  profit_cycle_as_a_percentage_of_filled_cost_:
    "Beneficio / Ciclo como porcentaje del Coste lleno (retorno sobre el diario que compraste).",
  profit_for_one_full_transport_ox_load_a_t4_t:
    "Beneficio de una carga completa de Buey de transporte (un T8 carga 3.200 kg) = Beneficio puro por objeto × los objetos que caben por peso. Ordena rutas por plata y transporte.",
  pure_faction_point_math_no_market_scan_given:
    "Matemática pura de Puntos de Facción (sin escaneo de mercado): dado un presupuesto de PF, cuántos blasones, corazones y capas de facción completas puedes fabricar.",
  pure_profit_daily_volume_silver_throughput_p:
    "Beneficio puro × Volumen diario — potencial de flujo de plata",
  pure_profit_per_craft_sell_after_6_5_tax_cos:
    "Venta (tras 6,5% de impuesto) − coste + plata de llenado de diario. 'Usar Concentración' la aplica a UNA jugada: la ganadora de Mejor Concentración, elegida para maximizar este número.",
  refresh_the_highest_trade_volume_table_re_fe:
    "Actualiza la tabla de Mayor volumen de comercio — vuelve a obtener el volumen negociado de 24h en todas las ciudades para los objetos destacados.",
  remove_every_manual_price_volume_override_yo:
    "Elimina todos los ajustes manuales de precio/volumen que hayas escrito en las celdas y todas las ciudades fijadas de compra/venta, revirtiendo esas celdas a los datos de mercado escaneados.",
  scan_the_artifact_rolling_table_only_fetches:
    "Escanea solo la tabla de Tirada de artefactos — obtiene precios de fragmentos y artefactos y recalcula el coste de tirada vs. los márgenes de venta.",
  scan_the_breeding_mounts_table_only_fetches_:
    "Escanea solo la tabla de Cría y monturas — obtiene precios de crías, monturas y materiales y recalcula el beneficio de cría y de fabricación de monturas.",
  scan_the_consumables_table_only_fetches_ingr:
    "Escanea solo la tabla de Consumibles — obtiene precios de ingredientes y comidas/pociones y recalcula el beneficio de cocina/preparación.",
  scan_the_crafting_planner_only_fetches_mater:
    "Escanea solo el Planificador — materiales, la escalera de refinado completa, el objeto final y los diarios, y recalcula el beneficio combinado y la mejor jugada de Concentración.",
  scan_the_crafting_table_only_fetches_materia:
    "Escanea solo la tabla de Fabricación — obtiene precios de materiales y equipo y recalcula el beneficio por fabricación (con Concentración y especialización máxima).",
  scan_the_enchanting_table_only_fetches_base_:
    "Escanea solo la tabla de Encantamiento — obtiene precios de objeto base y materiales de encantamiento y recalcula el beneficio de mejora (.n → .n+1).",
  scan_the_faction_spending_table_only_recompu:
    "Escanea solo la tabla de Gasto de facción — recalcula la plata-por-Punto-de-Facción (PF) y la plata-por-Favor (Manipulador de Energía) de todo lo que puedes comprar.",
  scan_the_farming_table_only_fetches_seed_bab:
    "Escanea solo la tabla de Agricultura — obtiene precios de semilla/cría y de productos y recalcula el beneficio por ciclo de cultivo y por día.",
  scan_the_flipping_table_only_fetches_buy_sel:
    "Escanea solo la tabla de Reventa — obtiene precios de compra/venta en todas las ciudades y recalcula los márgenes de reventa entre ciudades.",
  scan_the_gathering_table_only_fetches_raw_re:
    "Escanea solo la tabla de Recolección — obtiene precios de recursos en bruto, peces, algas, restos de rastreo y artefacto de Cambiaformas y recalcula plata/kg y plata/hora de cada actividad de recolección.",
  scan_the_journal_filling_table_only_fetches_:
    "Escanea solo la tabla de Llenado de diarios — obtiene precios de diario vacío y lleno de cada diario de recolección, trofeo y General y recalcula Plata / 1k Fama.",
  scan_the_laborers_table_only_fetches_journal:
    "Escanea solo la tabla de Trabajadores — obtiene precios de diario/contrato y carga y recalcula el beneficio por ciclo y el equilibrio T8.",
  scan_the_quality_rerolling_table_only_fetche:
    "Escanea solo la tabla de Recalibrado de calidad — obtiene precios de objeto por calidad y recalcula el coste de recalibrado vs. la subida de calidad.",
  scan_the_refining_transport_table_only_fetch:
    "Escanea solo la tabla de Refinado / Transporte — obtiene precios en bruto y refinados y recalcula el beneficio de refinar-y-transportar (con tasas de retorno de ciudad y Concentración).",
  scan_the_skins_trading_table_only_fetches_ea:
    "Escanea solo la tabla de Comercio de aspectos — obtiene el precio de listado de cada ficha de desbloqueo de aspecto comerciable en todas las ciudades y recalcula la mejor reventa compra→venta.",
  scan_the_transmute_table_only_fetches_resour:
    "Escanea solo la tabla de Transmutar — obtiene precios de recursos y recalcula los márgenes de transmutación de recursos por coste en plata.",
  sell_price_after_the_6_5_market_tax_no_buy_s:
    "Precio de venta tras el 6,5% de impuesto de mercado (sin coste de compra — recolectas gratis)",
  show_every_catalogued_item_including_rows_wi:
    "Muestra todos los objetos catalogados, incluidas las filas sin datos de mercado o con muy poco volumen (que de lo contrario se ocultan para reducir ruido).",
  silver_fp_from_selling_opening_this_item_dir:
    "Plata/PF por vender/abrir este objeto directamente",
  silver_from_selling_the_emptied_journal_back:
    "PRECIO de mercado del diario vaciado que devuelve el trabajador (clic para ajustar). Se le descuenta el impuesto de mercado antes de sumarlo a los ingresos de Carga.",
  silver_per_favor_energy_manipulator_rows_che:
    "Plata por Favor — filas del Manipulador de Energía (cofre, Runas/Almas/Reliquias, monturas de combate)",
  the_enchant_step_being_crafted_e_g_0_1_upgra:
    "El paso de encantamiento que se fabrica — p.ej. .0 → .1 mejora un objeto base a encantamiento nivel 1 añadiendo materiales de encantamiento (runas/almas/reliquias).",
  the_highest_silver_per_focus_play_for_this_r:
    "La mejor jugada única de Concentración de esta fila: la propia fabricación o un refinado de material. Se muestra como +plata/fabricación, con su plata-por-Concentración detrás.",
  the_quality_upgrade_being_attempted_e_g_good:
    "La mejora de calidad que se intenta — p.ej. Buena → Sobresaliente. Compra el objeto en la calidad inferior y recalíbralo por una probabilidad de la superior.",
  the_transmutation_being_performed_at_the_tra:
    "La transmutación que se realiza en la Torre de Transmutación — convertir un recurso o moneda de encantamiento en otro (p.ej. un cambio de nivel, o Runa → Alma → Reliquia).",
  total_feed_to_buy_to_spend_a_full_10_000_foc:
    "Alimento a comprar para 10.000 de Concentración criando = ciclos de cría por 10k × piezas de alimento por ciclo.",
  total_per_craft_cost_every_material_sourced_:
    "Coste por fabricación: cada material al MÁS BARATO entre comprar el lingote o refinarlo tú, neto de la tasa de retorno, más tarifas de preparación y de estación.",
  total_quantity_of_ingredients_to_buy_to_spen:
    "Ingredientes a comprar para 10.000 de Concentración cocinando o preparando = fabricaciones por 10k × ingredientes por fabricación, neto de la tasa de retorno.",
  total_quantity_of_materials_to_buy_to_spend_:
    "Materiales a comprar para 10.000 de Concentración fabricando = fabricaciones por 10k × mats por fabricación, neto de la tasa de retorno.",
  total_quantity_of_raw_materials_to_buy_to_sp:
    "Brutos a comprar para 10.000 de Concentración refinando = refinados por 10k × bruto por refinado, neto de la tasa de retorno.",
  weight_of_one_unit_mined_quarried_resources_:
    "Peso de una unidad. Los recursos minados/canteados usan 0,1 × 1,5^nivel; los peces llevan su peso real (más ligero) del juego, las algas son un plano de 1 kg.",
  what_the_laborer_produces_from_a_filled_jour:
    "Lo que el trabajador produce de un diario lleno: Recurso (recursos en bruto), Trofeo (un Trofeo), Fabricación (bienes refinados/fabricados) o Mercenario (plata sin impuestos).",
  what_the_sale_brings_in_sell_price_qty_minus:
    "Lo que aporta la venta: precio de venta × cant. menos el impuesto de venta y la tarifa de preparación del 2,5%. Tu coste de compra NO se resta aquí — ver Beneficio neto.",
  where_to_buy_the_filled_journal_vs_where_the:
    "Dónde comprar el diario lleno vs. dónde el trabajador trabaja y se vende la carga. Un ciclo ≈ 22h.",

  // Zona negra (Tierras Lejanas)
  black_zone_bonuses_reference:
    "Fabricación en zona negra: calidad de zona × nivel de energía (referencia)",
  black_zone_desc:
    "Bono de producción y tasa de retorno del refugio. Los factores son la Calidad de zona (1-6) y el Nivel de energía (1-9); el nivel del refugio solo da parcelas. El enfoque añade +59 fijo.",
  black_zone_locations_reference: "Ubicaciones de zona negra y refinado (referencia)",
  black_zone_locations_desc:
    "El refinado en las Tierras Lejanas es fijo — sin calidad de zona, nivel de energía ni especialización. Los bonos de fabricación escalan con calidad y energía; los Descansos son fijos.",
  filter_e_g_q4: "Filtrar… p.ej. q4",
  filter_e_g_swamp: "Filtrar… p.ej. pantano",
  zone_quality: "Calidad de zona",
  power_level: "Nivel de energía",
  general_pb: "BP general",
  general_rrr: "TRR general",
  general_rrr_focus: "TRR general (enfoque)",
  specialized_pb: "BP especializado",
  specialized_rrr: "TRR especializado",
  specialized_rrr_focus: "TRR especializado (enfoque)",
  location: "Ubicación",
  refining_pb: "BP de refinado",
  refining_rrr: "TRR de refinado",
  refining_rrr_focus: "TRR de refinado (enfoque)",
  crafting_pb_general: "BP de fabricación (general)",
  crafting_pb_specialized: "BP de fabricación (especializado)",
  notes: "Notas",
  specialized_crafts: "Fabricaciones especializadas",
  bz_zone_quality_tip: "Calidad de la región donde está el refugio (1-6)",
  bz_power_level_tip:
    "Nivel de energía del refugio, alimentado con Núcleos de energía (decae con el tiempo)",
  bz_general_pb_tip:
    "Bono de producción para fabricaciones no especializadas — solo depende del nivel de energía, no de la calidad de zona",
  bz_general_rrr_tip: "Tasa de retorno de recursos sin enfoque",
  bz_general_rrr_focus_tip: "Tasa de retorno de recursos con enfoque (+59 de bono de producción)",
  bz_spec_pb_tip: "Bono de producción para lo que el bioma de la región especializa",
  bz_spec_rrr_tip: "Tasa de retorno especializada sin enfoque",
  bz_spec_rrr_focus_tip: "Tasa de retorno especializada con enfoque (+59 de bono de producción)",
  bz_refine_pb_tip: "Bono de producción de refinado en esta ubicación",
  bz_refine_rrr_tip: "Tasa de retorno de refinado sin enfoque",
  bz_refine_rrr_focus_tip: "Tasa de retorno de refinado con enfoque (+59 de bono de producción)",
  bz_craft_general_tip: "Bono de producción de fabricación para objetos no especializados",
  bz_craft_spec_tip: "Bono de producción de fabricación para lo que esta ubicación especializa",
  bz_spec_crafts_tip: "Tipos de objeto que reciben el bono de fabricación especializado aquí",

};
// Parts 2 and 3 (js/i18n-strings-es-extra.js, js/i18n-strings-es-rows.js) are
// merged in: they load first in the browser, and are required under Node.
if (typeof UI_STRINGS_ES_EXTRA !== "undefined") {
  Object.assign(UI_STRINGS_ES, UI_STRINGS_ES_EXTRA);
} else if (typeof require === "function") {
  Object.assign(UI_STRINGS_ES, require("./i18n-strings-es-extra.js").UI_STRINGS_ES_EXTRA);
}
if (typeof UI_STRINGS_ES_ROWS !== "undefined") {
  Object.assign(UI_STRINGS_ES, UI_STRINGS_ES_ROWS);
} else if (typeof require === "function") {
  Object.assign(UI_STRINGS_ES, require("./i18n-strings-es-rows.js").UI_STRINGS_ES_ROWS);
}
// Part 4 (js/i18n-strings-es-headers.js) — the column-header help tooltips.
if (typeof UI_STRINGS_ES_HEADERS !== "undefined") {
  Object.assign(UI_STRINGS_ES, UI_STRINGS_ES_HEADERS);
} else if (typeof require === "function") {
  Object.assign(UI_STRINGS_ES, require("./i18n-strings-es-headers.js").UI_STRINGS_ES_HEADERS);
}
// Part 5 (js/i18n-strings-es-rolling-exchange.js) — the Artifact Rolling
// table's Energy Manipulator exchange section.
if (typeof UI_STRINGS_ES_ROLLING_EXCHANGE !== "undefined") {
  Object.assign(UI_STRINGS_ES, UI_STRINGS_ES_ROLLING_EXCHANGE);
} else if (typeof require === "function") {
  Object.assign(UI_STRINGS_ES, require("./i18n-strings-es-rolling-exchange.js").UI_STRINGS_ES_ROLLING_EXCHANGE);
}

if (typeof module !== "undefined" && module.exports)
  module.exports = { UI_STRINGS_ES };
