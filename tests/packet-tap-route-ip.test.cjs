"use strict";

/**
 * outboundLocalIp() Windows route-table probe — pure parsing/selection halves.
 *
 * No child_process, no sockets, no os: the route-print output and the
 * network-interfaces shape are injected, so these tests only pin the contract
 * the live probe depends on — parse the 0.0.0.0/0.0.0.0 data rows (locale
 * headers are noise), sort by metric, and pick the first row whose interface
 * address is a real non-internal IPv4 address on this machine.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  parseDefaultRouteIps,
  matchRouteInterfaceIp,
} = require("../js/packet-tap.js");

// Verbatim shape of `route print -4 0.0.0.0` on the target machine (CRLF),
// with a subnet row and interface-list noise that must be ignored.
const ROUTE_PRINT_FIXTURE = [
  "===========================================================================",
  "Interface List",
  " 21...70 1a b8 18 48 a4 ......Intel(R) Wi-Fi 6 AX201 160MHz",
  "  1...........................Software Loopback Interface 1",
  "===========================================================================",
  "IPv4 Route Table",
  "===========================================================================",
  "Active Routes:",
  "Network Destination        Netmask          Gateway       Interface  Metric",
  "          0.0.0.0          0.0.0.0       10.36.24.5      10.36.24.70     50",
  "         10.36.24.0    255.255.255.0         On-link      10.36.24.70    281",
  "===========================================================================",
  "Persistent Routes:",
  "  None.",
].join("\r\n");

test("parseDefaultRouteIps reads the default route row from verbatim route print output", () => {
  assert.deepEqual(parseDefaultRouteIps(ROUTE_PRINT_FIXTURE), [
    { iface: "10.36.24.70", metric: 50 },
  ]);
});

test("parseDefaultRouteIps sorts multiple default routes by metric ascending", () => {
  const output = [
    "Network Destination        Netmask          Gateway       Interface  Metric",
    "          0.0.0.0          0.0.0.0       10.36.24.5      10.36.24.70     50",
    "          0.0.0.0          0.0.0.0      192.168.56.1     192.168.56.1     25",
    "          0.0.0.0          0.0.0.0         10.99.0.1      10.99.0.10    266",
  ].join("\r\n");
  assert.deepEqual(parseDefaultRouteIps(output), [
    { iface: "192.168.56.1", metric: 25 },
    { iface: "10.36.24.70", metric: 50 },
    { iface: "10.99.0.10", metric: 266 },
  ]);
});

test("parseDefaultRouteIps ignores localized header text and parses data rows only", () => {
  const output = [
    "===========================================================================",
    "Таблица маршрутов IPv4",
    "===========================================================================",
    "Активные маршруты:",
    "Сетевые назначение        Маска      Шлюз        Интерфейс  Метрика",
    "          0.0.0.0          0.0.0.0       10.36.24.5      10.36.24.70     50",
    "===========================================================================",
    "Постоянные маршруты:",
  ].join("\n");
  assert.deepEqual(parseDefaultRouteIps(output), [
    { iface: "10.36.24.70", metric: 50 },
  ]);
});

test("parseDefaultRouteIps returns [] when only subnet routes exist", () => {
  const output = [
    "Network Destination        Netmask          Gateway       Interface  Metric",
    "         10.36.24.0    255.255.255.0         On-link      10.36.24.70     50",
    "        192.168.56.0    255.255.255.0         On-link     192.168.56.1     25",
  ].join("\r\n");
  assert.deepEqual(parseDefaultRouteIps(output), []);
});

test("parseDefaultRouteIps survives garbage and empty input without throwing", () => {
  assert.deepEqual(parseDefaultRouteIps(""), []);
  assert.deepEqual(parseDefaultRouteIps("hello world\n===\n!!!"), []);
  assert.deepEqual(parseDefaultRouteIps(null), []);
  assert.deepEqual(parseDefaultRouteIps(undefined), []);
});

// os.networkInterfaces()-shaped fixtures (injected, never imported).
const BOTH_LISTED = {
  "Intel(R) Wi-Fi 6 AX201 160MHz": [
    { address: "fe80::1", family: "IPv6", internal: false },
    { address: "10.36.24.70", family: "IPv4", internal: false },
  ],
  "VirtualBox Host-Only Ethernet Adapter": [
    { address: "192.168.56.1", family: "IPv4", internal: false },
  ],
  "Loopback Pseudo-Interface 1": [
    { address: "127.0.0.1", family: "IPv4", internal: true },
  ],
};

test("matchRouteInterfaceIp returns the metric winner among listed interfaces", () => {
  // Deliberately NOT pre-sorted: the lower metric (25) must win even when it
  // sits later in the array.
  const entries = [
    { iface: "10.36.24.70", metric: 50 },
    { iface: "192.168.56.1", metric: 25 },
  ];
  assert.equal(matchRouteInterfaceIp(entries, BOTH_LISTED), "192.168.56.1");
});

test("matchRouteInterfaceIp falls to the only listed interface when the metric winner is absent", () => {
  const entries = [
    { iface: "10.36.24.70", metric: 50 },
    { iface: "192.168.56.1", metric: 25 },
  ];
  const onlyWifi = {
    "Intel(R) Wi-Fi 6 AX201 160MHz": [
      { address: "10.36.24.70", family: "IPv4", internal: false },
    ],
  };
  assert.equal(matchRouteInterfaceIp(entries, onlyWifi), "10.36.24.70");
});

test("matchRouteInterfaceIp skips addresses that are only internal (loopback)", () => {
  const entries = [{ iface: "127.0.0.1", metric: 1 }];
  const loopback = {
    "Loopback Pseudo-Interface 1": [
      { address: "127.0.0.1", family: "IPv4", internal: true },
    ],
  };
  assert.equal(matchRouteInterfaceIp(entries, loopback), null);
});

test("matchRouteInterfaceIp returns null with no route entries", () => {
  assert.equal(matchRouteInterfaceIp([], BOTH_LISTED), null);
});
