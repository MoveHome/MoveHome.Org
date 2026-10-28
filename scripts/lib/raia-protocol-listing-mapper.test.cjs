"use strict";
// node --test scripts/lib/raia-protocol-listing-mapper.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalisePropertyType } = require("./raia-protocol-listing-mapper.cjs");

test("RAIA free-text property types land inside MoveHome's enum", () => {
  assert.equal(normalisePropertyType("Flat"), "flat");
  assert.equal(normalisePropertyType(" HOUSE "), "house");
  assert.equal(normalisePropertyType("studio"), "studio");
  assert.equal(normalisePropertyType("apartment"), "other"); // honest bucket, never invented
  assert.equal(normalisePropertyType(null), null);
});
