import assert from "node:assert/strict";
import test from "node:test";

globalThis.Hooks = {
    once() {},
    on() {}
};

globalThis.game = {
    settings: {
        get: () => 3
    }
};

const { managerMarkup } = await import("../scripts/hero-points.js");

function mockActor({ id, name, hasPlayerOwner, inUse, persistent = 0, ephemeral = 0 }) {
    return {
        id,
        name,
        type: "character",
        hasPlayerOwner,
        getFlag(_moduleId, key) {
            if (key === "inUse") return inUse;
            if (key === "state") return { persistent, ephemeral };
            return undefined;
        }
    };
}

test("manager separates award and roster concerns", () => {
    const active = mockActor({
        id: "active-id",
        name: "Active Hero",
        hasPlayerOwner: true,
        persistent: 1,
        ephemeral: 1
    });
    const inactive = mockActor({
        id: "inactive-id",
        name: "Retired Hero",
        hasPlayerOwner: false,
        persistent: 2
    });

    const markup = managerMarkup([active, inactive], 3);
    const awardPanel = markup.slice(
        markup.indexOf('data-panel="award"'),
        markup.indexOf('data-panel="roster"')
    );

    assert.match(markup, /Award Points/);
    assert.match(markup, /Manage Roster/);
    assert.match(markup, /Start Session/);
    assert.match(awardPanel, /Active Hero/);
    assert.doesNotMatch(awardPanel, /Retired Hero/);
    assert.match(markup, /Retired Hero/);
    assert.match(markup, /<details class="hero-points-roster-section hero-points-inactive-section"/);
    assert.doesNotMatch(markup, /hero-points-inactive-section"[^>]* open/);
});
