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

const { heroPointPopoverMarkup, heroPointSlotsMarkup, managerMarkup } = await import("../scripts/hero-points.js");

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
    assert.match(awardPanel, /title="Session: 1"/);
    assert.match(awardPanel, /<strong>S:<\/strong><span data-point-value="ephemeral">1/);
    assert.match(awardPanel, /title="Persistent: 1"/);
    assert.match(awardPanel, /<strong>P:<\/strong><span data-point-value="persistent">1/);
    assert.match(awardPanel, /title="Total: 2\/3"/);
    assert.match(awardPanel, /<strong>T:<\/strong><span><span data-point-value="total">2<\/span>\/3/);
    assert.match(markup, /Retired Hero/);
    assert.match(markup, /<details class="hero-points-roster-section hero-points-inactive-section"/);
    assert.doesNotMatch(markup, /hero-points-inactive-section"[^>]* open/);
});

test("character-sheet slots show session, persistent, and empty capacity", () => {
    const markup = heroPointSlotsMarkup({ ephemeral: 2, persistent: 1 }, 5);

    assert.equal((markup.match(/hero-points-slot-session/g) || []).length, 2);
    assert.equal((markup.match(/hero-points-slot-persistent/g) || []).length, 1);
    assert.equal((markup.match(/hero-points-slot-empty/g) || []).length, 2);
    assert.ok(markup.indexOf("slot-session") < markup.indexOf("slot-persistent"));
    assert.ok(markup.indexOf("slot-persistent") < markup.indexOf("slot-empty"));

    const maximumMarkup = heroPointSlotsMarkup({ ephemeral: 0, persistent: 0 }, 10);
    assert.equal((maximumMarkup.match(/hero-points-slot-empty/g) || []).length, 10);
});

test("character-sheet hover card labels each point pool beneath its capacity bars", () => {
    const markup = heroPointPopoverMarkup({ ephemeral: 2, persistent: 1 }, 5);

    assert.match(markup, /hero-points-popover-bars/);
    assert.equal((markup.match(/hero-points-slot-session/g) || []).length, 2);
    assert.equal((markup.match(/hero-points-slot-persistent/g) || []).length, 1);
    assert.equal((markup.match(/hero-points-slot-empty/g) || []).length, 2);
    assert.match(markup, /<strong>2<\/strong><span>Session<\/span>/);
    assert.match(markup, /<strong>1<\/strong><span>Persistent<\/span>/);
    assert.match(markup, /<strong>2<\/strong><span>Empty<\/span>/);
});
