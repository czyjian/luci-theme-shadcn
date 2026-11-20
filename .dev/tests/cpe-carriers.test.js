import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../src/resource/view/shadcn/cpe.js", import.meta.url),
  "utf8",
);
const { isp, bands, bandwidth, carrierIds } = new Function(
  "rpc",
  source.slice(0, source.indexOf("return view.extend(")) +
    "\nreturn { isp, bands, bandwidth, carrierIds };",
)({ declare: () => () => {} });
const data = (entries) => ({
  modem_info: entries.map(([key, value, extra_info]) => ({
    key,
    value,
    extra_info,
  })),
});

test("Quectel combined base fields do not repeat CA values", () => {
  const cell = data([
    ["network_mode", "NR5G-SA Mode with 2 CA"],
    ["Band", "41 / 28"],
    ["Band (CA)", "28", "CA-NR"],
    ["Physical Cell ID", "245 / 792"],
    ["Physical Cell ID (CA)", "792"],
    ["ARFCN", "504990 / 152650"],
    ["ARFCN (CA)", "152650"],
    ["DL Bandwidth", "100 / 20"],
    ["DL Bandwidth (CA)", "20"],
    ["UL Bandwidth", "100"],
  ]);
  assert.equal(bands(cell), "n41 / n28");
  assert.equal(bandwidth(cell, "DL"), "100+20");
  assert.equal(bandwidth(cell, "UL"), "100");
  assert.equal(carrierIds(cell, "Physical Cell ID"), "245 + 792");
  assert.equal(carrierIds(cell, "ARFCN"), "504990 + 152650");
});
test("separate CA records preserve repeated bandwidths and mixed LTE/NR bands", () => {
  const cell = data([
    ["network_mode", "NR5G-NSA"],
    ["Band", "3", "LTE"],
    ["Band (CA)", "78", "CA-NR"],
    ["Band (CA)", "1", "CA-LTE"],
    ["DL Bandwidth", "20"],
    ["DL Bandwidth (CA)", "100"],
    ["DL Bandwidth (CA)", "20"],
    ["UL Bandwidth", "-"],
    ["UL Bandwidth (CA)", ""],
  ]);
  assert.equal(bands(cell), "B3 / n78 / B1");
  assert.equal(bandwidth(cell, "DL"), "20+100+20");
  assert.equal(bandwidth(cell, "UL"), "—");
  assert.equal(bands(data([["Band", "n41"]])), "n41");
});
test("mainland PLMNs and common module aliases produce bilingual names", () => {
  for (const [values, expected] of [
    [
      [
        "46000",
        "46002",
        "46004",
        "46007",
        "46008",
        "46013",
        "CHN-CMCC",
        "China Mobile",
        "中国移动通信",
      ],
      "中国移动（China Mobile）",
    ],
    [
      ["46001", "46006", "46009", "CHN-UNICOM", "CUCC", "China_Unicom"],
      "中国联通（China Unicom）",
    ],
    [
      ["46003", "46005", "46011", "CHN-CT", "CHN-CTCC", "CT", "China Telecom"],
      "中国电信（China Telecom）",
    ],
    [
      ["46015", "CBN", "China Broadnet", "中国广电"],
      "中国广电（China Broadnet）",
    ],
  ])
    for (const value of values) assert.equal(isp(value), expected, value);
  assert.equal(isp('"460 00"'), "中国移动（China Mobile）");
  assert.equal(isp("460-11 LTE"), "中国电信（China Telecom）");
  assert.equal(isp("中国移动（China Mobile）"), "中国移动（China Mobile）");
  const hex = Array.from("中国电信")
    .map((c) => c.charCodeAt(0).toString(16).padStart(4, "0"))
    .join("");
  assert.equal(isp(hex + "0000"), "中国电信（China Telecom）");
  assert.equal(isp("???", "460", "0"), "中国移动（China Mobile）");
  assert.equal(isp("Unknown", "460", "00"), "Unknown");
  assert.equal(isp("310260"), "310260");
  assert.equal(isp("46099"), "46099");
});
