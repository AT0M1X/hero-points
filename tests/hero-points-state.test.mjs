import assert from "node:assert/strict";
import test from "node:test";

import {
    addHeroPoints,
    getHeroPointTotal,
    normalizeHeroPointState,
    resetEphemeralHeroPoint,
    resolveRosterStatus,
    setHeroPoints,
    spendHeroPoint
} from "../scripts/hero-points-state.js";

test("roster status preserves explicit choices and otherwise follows player ownership", () => {
    assert.equal(resolveRosterStatus(true, false), true);
    assert.equal(resolveRosterStatus(false, true), false);
    assert.equal(resolveRosterStatus(undefined, true), true);
    assert.equal(resolveRosterStatus(undefined, false), false);
});

test("normalization preserves persistent points before ephemeral points", () => {
    assert.deepEqual(
        normalizeHeroPointState({ persistent: 2, ephemeral: 2 }, 3),
        { persistent: 2, ephemeral: 1 }
    );
    assert.equal(getHeroPointTotal({ persistent: 2, ephemeral: 2 }, 3), 3);
});

test("spending uses ephemeral points before persistent points", () => {
    const first = spendHeroPoint({ persistent: 2, ephemeral: 1 }, 3);
    assert.equal(first.spent, "ephemeral");
    assert.deepEqual(first.state, { persistent: 2, ephemeral: 0 });

    const second = spendHeroPoint(first.state, 3);
    assert.equal(second.spent, "persistent");
    assert.deepEqual(second.state, { persistent: 1, ephemeral: 0 });
});

test("a persistent award replaces ephemeral points at the maximum", () => {
    assert.deepEqual(
        addHeroPoints({ persistent: 2, ephemeral: 1 }, "persistent", 1, 3),
        { persistent: 3, ephemeral: 0 }
    );
});

test("persistent awards clamp when neither capacity nor ephemeral points remain", () => {
    assert.deepEqual(
        addHeroPoints({ persistent: 2, ephemeral: 1 }, "persistent", 5, 3),
        { persistent: 3, ephemeral: 0 }
    );
});

test("ephemeral awards never displace persistent points or exceed the maximum", () => {
    assert.deepEqual(
        addHeroPoints({ persistent: 2, ephemeral: 0 }, "ephemeral", 5, 3),
        { persistent: 2, ephemeral: 1 }
    );
});

test("setting persistent points displaces ephemeral points when needed", () => {
    assert.deepEqual(
        setHeroPoints({ persistent: 1, ephemeral: 2 }, "persistent", 3, 3),
        { persistent: 3, ephemeral: 0 }
    );
});

test("setting ephemeral points leaves persistent points intact", () => {
    assert.deepEqual(
        setHeroPoints({ persistent: 2, ephemeral: 0 }, "ephemeral", 3, 3),
        { persistent: 2, ephemeral: 1 }
    );
});

test("session start resets ephemeral points to one when capacity remains", () => {
    assert.deepEqual(
        resetEphemeralHeroPoint({ persistent: 2, ephemeral: 0 }, 3),
        { persistent: 2, ephemeral: 1 }
    );
    assert.deepEqual(
        resetEphemeralHeroPoint({ persistent: 3, ephemeral: 0 }, 3),
        { persistent: 3, ephemeral: 0 }
    );
    assert.deepEqual(
        resetEphemeralHeroPoint({ persistent: 0, ephemeral: 3 }, 3),
        { persistent: 0, ephemeral: 1 }
    );
});
