import {
    addHeroPoints,
    getHeroPointTotal,
    normalizeHeroPointState,
    resetEphemeralHeroPoint,
    setHeroPoints,
    spendHeroPoint
} from "./hero-points-state.js";

const MODULE_ID = "hero-points";
const STATE_FLAG = "state";
const IN_USE_FLAG = "inUse";

/* ----------------- HELPERS ----------------- */

function log(...args) {
    console.log(`${MODULE_ID} |`, ...args);
}

function getMaxHeroPoints() {
    return game.settings.get(MODULE_ID, "maxPoints");
}

function getHeroPointState(actor) {
    const max = getMaxHeroPoints();
    const storedState = actor.getFlag(MODULE_ID, STATE_FLAG);

    if (storedState !== undefined) {
        return normalizeHeroPointState(storedState, max);
    }

    // Versions before 0.2.0 stored a single total. Preserve it as persistent.
    const legacyPoints = Number(actor.getFlag(MODULE_ID, "points")) || 0;
    return normalizeHeroPointState({ persistent: legacyPoints, ephemeral: 0 }, max);
}

async function setHeroPointState(actor, state) {
    const normalized = normalizeHeroPointState(state, getMaxHeroPoints());
    await actor.setFlag(MODULE_ID, STATE_FLAG, normalized);
    return normalized;
}

function isActorInUse(actor) {
    return actor.getFlag(MODULE_ID, IN_USE_FLAG) !== false;
}

function getPlayerCharacters() {
    return game.actors
        .filter((actor) => actor.type === "character" && actor.hasPlayerOwner)
        .sort((left, right) => left.name.localeCompare(right.name));
}

function heroPointTooltip(state) {
    return `Click to spend a hero point. Session: ${state.ephemeral}; persistent: ${state.persistent}.`;
}

