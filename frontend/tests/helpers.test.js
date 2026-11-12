import test from "node:test";
import assert from "node:assert/strict";
import { addDays, nights } from "../src/js/helpers.js";
test("checkout dates are exclusive across month and year boundaries", /* Verify date arithmetic across a year boundary. */ () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(nights("2026-12-31", "2027-01-02"), 2);
});
