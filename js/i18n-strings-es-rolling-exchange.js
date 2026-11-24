/**
 * Spanish (ES-ES) overlay, part 5 — the Artifact Rolling table's Energy
 * Manipulator exchange section (js/render-rolling-exchange.js).
 *
 * Split out purely for file size: js/i18n-strings-es-rows.js is at the repo's
 * 800-line cap. Merged into UI_STRINGS_ES at the bottom of js/i18n-strings-es.js,
 * the same way parts 2-4 are. `{name}` placeholders are substituted by the
 * caller with .replace(), so every one in the English survives here.
 */
const UI_STRINGS_ES_ROLLING_EXCHANGE = {
  // Fragment labels and the category badge, through txRollLabel ("roll_" + slug).
  roll_exchange: "Intercambio",
  roll_crystal_shard: "Fragmento de Cristal",
  roll_fire_dragon_scales: "Escamas de Dragón de Fuego",

  r_ex_section: "Intercambio del Manipulador de Energía (eliges, no se tira)",
  r_ex_section_tip: "Entrega 50 fragmentos al Manipulador de Energía y elige el artefacto. Determinista: sin fusión, sin repetir tirada, sin desguace; los fragmentos no se devuelven.",
  r_ex_per_exchange: "por intercambio",
  r_ex_frags_per_exchange: "frags / intercambio",
  r_ex_picks: "{n} opciones",
  r_ex_pick_list: "Neto de impuestos por opción, la mejor primero",
  r_ex_unpriced: "Sin precio",
  r_ex_no_pick_priced: "Ninguna opción tiene precio todavía. Pon uno en el precio de venta para ordenar las opciones.",
  r_ex_tip_cost: "{count} × {frag} a {price} + {fee}% de tarifa de orden de compra = un intercambio. El Manipulador de Energía no cobra plata y los fragmentos no se devuelven.",
  r_ex_tip_profit: "TÚ eliges este artefacto: pago seguro, no un valor esperado. Venta neta {rev} − coste del intercambio {cost}.",
  r_ex_tip_value: "Valor por fragmento: la venta neta de la mejor opción ÷ {count}. Compáralo con lo que vale un fragmento por sí solo.",
};
if (typeof module !== "undefined" && module.exports)
  module.exports = { UI_STRINGS_ES_ROLLING_EXCHANGE };
