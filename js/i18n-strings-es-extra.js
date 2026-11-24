/**
 * Spanish (ES-ES) overlay, part 2 — strings added for the newer panels and for
 * text that render-*.js builds at runtime via tx(englishText, slug).
 *
 * Split out of js/i18n-strings-es.js purely for file size (the repo caps source
 * files at 800 lines); the two tables are merged into one UI_STRINGS_ES object
 * by that file, which loads AFTER this one in index.html.
 *
 * Same rules as part 1: keys mirror the generated js/i18n-strings-en.js slugs,
 * terminology follows Albion Online's official ES-ES client, and any slug that
 * is absent here falls back to English through t() / tx().
 */
const UI_STRINGS_ES_EXTRA = {
  // ── Cabecera global, gráfico de oro y selectores ────────────────────────
  server_americas_west: "América (Oeste)",
  server_europe: "Europa",
  server_asia_east: "Asia (Este)",
  share_with_aodp: "Compartir con AODP",
  capture_city: "Ciudad de captura",
  auto_from_zone: "Automático (según la zona)",
  the_game_only_announces_which_city_you_are_i:
    "El juego solo indica tu ciudad al cruzar una puerta de zona, así que una captura iniciada dentro del mercado no tiene dónde archivar precios. Indícala aquí; la puerta tiene prioridad.",
  never: "Nunca",
  station_fee_label: "Tarifa de estación:",
  range_label: "Rango:",
  style_label: "Estilo:",
  range_3_days: "3 días",
  range_7_days: "7 días",
  range_14_days: "14 días",
  range_30_days_max: "30 días (máx.)",
  chart_style_candles: "Velas",
  chart_style_line: "Línea",
  transition_label: "Transición:",
  faction_label: "Facción:",
  faction_word: "Facción",
  fp_budget_label: "Presupuesto de PF",
  energy_manipulator: "Manipulador de Energía",
  the_antiquarian: "El Anticuario",

  // ── Tipos de fabricación (tabla de bonos de ciudad) ─────────────────────
  craft_type_plate_helmet: "Casco de placas",
  craft_type_plate_armor: "Armadura de placas",
  craft_type_plate_shoes: "Botas de placas",
  craft_type_leather_helmet: "Casco de cuero",
  craft_type_leather_armor: "Armadura de cuero",
  craft_type_leather_shoes: "Botas de cuero",
  craft_type_cloth_helmet: "Casco de tela",
  craft_type_cloth_armor: "Armadura de tela",
  craft_type_cloth_shoes: "Botas de tela",
  craft_type_quarterstaff: "Bastón",
  craft_type_holystaff: "Bastón sagrado",
  craft_type_arcanestaff: "Bastón arcano",
  craft_type_cursestaff: "Bastón de maldición",
  craft_type_naturestaff: "Bastón de naturaleza",
  craft_type_firestaff: "Bastón de fuego",
  craft_type_froststaff: "Bastón de hielo",
  craft_type_shapeshifterstaff: "Bastón de cambiaformas",
  craft_type_skinningknife: "Cuchillo de despellejar",
  craft_type_stonehammer: "Martillo de piedra",
  craft_type_demolitionhammer: "Martillo de demolición",
  craft_type_woodaxe: "Hacha de leñador",
  craft_type_fibergatherer_helmet: "Casco de recolector de fibra",
  craft_type_fibergatherer_armor: "Armadura de recolector de fibra",
  craft_type_fibergatherer_shoes: "Botas de recolector de fibra",
  craft_type_fibergatherer_backpack: "Mochila de recolector de fibra",
  craft_type_hidegatherer_helmet: "Casco de recolector de piel",
  craft_type_hidegatherer_armor: "Armadura de recolector de piel",
  craft_type_hidegatherer_shoes: "Botas de recolector de piel",
  craft_type_hidegatherer_backpack: "Mochila de recolector de piel",
  craft_type_oregatherer_helmet: "Casco de recolector de mineral",
  craft_type_oregatherer_armor: "Armadura de recolector de mineral",
  craft_type_oregatherer_shoes: "Botas de recolector de mineral",
  craft_type_oregatherer_backpack: "Mochila de recolector de mineral",
  craft_type_rockgatherer_helmet: "Casco de recolector de piedra",
  craft_type_rockgatherer_armor: "Armadura de recolector de piedra",
  craft_type_rockgatherer_shoes: "Botas de recolector de piedra",
  craft_type_rockgatherer_backpack: "Mochila de recolector de piedra",
  craft_type_woodgatherer_helmet: "Casco de recolector de madera",
  craft_type_woodgatherer_armor: "Armadura de recolector de madera",
  craft_type_woodgatherer_shoes: "Botas de recolector de madera",
  craft_type_woodgatherer_backpack: "Mochila de recolector de madera",
  craft_type_fishgatherer_helmet: "Casco de pescador",
  craft_type_fishgatherer_armor: "Armadura de pescador",
  craft_type_fishgatherer_shoes: "Botas de pescador",
  craft_type_fishgatherer_backpack: "Mochila de pescador",
  craft_type_food: "Comida (platos)",
  craft_type_knuckles: "Guantes de guerra",
  refine_type_wood: "Tablones (madera)",
  refine_type_fiber: "Tela (fibra)",
  refine_type_rock: "Bloques de piedra (roca)",
  refine_type_ore: "Lingotes (mineral)",
  refine_type_hide: "Cuero (piel)",

  // ── Ciudades (nombres propios: el cliente ES los deja igual) ─────────────
  thetford: "Thetford",
  bridgewatch: "Bridgewatch",
  martlock: "Martlock",
  fort_sterling: "Fort Sterling",
  lymhurst: "Lymhurst",
  caerleon: "Caerleon",
  brecilien: "Brecilien",
  smugglers_den: "Guarida de Contrabandistas",
  thet: "Thet",
  bdg: "Bdg",
  mart: "Mart",
  ftst: "FtSt",
  lym: "Lym",
  caer: "Caer",
  brec: "Brec",
  smug: "Guar",

  // ── Etiquetas cortas idénticas en ambos idiomas ─────────────────────────
  t4: "T4",
  t5: "T5",
  t6: "T6",
  t7: "T7",
  t8: "T8",
  "1h": "1h",
  "4h": "4h",
  "12h": "12h",
  "1d": "1D",

  // ── Caminos de Avalon — cromo estático ──────────────────────────────────
  roads_live_portals_title: "Caminos de Avalon — Portales activos",
  roads_portals_intro:
    "Los portales caducan 12-24 h tras aparecer y ninguna API los publica — cada fila se escribió a mano abajo o vino de la carpeta compartida de un compañero.",
  roads_zone_reference_title: "Caminos de Avalon — Directorio de zonas",
  roads_zones_intro:
    "406 zonas de los Caminos con nivel, aparición de cofres y recursos recolectables. ◆ marca un portal de Brecilien (caminos profundos de N8).",
  from: "Desde",
  to: "Hasta",
  zone: "Zona",
  chests: "Cofres",
  resources: "Recursos",
  markers: "Marcadores",
  time_left: "Tiempo restante",
  source: "Origen",
  from_zone: "Zona de origen…",
  to_zone: "Zona de destino…",
  find_route: "Buscar ruta",
  nearest_exit: "Salida más cercana",
  portal_from: "Portal desde…",
  portal_to: "Portal hasta…",
  add_portal: "Añadir portal",
  clear_all_portals: "Borrar todo",
  remove_every_recorded_portal_live_and_expire:
    "Elimina todos los portales registrados, activos y caducados. No se puede deshacer.",
  reset_view: "Restablecer vista",
  hours_left_on_the_portal: "Tiempo restante (2:30, 30m o 23h)",
  "2_30_30m_23h": "2:30 / 30m / 23h",
  filter_e_g_gold: "Filtrar… p. ej. dorado",
  filter_e_g_group: "Filtrar… p. ej. grupo",
  shortest_recorded_way_out_of_the_roads_from_:
    "La salida registrada más corta de los Caminos desde la zona «Desde» — las ciudades no son zonas de los Caminos, así que las rutas terminan en una zona real o de Tierras Lejanas.",
  roads_map_empty:
    "Nada mapeado todavía — añade un portal abajo y la red se dibuja aquí.",
  roads_map_hint:
    "arrastra nodos · rueda para el zoom · clic en una zona para «Desde», mayús+clic para «Hasta»",
  roads_legend_royal: "Real",
  roads_legend_rest: "Descanso",
  roads_legend_exit: "anillo discontinuo = salida",
  roads_legend_lines: "línea más gruesa = portal mayor · línea discontinua = caducado",
  roads_legend_brecilien: "los caminos T8 profundos tienen un portal de un solo sentido a Brecilien; los de incursión no",
  roads_map_delete_hint: "clic en una zona o un portal y pulsa Supr para eliminarlo",

  // ── Caminos de Avalon — texto generado en tiempo de ejecución ───────────
  roads_type_roads: "Caminos",
  roads_type_royal_blue: "Real (azul)",
  roads_type_royal_yellow: "Real (amarilla)",
  roads_type_royal_red: "Real (roja)",
  roads_type_outlands: "Tierras Lejanas",
  roads_type_city: "Ciudad",
  roads_type_other: "Otra",
  roads_biome_forest: "Bosque",
  roads_biome_swamp: "Pantano",
  roads_biome_steppe: "Estepa",
  roads_biome_mountain: "Montaña",
  roads_biome_highlands: "Tierras Altas",
  roads_biome_avalon: "Avalon",
  portal_size_solo: "Individual",
  portal_size_group: "Grupo",
  portal_size_raid: "Incursión",
  portal_size_unknown: "?",
  roads_res_stone: "Piedra",
  roads_res_logs: "Troncos",
  roads_res_ore: "Mineral",
  roads_res_fiber: "Fibra",
  roads_res_hide: "Piel",
  roads_marker_dungeon: "mazmorra",
  roads_marker_hire: "mercenario",
  roads_marker_group: "grupo",
  roads_chest_green: "verde",
  roads_chest_blue: "azul",
  roads_chest_gold: "dorado",
  roads_chests_lower: "cofres",
  roads_expired: "caducado",
  roads_timer_estimated: "Estimado — este portal se registró por un cambio de zona, que no lleva temporizador. Los portales cierran de 12 a 24 h tras aparecer, así que este es el máximo que puede seguir abierto. Haz clic para escribir lo que te mostró el juego.",
  roads_charges_left: "Cargas restantes",
  roads_size_unknown_hint: "Desconocido — el juego cifra los objetos de portal, así que el tamaño hay que indicarlo a mano.",
  roads_time_edit_hint: "Haz clic para fijar el tiempo restante. Escribe h:mm como 2:30, o 30m / 23h.",
  roads_source_typed: "manual",
  roads_avalonian_rest: "Descanso Avaloniano",
  roads_brecilien_portal: "Portal de Brecilien",
  roads_portal_one: "portal",
  roads_portal_many: "portales",
  roads_route_valid: "válida",
  roads_route_valid_estimated: "abierta como máximo",
  roads_live_portal_one: "{n} portal activo",
  roads_live_portal_many: "{n} portales activos",
  roads_map_exit_note: "salida de los Caminos",
  roads_map_brecilien_note: "no hay vuelta — la salida aparece en un Camino aleatorio",
  roads_map_brecilien_edge: "portal permanente de un solo sentido a Brecilien",
  roads_map_del_hint: "Supr lo elimina",
  roads_map_edge_selected: "Portal {from} ↔ {to} — Supr lo elimina",
  roads_map_unknown_id: "id de zona desconocido — no está en el catálogo",
  roads_zone_data_unavailable: "Datos de zona no disponibles.",
  roads_no_portals_manual:
    "No hay portales registrados. Añade portales a mano abajo.",
  roads_enter_current_zone: "Escribe la zona en la que estás.",
  roads_enter_two_zones: "Escribe dos nombres de zona.",
  roads_unknown_zone:
    "Zona desconocida: {zones}. Las ciudades no son zonas de los Caminos — usa el nombre de la zona de mundo abierto.",
  roads_no_exit: "No hay salida activa registrada desde {zone}.",
  roads_no_route: "No hay ruta activa de {from} a {to}.",
  roads_pocket_no_exit:
    "No puedes trazar una ruta desde {zone} — su única salida es un portal de un solo sentido a un Camino aleatorio.",
  roads_pocket_no_tunnel:
    "{zone} no tiene salidas de túnel — la única entrada es el portal permanente de los caminos T8 profundos.",
  roads_foot_hop_one: "zona a pie",
  roads_foot_hop_many: "zonas a pie",
  roads_brecilien_hop: "portal de Brecilien",
  roads_travel_hop_one: "viaje",
  roads_travel_hop_many: "viajes",
  roads_no_luggage: "sin equipaje",
  roads_carrying_cargo: "llevo carga",
  city_travel_to_caerleon_takes_no_luggage_:
    "El viaje a Caerleon no admite equipaje — marca esto y la ruta evitará esos saltos.",
  roads_realmgate_label: "puerta del reino",
  roads_realmgate_any: "cualquiera",
  roads_needs_binding: "necesita vínculo con {zone}",
  roads_rebinds_to: "te vincula a {zone}",
  roads_no_portal_shortcut: "ningún portal registrado la acorta",
  your_realmgate_binding_you_can_only_leave_:
    "Tu vínculo de puerta del reino. Solo puedes salir del continente real por la ciudad portal a la que estás vinculado; volver por otra cambia tu vínculo.",
  roads_prefer_label: "preferir",
  roads_prefer_portal: "Caminos",
  roads_prefer_travel: "viaje entre ciudades",
  roads_prefer_foot: "a pie",
  roads_prefer_fastest: "más rápido",
  roads_route_eta: "unos {time}",
  which_way_of_moving_the_route_should_favour:
    "Qué forma de moverse debe favorecer la ruta. «Más rápido» pesa cada salto en tiempo real.",
  roads_closest_approach: "Lo más cerca que puedes llegar: {zone}",
  roads_closest_approach_gap: "no hay forma registrada de recorrer el resto",
  roads_add_need_fields: "Hacen falta dos zonas conocidas y un tiempo restante.",
  roads_added_portal: "Añadido {from} → {to}.",
  roads_add_rejected: "Rechazado (¿misma zona?).",
  roads_clear_confirm: "¿Eliminar los {n} portales registrados? No se puede deshacer.",
  roads_cleared: "Eliminados {n} portales.",
  roads_delete_zone_confirm:
    "¿Eliminar los {n} portales de {zone}? No se puede deshacer.",

  // ── Sincronización en equipo (carpeta compartida) ───────────────────────
  roads_sync_label: "sincronización de equipo",
  roads_sync_choose_folder: "Carpeta compartida…",
  roads_sync_prices_label: "compartir precios capturados",
  share_your_mapped_portals_with_everyone_poin:
    "Comparte tus portales registrados con todos los que apunten a la misma carpeta. Tus portales y precios capturados se escriben en esa carpeta, donde cualquiera con acceso puede leerlos.",
  also_write_the_prices_your_live_monitor_capt:
    "Escribe también en la misma carpeta los precios que capturó tu monitor, donde cualquiera con acceso puede leerlos. Son los únicos precios que la API no puede darte, pero los archivos crecen mucho.",
  roads_sync_no_folder: "ninguna carpeta elegida",
  roads_sync_pick_folder: "elige una carpeta compartida para empezar",
  roads_sync_waiting: "esperando la primera lectura…",
  roads_sync_error: "problema de sincronización",
  roads_sync_summary: "{n} compañeros · {p} portales recibidos",
  roads_sync_summary_one: "1 compañero · {p} portales recibidos",

  // ── Exportar / importar configuración ───────────────────────────────────
  settings_replace_or_merge:
    "¿Reemplazar todos los precios y volúmenes existentes? Aceptar = Reemplazar, Cancelar = Combinar",
  settings_clear_confirm:
    "¿Borrar todos los precios, volúmenes y ciudades fijadas introducidos manualmente?",
  settings_invalid_file: "Archivo de configuración no válido.",

  // ── Filtros por tabla (categoría / subcategoría / ciudad) ───────────────
  r_cat_filter: "Categoría",
  r_subcat_filter: "Subcategoría",
  r_city_filter: "Ciudad",
  r_buy_city_filter: "Ciudad de compra",
  r_sell_city_filter: "Ciudad de venta",
  clear_table_overrides: "Borrar",
  clear_table_overrides_btn: "Borrar valores manuales",
  reset_table_filters: "Restablecer filtros",
  reset_table_filters_tip:
    "Vacía el cuadro de búsqueda de esta tabla y devuelve todos los selectores a Todos. No toca ningún precio, volumen ni ciudad que hayas introducido.",
  clear_table_overrides_tip:
    "Borra los precios, volúmenes y ciudades fijadas introducidos manualmente para los objetos de esta tabla. Las demás tablas conservan los suyos.",
  clear_table_overrides_confirm:
    "¿Borrar {n} valor(es) introducido(s) manualmente en {table}? Esta acción no se puede deshacer.",
  clear_table_overrides_none:
    "No hay precios, volúmenes ni ciudades fijadas introducidos manualmente en esta tabla.",
  settings_imported_restart:
    "Configuración importada. Los paneles de gráfico y calculadora se aplican tras reiniciar.",
  settings_parse_failed: "No se pudo leer el archivo de configuración.",

  // ── Gráfico de oro / monitor / cabecera ─────────────────────────────────
  gold_price_chart: "Gráfico de oro",
  gold_intro:
    "Tipo de cambio oro/plata de todo el servidor con indicadores técnicos — usa la región seleccionada arriba",
  configure_indicators: "Configurar indicadores",
  indicators: "⚙ Indicadores",
  reload: "↻ Recargar",
  re_fetch_gold_price_history_for_the_selected:
    "Volver a obtener el histórico del precio del oro para la región seleccionada",
  start_monitor: "▶ Iniciar monitor",
  watch_the_running_game_s_own_traffic_every_m:
    "Observa el tráfico del juego: cada mercado que abres actualiza los precios y las lecturas se envían a AODP. Solo lectura.",
  contribute_the_prices_you_see_back_to_the_al:
    "Contribuye los precios que ves al Albion Online Data Project, la misma base de datos pública que lee el botón Escanear. Desmarca para que las capturas se queden en local.",
  auto_start: "Inicio automático",
  npcap_missing: "controlador de captura npcap no instalado — pulsa Iniciar para instalarlo",
  open_the_capture_automatically_every_time_th:
    "Abre la captura automáticamente cada vez que arranca esta app, para registrar precios en vivo sin hacer clic. Desmarca para iniciarla a mano.",
  collapse_every_table_and_every_section_group:
    "Contrae todas las tablas y todos los grupos de sección hasta dejar solo su título, para saltar rápido entre secciones.",
  set_your_destiny_board_specialization_levels:
    "Ajusta tus niveles de especialización del Tablero del Destino para esta tabla. Las maestrías empiezan en 100 y las especializaciones en 0; subir un nivel baja el coste de Concentración de lo que cubre.",
  ui_language_item_names_labels_prices_are_lan:
    "Idioma de la interfaz — nombres de objetos y etiquetas (los precios no dependen del idioma)",

  // ── Concentración: beneficio por barra de 10.000 ────────────────────────
  profit_per_10k_focus_fp: "Beneficio / 10k Concentración (insumos PF)",
  profit_from_a_full_10000_focus_bar_when_the_:
    "Beneficio de una barra de 10.000 cuando el objeto comprado con PF se USA en vez de revenderse (crías criadas y ensilladas) — la cría cuesta 0 de plata. Los corazones y demás objetos muestran un guion.",
  same_full_10_000_focus_bar_but_the_raw_resou:
    "La misma barra de 10.000 con los brutos recolectados por ti: cuestan 0 aquí y en toda la cadena. Tarifas e impuesto siguen aplicándose; se descartan los sustitutos de corazón y transmutación.",
  total_profit_from_spending_a_full_10_000_foc:
    "Beneficio puro por fabricación (tras coste de materiales) × las fabricaciones enteras que paga una barra de 10.000. «Materiales a comprar (10k)» es ese componente, no un cargo extra. La sobrante se descarta.",
  total_profit_from_spending_a_full_10_000_foc_2:
    "Beneficio por refinado (tras coste de materiales) × los refinados enteros que paga una barra de 10.000. Va con «Materiales 10k»; la Concentración sobrante se descarta.",
  total_profit_from_spending_a_full_10_000_foc_3:
    "Beneficio puro por fabricación (tras coste de materiales) × las fabricaciones enteras que paga una barra de 10.000 cocinando o preparando esto. Va con «Materiales a comprar (10k)»; la sobrante se descarta.",
  cp_profit_10k_focus_tip:
    "Beneficio / Fabricación (tras coste de materiales) × las fabricaciones enteras que paga una barra de 10.000, gastando la Concentración donde dice Mejor Concentración. La sobrante se descarta.",
  total_profit_from_spending_a_full_10_000_foc_4:
    "Fabricación: beneficio por fabricación (tras coste de materiales) × las que paga una barra de 10.000. Cría: solo el beneficio extra de la concentración (crías extra × crías nutridas). Va con «Materiales / 10k».",
  profit_per_harvest_cycle_the_whole_cycles_a_:
    "Beneficio por ciclo de cosecha (tras coste de semillas) × los ciclos enteros que riega o nutre una barra de 10.000. Siempre valora el ciclo regado, así que no cambia con la casilla «Usar Concentración».",
  // ── Fabricación: diario trabajado por el trabajador ─────────────────────
  profit_laborer_journal: "Beneficio + Diario de trabajador",
  pure_profit_plus_what_this_craft_s_journal_i:
    "Beneficio puro + el diario de esta fabricación trabajado por tu trabajador T8 (devuelve botín y el diario vacío). Elige el mejor nivel de diario en la ventana ±2.",
  laborer_journal: "Diario de trabajador",
  profit_per_craft_under_the_other_journal_pla:
    "Beneficio de fabricación + fama de fabricación × la plata por fama de un trabajador T8 — el diario vuelve vacío, nunca se recompra. Alternativa a Beneficio / fabricación, no se suma.",
  // ── Fundición de Artefactos (fusión y reroll) ───────────────────────────
  melding_at_the_artifact_foundry_turns_runes_:
    "Fusionar en la Fundición convierte fragmentos en un artefacto ALEATORIO. Las filas se agrupan por tipo y nivel; la insignia es el consejo — ✓ vender, ↩ repetir, ♻ desguazar, ⊘ omitir.",
  silver_for_one_meld_fragments_per_roll_fragm:
    "Una fusión = fragmentos por tirada × precio del fragmento + 2,5% de tarifa. Repetir cuesta lo mismo menos los 10 fragmentos que devuelve el desguace.",
  cheapest_city_to_buy_the_fragments_this_meld:
    "Ciudad más barata para comprar los fragmentos que consume esta fusión, con la antigüedad del precio y el volumen de 24 h. Haz clic en un precio para ajustarlo.",
  best_sell_price_found_for_this_specific_arti:
    "Mejor precio de venta encontrado para este artefacto concreto entre las ciudades permitidas (primero órdenes de venta, si no órdenes de compra). Haz clic para ajustarlo.",
  where_to_sell_the_artifact_when_the_advice_i:
    "Dónde vender el artefacto cuando el consejo es ✓ vender. Vacío cuando lo óptimo es repetir, desguazar u omitir.",
  on_an_artifact_row_net_sale_roll_cost_roll_c:
    "Fila de artefacto: (venta neta − coste de tirada) ÷ coste de tirada, si sale ese artefacto. Cabecera de grupo: beneficio esperado ÷ gasto esperado, repeticiones incluidas.",
  // ── Descuento Global (precio del oro) ───────────────────────────────────
  gd_label: "Descuento Global",
  gd_gold: "Oro",
  gd_unknown: "Precio del oro no disponible",
  gd_unknown_detail:
    "Los costes en plata se cobran a precio completo hasta que cargue la cotización del oro.",
  gd_none_detail:
    "en o por encima del umbral de 5.000, así que los costes en plata no cambian (×1,000).",
  gd_active_detail: "costes en plata ×",
  gd_active_sinks:
    "en tarifas de estación, rerolls de calidad, transmutaciones, plata de receta y viajes.",

  // ── Costes de construcción ──────────────────────────────────────────────
  building_costs: "Costes de construcción",
  scan_buildings: "Escanear edificios",
  scan_the_building_costs_table_only_fetches_t:
    "Escanea solo la tabla Costes de construcción — obtiene los materiales de construcción, los contratos de trabajador y el mobiliario que necesita cada edificio.",
  buildings_desc:
    "Lo que cuesta TENER un edificio en un nivel: la escalera de mejoras completa desde el nivel más bajo de la familia, valorada con el buildings.xml del juego. Pasa el cursor por un Total para el desglose.",
  laborer_label: "Trabajador:",
  cheapest_contract: "Contrato más barato",
  buildings_laborer_pick:
    "Qué trabajador contrata cada fila: fija el contrato de cada ranura en la columna Trabajadores y la línea de trofeo que ocupa las ranuras restantes en la columna Mobiliario. Se recuerda entre sesiones.",
  filter_e_g_guild_hall_t8: "Filtrar… p.ej. sala de hermandad, T8",
  building: "Edificio",
  station_crafting_or_refining_building_house_:
    "Estación = edificio de fabricación o refinado; Casa / Sala de hermandad = los edificios con ranuras de trabajador y mobiliario; Granja = parcela de cultivo; Refugio = el refugio de zona negra.",
  required_materials: "Materiales necesarios",
  every_upgrade_step_s_materials_rolled_up_fro:
    "Los materiales de cada mejora desde el nivel más bajo de la familia hasta este, valorados en la ciudad más barata que los tenga. Precios editables con un clic.",
  silver_fee: "Tarifa de plata",
  the_placement_fee_paid_at_every_step_of_the_:
    "La tarifa de colocación que se paga en cada paso de la escalera de mejoras (más la plata de receta que cobra el refugio), después del Descuento global que fija el precio del oro.",
  material_cost: "Coste de materiales",
  market_cost_of_the_whole_rolled_up_bill_of_m:
    "Coste de mercado de toda la lista de materiales sumada.",
  laborers: "Trabajadores",
  laborer_slots_the_building_has_filled_with_t:
    "Ranuras de trabajador del edificio, llenadas con el contrato elegido en el selector Trabajador. Solo las casas y las salas de hermandad tienen ranuras.",
  furniture: "Mobiliario",
  the_furnishing_plan_for_the_building_s_furni:
    "El plan de mobiliario: una cama por trabajador, una mesa por cada 4 (6 desde T5) y las ranuras restantes en trofeos, uno de cada nivel y del más barato. Precios editables con un clic.",
  the_journal_tier_this_laborer_is_most_profit:
    "El nivel de diario con el que más renta alimentar a este trabajador, de la tabla Trabajadores. Por debajo de su propio nivel ya rinde el 150% completo. Necesita un escaneo.",
  total_cost: "Coste total",
  everything_this_row_buys_from_an_empty_plot_:
    "Todo lo que compra esta fila desde una parcela vacía: tarifa y materiales de cada mejora, más contratos y mobiliario (contados una vez, en este nivel). Pasa el cursor para el desglose.",
  // Mi Lista de Fabricación — cabeceras estáticas de index.html
  group_craftlist: "Mi Lista de Fabricación",
  group_craftlist_sub:
    'Filas que elegiste con "+", con cantidades y todo lo que hay que comprar',
  my_crafting_list: "Mi Lista de Fabricación",
  clear_list: "Vaciar lista",
  add_to_my_crafting_list: "Añadir a Mi Lista de Fabricación",
  materials_to_buy: "Materiales a comprar",
  materials_to_buy_sub:
    "Los insumos de cada fila × su cantidad, agrupados por material y ciudad — los precios son editables con un clic",
  material: "Material",
  unit_price: "Precio unitario",
  total: "Total",
  r_cl_empty_static:
    'Nada en la lista todavía — haz clic en el "+" de cualquier fila para añadirla.',
  r_cl_no_materials_static: "Todavía no hay materiales comprables en la lista.",
  r_cl_save_failed: "⚠ No se pudo guardar esta lista — se perderá al cerrar la aplicación.",

  on_an_artifact_row_single_outcome_payout_net:
    "Fila de artefacto: venta neta − coste de tirada, si sale ese artefacto. Cabecera de grupo: plata por FRAGMENTO al fusionar en vez de vender, tras cada repetición esperada.",
  // Calidad en la tabla de Reventa, y el sello "el libro se miró"
  r_not_listed: "no listado",
  r_looked: "mirado",
  r_tip_book_empty:
    "El libro de órdenes estaba abierto en este mercado y este precio no estaba en él.",
  // Su contraparte en una celda VACÍA: se miró el libro y este lado no tenía nada
  r_no_orders: "sin órdenes",
  r_tip_no_orders:
    "El libro de órdenes estaba abierto en este mercado y este lado estaba vacío.",
  // Fila de Agricultura sin precio de semilla: no hay beneficio que imprimir
  r_farming_seed_unpriced:
    "Precio de la semilla desconocido: pulsa la celda de Compra para fijarlo",
  // Escalera de calidades bajo las celdas de Compra/Venta en Reventa
  r_qbrk_buy: "compra",
  r_qbrk_sell: "vende",
  r_qbrk_profit: "beneficio",
  r_qbrk_undated:
    "sin marca de tiempo, así que esta calidad no puede quedarse con la fila",
  r_qbrk_bid_only:
    "nadie pide a esta calidad, así que no es una reventa",
  r_qbrk_one_sided:
    "no hay orden contraria a esta calidad, así que no es una reventa",
  // Monitor: una consulta que leyó los libros de varios artículos a la vez
  r_mon_items: "artículos",
};
if (typeof module !== "undefined" && module.exports)
  module.exports = { UI_STRINGS_ES_EXTRA };
