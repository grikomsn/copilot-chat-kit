import assert from "node:assert/strict";
import test from "node:test";
import { costCategory, formatPrice, modelPricingFields } from "./pricing";

test("formats paid pricing with cached input when known", () => {
  assert.deepEqual(modelPricingFields({ input: 0.15, cacheRead: 0.08, output: 0.6 }), {
    pricing: "In: $0.15 · Cached: $0.08 · Out: $0.6 /1M tokens",
    inputCost: 15,
    outputCost: 60,
    cacheCost: 8,
    priceCategory: "low",
  });
  assert.equal(modelPricingFields({ input: 2, output: 8 })?.pricing, "In: $2 · Out: $8 /1M tokens");
  assert.equal(modelPricingFields(undefined), undefined);
});

test("marks free models and buckets categories", () => {
  assert.deepEqual(modelPricingFields({ input: 0, output: 0 }), { pricing: "Free", inputCost: 0, outputCost: 0, priceCategory: "low" });
  assert.deepEqual([{ input: 0.1, output: 0.4 }, { input: 3, output: 15 }, { input: 10, output: 20 }, { input: 15, output: 75 }].map(costCategory),
    ["low", "medium", "high", "very_high"]);
  assert.equal(formatPrice(0.000001), "0.000001");
  assert.equal(formatPrice(1.5), "1.5");
});
