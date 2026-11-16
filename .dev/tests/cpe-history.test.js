import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../src/resource/view/shadcn/cpe.js", import.meta.url),
  "utf8",
);
const mergeHistory = new Function(
  "rpc",
  source.slice(0, source.indexOf("return view.extend(")) +
    "\nreturn mergeHistory;",
)({ declare: () => () => {} });
test("opening the panel restores the last 60 server samples", () => {
  const samples = Array.from({ length: 100 }, (_, i) => ({
    time: 9000 + i * 10,
    rx: i,
    tx: i * 2,
  }));
  const restored = mergeHistory([], samples, 10000);
  assert.equal(restored.length, 60);
  assert.equal(restored[0].time, 9400);
  assert.equal(restored[59].time, 9990);
});
test("refreshing merges duplicate timestamps without restarting the chart", () => {
  const merged = mergeHistory(
    [
      { time: 9970, rx: 1, tx: 2 },
      { time: 9980, rx: 3, tx: 4 },
    ],
    [
      { time: 9980, rx: 5, tx: 6 },
      { time: 9990, rx: 7, tx: 8 },
    ],
    10000,
  );
  assert.deepEqual(merged, [
    { time: 9970, rx: 1, tx: 2 },
    { time: 9980, rx: 5, tx: 6 },
    { time: 9990, rx: 7, tx: 8 },
  ]);
});
test("bad and expired samples are dropped and gaps are preserved", () => {
  const result = mergeHistory(
    [],
    [
      null,
      { time: 5000, rx: 1, tx: 1 },
      { time: 11000, rx: 1, tx: 1 },
      { time: 9999, rx: -1, tx: 1 },
      { time: 9990, rx: NaN, tx: 1 },
      { time: 9900, rx: 1, tx: 2 },
      { time: 9990, rx: 3, tx: 4 },
    ],
    10000,
  );
  assert.deepEqual(result, [
    { time: 9900, rx: 1, tx: 2 },
    { time: 9990, rx: 3, tx: 4 },
  ]);
});
