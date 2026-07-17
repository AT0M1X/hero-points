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

const {
    awardNoChangeMessage,
    heroPointPopoverMarkup,
    heroPointSlotsMarkup,
    managerMarkup,
    sessionStartMarkup
} = await import("../scripts/hero-points.js");

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

    assert.match(markup, /<strong>Hero Points<\/strong>/);
    assert.match(markup, /Click to spend a hero point/);
    assert.match(markup, /hero-points-popover-bars/);
    assert.equal((markup.match(/hero-points-slot-session/g) || []).length, 2);
    assert.equal((markup.match(/hero-points-slot-persistent/g) || []).length, 1);
    assert.equal((markup.match(/hero-points-slot-empty/g) || []).length, 2);
    assert.match(markup, /<strong>2<\/strong><span>Session<\/span>/);
    assert.match(markup, /<strong>1<\/strong><span>Persistent<\/span>/);
    assert.match(markup, /<strong>2<\/strong><span>Empty<\/span>/);
});

test("character-sheet hover card renders session and persistent spend confirmations", () => {
    const sessionMarkup = heroPointPopoverMarkup(
        { ephemeral: 1, persistent: 1 },
        3,
        { type: "ephemeral" }
    );
    const persistentMarkup = heroPointPopoverMarkup(
        { ephemeral: 0, persistent: 1 },
        3,
        { type: "persistent" }
    );

    assert.match(sessionMarkup, /Hero Point used!/);
    assert.match(sessionMarkup, /Session point · 2\/3 remaining/);
    assert.match(persistentMarkup, /Persistent point · 1\/3 remaining/);
});

test("character-sheet hover card renders an inline empty-pool confirmation", () => {
    const markup = heroPointPopoverMarkup(
        { ephemeral: 0, persistent: 0 },
        3,
        { type: "empty" }
    );

    assert.match(markup, /<strong>No points available<\/strong>/);
    assert.doesNotMatch(markup, /Hero Point used!/);
});

test("session start confirmation previews eligible and maximum characters", () => {
    const eligible = mockActor({
        id: "eligible-id",
        name: "Eligible Hero",
        hasPlayerOwner: true,
        persistent: 1,
        ephemeral: 1
    });
    const blocked = mockActor({
        id: "blocked-id",
        name: "Blocked Hero",
        hasPlayerOwner: true,
        persistent: 3
    });

    const markup = sessionStartMarkup([eligible, blocked], 3);

    assert.match(markup, /Ready for a new session\?/);
    assert.match(markup, /<strong>2<\/strong><span>In use<\/span>/);
    assert.match(markup, /<strong>1<\/strong><span>Receive point<\/span>/);
    assert.match(markup, /<strong>1<\/strong><span>At maximum<\/span>/);
    assert.match(markup, /Session points/);
    assert.match(markup, /Set to 1/);
    assert.match(markup, /Persistent points/);
    assert.match(markup, /Unchanged/);
});

test("award no-change feedback describes the attempted operation", () => {
    assert.equal(awardNoChangeMessage("add", 1), "Already at maximum");
    assert.equal(awardNoChangeMessage("add", -1), "Already at zero");
    assert.equal(awardNoChangeMessage("add", 0), "No change requested");
    assert.equal(awardNoChangeMessage("set", 2), "Already at that value");
});
