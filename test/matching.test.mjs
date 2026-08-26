import assert from "node:assert/strict";
import test from "node:test";
import { calculateMatch } from "../matching.mjs";

const wallet = {
  category: "Accessories",
  location: "Central Library",
  color: "Black",
  brand: "Wildhorn",
  reported_date: "2026-08-19",
};

test("awards a transparent 100-point score for matching report details", () => {
  const result = calculateMatch(wallet, { ...wallet, category: " accessories " });
  assert.equal(result.score, 100);
  assert.deepEqual(result.reasons, ["same category", "same location", "same color", "same brand", "reported within 3 days"]);
});

test("rewards partial matches without guessing missing details", () => {
  const result = calculateMatch(wallet, {
    category: "Accessories",
    location: "Block A",
    color: "",
    brand: "",
    reported_date: "2026-08-28",
  });
  assert.equal(result.score, 35);
  assert.deepEqual(result.reasons, ["same category", "reported within 2 weeks"]);
});