function statesMatch(left, right) {
    return left.persistent === right.persistent && left.ephemeral === right.ephemeral;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

async function migrateLegacyHeroPoints() {
    if (!game.user.isGM) return;

    const actors = game.actors.filter((actor) => actor.type === "character");
    for (const actor of actors) {
        if (actor.getFlag(MODULE_ID, STATE_FLAG) !== undefined) continue;
        await setHeroPointState(actor, getHeroPointState(actor));
    }
}

/**
 * Send a chat message that respects the current roll mode.
 */
function sendChatWithRollMode({ content, speaker }) {
    const rollMode = game.settings.get("core", "rollMode");

    const data = {
        content,
        speaker: speaker || ChatMessage.getSpeaker()
    };

    switch (rollMode) {
        case "gmroll":
            data.whisper = ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
            break;
        case "blindroll":
            data.whisper = ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
            data.blind = true;
            break;
        case "selfroll":
            data.whisper = [game.user.id];
            break;
        // public → default
    }

    return ChatMessage.create(data);
}

/* ------------- HERO POINTS WIDGET ------------- */

function createHeroPointsElement(actor) {
    const max = getMaxHeroPoints();
    const state = getHeroPointState(actor);
    const current = getHeroPointTotal(state, max);
    const tooltip = heroPointTooltip(state);

    const html = `
    <div class="hero-points-counter" data-actor-id="${actor.id}" title="${tooltip}">
      <a class="hero-points-use" data-action="use-hero-point">
        <i class="fas fa-star hero-points-icon"></i>
        <span class="hero-points-value">${current}</span>
        <span class="hero-points-max">/${max}</span>
      </a>
    </div>
  `;

    return $(html);
}

function attachHeroPointsListeners(sheet, root) {
    const actor = sheet.actor;
    const counter = root.find(".hero-points-counter");
    if (!counter.length) {
        log("attachHeroPointsListeners: no .hero-points-counter found");
        return;
    }

    const valueSpan = counter.find(".hero-points-value");
    const useButton = counter.find(".hero-points-use");
    const max = getMaxHeroPoints();

    function syncDisplay(state) {
        valueSpan.text(getHeroPointTotal(state, max));
        counter.attr("title", heroPointTooltip(state));
    }

    // Spend hero point (any owner can do this)
    useButton.on("click", async (event) => {
        event.preventDefault();

        const result = spendHeroPoint(getHeroPointState(actor), max);
        if (!result.spent) {
            ui.notifications?.warn("No hero points left.");
            return;
        }

        const state = await setHeroPointState(actor, result.state);
        syncDisplay(state);

        const speaker = ChatMessage.getSpeaker({ actor });
        const pointType = result.spent === "ephemeral" ? "session" : "persistent";
        await sendChatWithRollMode({
            speaker,
            content: `<p><strong>${escapeHtml(actor.name)}</strong> uses a ${pointType} hero point!</p>`
        });
    });
}


/* ----------------- MASS AWARD DIALOG ----------------- */

function openHeroPointsDialog() {
    const max = getMaxHeroPoints();
    const actors = getPlayerCharacters();
    const allActorsInUse = actors.every(isActorInUse);

    if (!actors.length) {
        ui.notifications?.warn("No player-owned characters found.");
        return;
    }

    let content = `<form class="hero-points-dialog">
    <p>Select characters, choose which point pool to modify, and add or set its value.</p>

    <div class="form-group hero-points-mode">
      <label><input type="radio" name="mode" value="add" checked> Add</label>
      <label><input type="radio" name="mode" value="set"> Set</label>
    </div>

    <div class="form-group hero-points-kind">
      <label><input type="radio" name="kind" value="persistent" checked> Persistent</label>
      <label><input type="radio" name="kind" value="ephemeral"> Session (ephemeral)</label>
    </div>

    <div class="form-group">
      <label>Amount</label>
      <input type="number" name="amount" value="1" min="-${max}" max="${max}">
    </div>

    <div class="form-group hero-points-selection-actions">
      <span>Select:</span>
      <button type="button" data-select-group="in-use">In use</button>
      <button type="button" data-select-group="inactive">Not in use</button>
      <button type="button" data-select-group="all">All</button>
      <button type="button" data-select-group="none">None</button>
    </div>

    <p class="notes">Changing an In use checkbox saves immediately. Session start only affects in-use characters.</p>

    <table class="hero-points-actor-list">
      <thead>
        <tr>
          <th><input type="checkbox" class="hero-points-select-all" ${allActorsInUse ? "checked" : ""}></th>
          <th>Character</th>
          <th>In use</th>
          <th>Session</th>
          <th>Persistent</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
  `;

    for (const actor of actors) {
        const state = getHeroPointState(actor);
        const total = getHeroPointTotal(state, max);
        const inUse = isActorInUse(actor);
        content += `
      <tr data-actor-id="${actor.id}" data-in-use="${inUse}">
        <td><input type="checkbox" name="actor" value="${actor.id}" ${inUse ? "checked" : ""}></td>
        <td>${escapeHtml(actor.name)}</td>
        <td><input type="checkbox" class="hero-points-in-use" data-actor-id="${actor.id}" ${inUse ? "checked" : ""}></td>
        <td>${state.ephemeral}</td>
        <td>${state.persistent}</td>
        <td>${total}/${max}</td>
      </tr>
    `;
    }

    content += `
      </tbody>
    </table>
  </form>`;

    new Dialog({
        title: "Adjust Hero Points",
        content,
        buttons: {
            apply: {
                label: "Apply",
                icon: '<i class="fas fa-check"></i>',
                callback: async (html) => {
                    const form = html[0].querySelector("form.hero-points-dialog");
                    if (!form) return;

                    const formData = new FormData(form);
                    const mode = formData.get("mode") || "add";
                    const kind = formData.get("kind") || "persistent";
                    const amount = Number(formData.get("amount") || 0);

                    const checkboxes = form.querySelectorAll("input[name='actor']:checked");
                    const actorIds = Array.from(checkboxes).map((i) => i.value);

                    if (!actorIds.length) {
                        ui.notifications?.warn("Select at least one character.");
                        return;
                    }

                    const maxPoints = getMaxHeroPoints();
                    const affectedNames = [];

                    for (const id of actorIds) {
                        const actor = game.actors.get(id);
                        if (!actor) continue;

                        const current = getHeroPointState(actor);
                        const next = mode === "set"
                            ? setHeroPoints(current, kind, amount, maxPoints)
                            : addHeroPoints(current, kind, amount, maxPoints);

                        if (statesMatch(current, next)) continue;
                        await setHeroPointState(actor, next);
                        affectedNames.push(actor.name);
                    }

                    if (!affectedNames.length) {
                        ui.notifications?.warn("The selected hero-point values were already at their limits.");
                        return;
                    }

                    const verb = mode === "set" ? "set to" : "modified by";
                    const list = affectedNames.map(escapeHtml).join(", ");
                    const pool = kind === "ephemeral" ? "Session hero points" : "Persistent hero points";
                    const msgContent = `<p>${pool} for <strong>${list}</strong> ${verb} <strong>${amount}</strong>.</p>`;

                    await sendChatWithRollMode({
                        content: msgContent,
                        speaker: ChatMessage.getSpeaker({ user: game.user })
                    });
                }
            },
            cancel: {
                label: "Cancel"
            }
        },
        default: "apply",
        render: (html) => {
            const selectAll = html.find(".hero-points-select-all");

            function setActorSelections(predicate) {
                const rows = html.find(".hero-points-actor-list tbody tr");
                rows.each((_index, rowElement) => {
                    const row = $(rowElement);
                    const selected = predicate(row);
                    row.find("input[name='actor']").prop("checked", selected);
                });
                selectAll.prop("checked", rows.length > 0 && rows.find("input[name='actor']:not(:checked)").length === 0);
            }

            selectAll.on("change", (event) => {
                const checked = event.currentTarget.checked;
                html.find("input[name='actor']").prop("checked", checked);
            });

            html.find("input[name='actor']").on("change", () => {
                const actorCheckboxes = html.find("input[name='actor']");
                selectAll.prop("checked", actorCheckboxes.length > 0 && actorCheckboxes.filter(":not(:checked)").length === 0);
            });

            html.find("[data-select-group]").on("click", (event) => {
                event.preventDefault();
                const group = event.currentTarget.dataset.selectGroup;

                if (group === "all") setActorSelections(() => true);
                else if (group === "none") setActorSelections(() => false);
                else if (group === "in-use") setActorSelections((row) => row.attr("data-in-use") === "true");
                else if (group === "inactive") setActorSelections((row) => row.attr("data-in-use") === "false");
            });

            html.find(".hero-points-in-use").on("change", async (event) => {
                const checkbox = $(event.currentTarget);
                const actor = game.actors.get(event.currentTarget.dataset.actorId);
                if (!actor) return;

                const inUse = event.currentTarget.checked;
                checkbox.prop("disabled", true);

                try {
                    await actor.setFlag(MODULE_ID, IN_USE_FLAG, inUse);
                    checkbox.closest("tr").attr("data-in-use", String(inUse));
                } catch (error) {
                    event.currentTarget.checked = !inUse;
                    ui.notifications?.error(`Could not update ${actor.name}'s roster status.`);
                    console.error(`${MODULE_ID} | Could not update roster status:`, error);
                } finally {
                    checkbox.prop("disabled", false);
                }
            });
        }
    }).render(true);
}

function openSessionStartDialog() {
    const actors = getPlayerCharacters().filter(isActorInUse);

    if (!actors.length) {
        ui.notifications?.warn("No in-use player characters found.");
        return;
    }

    new Dialog({
        title: "Start Hero Point Session",
        content: `<p>Reset session hero points to <strong>1</strong> for ${actors.length} in-use character${actors.length === 1 ? "" : "s"}? Persistent points will not change, and characters already at the maximum with persistent points will not receive a session point.</p>`,
        buttons: {
            start: {
                label: "Start Session",
                icon: '<i class="fas fa-play"></i>',
                callback: async () => {
                    const max = getMaxHeroPoints();
                    const resetNames = [];
                    const atMaximumNames = [];

                    for (const actor of actors) {
                        const current = getHeroPointState(actor);
                        const next = resetEphemeralHeroPoint(current, max);

                        if (next.ephemeral === 0 && next.persistent >= max) {
                            atMaximumNames.push(actor.name);
                        } else {
                            resetNames.push(actor.name);
                        }

                        if (!statesMatch(current, next)) {
                            await setHeroPointState(actor, next);
                        }
                    }

                    const paragraphs = [];
                    if (resetNames.length) {
                        paragraphs.push(`<p>Session hero points reset to <strong>1</strong> for <strong>${resetNames.map(escapeHtml).join(", ")}</strong>.</p>`);
                    }
                    if (atMaximumNames.length) {
                        paragraphs.push(`<p>No session point was added for <strong>${atMaximumNames.map(escapeHtml).join(", ")}</strong> because their persistent points are at the maximum.</p>`);
                    }

                    await sendChatWithRollMode({
                        content: paragraphs.join(""),
                        speaker: ChatMessage.getSpeaker({ user: game.user })
                    });
                }
            },
            cancel: {
                label: "Cancel"
            }
        },
        default: "start"
    }).render(true);
}

/* ----------------- INJECTION LOGIC ----------------- */

function injectHeroPointsGeneric(sheet, element, meta = {}) {
    try {
        const hookName = meta.hook ?? "(unknown hook)";

        log("injectHeroPointsGeneric called from hook:", hookName, "| sheet:", sheet.constructor?.name);

        if (game.system.id !== "dnd5e") {
            log("Not dnd5e, aborting.");
            return;
        }

        const actor = sheet.actor;
        if (!actor) {
            log("No actor on sheet, aborting.");
            return;
        }

        if (actor.type !== "character") {
            log("Actor is not a character:", actor.type);
            return;
        }

        // Sanity check for inspiration attribute existing
        if (actor.system?.attributes?.inspiration === undefined) {
            log("Actor has no system.attributes.inspiration, aborting.");
            return;
        }

        // Wrap HTMLElement in jQuery
        const html = element instanceof jQuery ? element : $(element);
        if (!html.length) {
            log("HTML root is empty, aborting.");
            return;
        }

        // Try to hide the big inspiration medallion in the header
        const inspMedal = html.find(
            '.sheet-header [data-application-action="inspiration"], ' +
            '.sheet-header [data-action="inspiration"], ' +
            '.sheet-header [data-tooltip*="Inspiration"], ' +
            '.sheet-header [aria-label*="Inspiration"]'
        ).first();

        if (inspMedal.length) {
            log("Hiding inspiration medallion:", inspMedal[0]);
            inspMedal.hide();
        }

        // Remove previous widget on re-render
        html.find(".hero-points-counter").remove();

        let anchor = null;

        // --- Primary target: header inspiration star button ---
        let starIcon = html.find(".sheet-header button i.fa-star").first();
        if (starIcon.length) {
            const starButton = starIcon.closest("button");
            if (starButton.length) {
                log("Found header inspiration star button:", starButton[0]);
                starButton.hide();          // hide original inspiration control
                anchor = starButton;
            }
        }

        // (Optional) other searches for legacy inspiration UI could go here
        // but for v3.3.1 the header star is the main one we care about.

        // Fallback header area if we didn't find a star button
        if (!anchor || !anchor.length) {
            anchor = html.find(".sheet-header .attributes, .sheet-header .resources, .sheet-header .summary").first();
            if (!anchor.length) {
                anchor = html.find(".sheet-header").first();
            }
            if (anchor.length) {
                log("Using fallback header anchor:", anchor[0]);
            } else {
                log("No suitable anchor found; hero points widget not injected.");
                return;
            }
        }

        const canEdit = game.user.isGM;
        const heroEl = createHeroPointsElement(actor, canEdit);

        // If anchor is one of the header containers, append; otherwise insert after
        if (
            anchor.hasClass("sheet-header") ||
            anchor.hasClass("attributes") ||
            anchor.hasClass("resources") ||
            anchor.hasClass("summary")
        ) {
            anchor.append(heroEl);
        } else {
            heroEl.insertAfter(anchor);
        }

        log("Hero points widget injected for actor:", actor.name);

        attachHeroPointsListeners(sheet, html);
    } catch (err) {
        console.error(`${MODULE_ID} | Error in injectHeroPointsGeneric:`, err);
    }
}

/* ------------------------ HOOKS ------------------------ */

Hooks.once("init", () => {
    log("Initializing hero points module");

    game.settings.register(MODULE_ID, "maxPoints", {
        name: "Maximum hero points",
        hint: "Maximum number of hero points a character can store.",
        scope: "world",
        config: true,
        type: Number,
        default: 3,
        range: { min: 1, max: 10, step: 1 }
    });
});

Hooks.once("ready", async () => {
    log("Ready. System:", game.system.id, "version:", game.system.version);

    try {
        await migrateLegacyHeroPoints();
    } catch (error) {
        console.error(`${MODULE_ID} | Could not migrate legacy hero points:`, error);
        ui.notifications?.error("Hero Points could not migrate existing point totals. See the console for details.");
    }
});

/**
 * Use the V2 sheet hook for DnD5e 3.x.
 */
Hooks.on("renderActorSheetV2", (sheet, element, data) => {
    injectHeroPointsGeneric(sheet, element, { hook: "renderActorSheetV2" });
});

/**
 * GM button in the Actor directory footer.
 */
Hooks.on("renderActorDirectory", (app, html, data) => {
    if (!game.user.isGM) return;

    const footer = html.find(".directory-footer");
    if (!footer.length) return;

    if (!footer.find(".hero-points-session-start").length) {
        const sessionButton = $(`
      <button type="button" class="hero-points-session-start">
        <i class="fas fa-play"></i> Start Session
      </button>
    `);

        sessionButton.on("click", (event) => {
            event.preventDefault();
            openSessionStartDialog();
        });

        footer.append(sessionButton);
    }

    if (!footer.find(".hero-points-give-all").length) {
        const manageButton = $(`
      <button type="button" class="hero-points-give-all">
        <i class="fas fa-star"></i> Hero Points
      </button>
    `);

        manageButton.on("click", (event) => {
            event.preventDefault();
            openHeroPointsDialog();
        });

        footer.append(manageButton);
    }

    log("Added GM Hero Points controls to Actor directory.");
});
