import {
    addHeroPoints,
    getHeroPointTotal,
    normalizeHeroPointState,
    resetEphemeralHeroPoint,
    resolveRosterStatus,
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
    return resolveRosterStatus(actor.getFlag(MODULE_ID, IN_USE_FLAG), actor.hasPlayerOwner);
}

function getCharacterRoster() {
    return game.actors
        .filter((actor) => actor.type === "character")
        .sort((left, right) => left.name.localeCompare(right.name));
}

function heroPointTooltip(state, max) {
    const total = getHeroPointTotal(state, max);
    const empty = Math.max(0, max - total);
    const nextPoint = state.ephemeral > 0 ? "session" : "persistent";
    const action = total > 0 ? `Click to spend a ${nextPoint} point.` : "No hero points available.";
    return `Hero points: ${total}/${max}. Session: ${state.ephemeral}; persistent: ${state.persistent}; empty: ${empty}. ${action}`;
}

export function heroPointSlotsMarkup(state, maximum) {
    const max = Math.max(0, Math.trunc(Number(maximum) || 0));
    const normalized = normalizeHeroPointState(state, max);
    const slots = [];

    for (let index = 0; index < normalized.ephemeral; index += 1) {
        slots.push('<span class="hero-points-slot hero-points-slot-session"></span>');
    }
    for (let index = 0; index < normalized.persistent; index += 1) {
        slots.push('<span class="hero-points-slot hero-points-slot-persistent"></span>');
    }
    for (let index = normalized.ephemeral + normalized.persistent; index < max; index += 1) {
        slots.push('<span class="hero-points-slot hero-points-slot-empty"></span>');
    }

    return slots.join("");
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
        if (actor.getFlag(MODULE_ID, STATE_FLAG) === undefined) {
            await setHeroPointState(actor, getHeroPointState(actor));
        }
        if (actor.getFlag(MODULE_ID, IN_USE_FLAG) === undefined) {
            await actor.setFlag(MODULE_ID, IN_USE_FLAG, actor.hasPlayerOwner);
        }
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
    const tooltip = heroPointTooltip(state, max);

    const html = `
    <div class="hero-points-counter" data-actor-id="${actor.id}" title="${tooltip}">
      <a class="hero-points-use" data-action="use-hero-point" aria-label="${tooltip}">
        <i class="fas fa-star hero-points-icon"></i>
        <span class="hero-points-number">
          <span class="hero-points-value">${current}</span><span class="hero-points-max">/${max}</span>
        </span>
        <span class="hero-points-slots" aria-hidden="true">${heroPointSlotsMarkup(state, max)}</span>
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
    const slots = counter.find(".hero-points-slots");
    const max = getMaxHeroPoints();

    function syncDisplay(state) {
        const tooltip = heroPointTooltip(state, max);
        valueSpan.text(getHeroPointTotal(state, max));
        slots.html(heroPointSlotsMarkup(state, max));
        counter.attr("title", tooltip);
        useButton.attr("aria-label", tooltip);
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

function awardRowMarkup(actor, max) {
    const state = getHeroPointState(actor);
    const total = getHeroPointTotal(state, max);

    return `
    <div class="hero-points-award-row" data-actor-id="${actor.id}" data-sort-name="${escapeHtml(actor.name.toLocaleLowerCase())}">
      <label class="hero-points-award-selection">
        <input type="checkbox" name="actor" value="${actor.id}" checked>
        <span class="hero-points-character-name">${escapeHtml(actor.name)}</span>
      </label>
      <span class="hero-points-point-summary" aria-label="Session ${state.ephemeral}, persistent ${state.persistent}, total ${total} of ${max}">
        <span class="hero-points-summary-pill hero-points-summary-session" title="Session: ${state.ephemeral}">
          <strong>S:</strong><span data-point-value="ephemeral">${state.ephemeral}</span>
        </span>
        <span class="hero-points-summary-pill hero-points-summary-persistent" title="Persistent: ${state.persistent}">
          <strong>P:</strong><span data-point-value="persistent">${state.persistent}</span>
        </span>
        <span class="hero-points-summary-pill hero-points-summary-total" title="Total: ${total}/${max}">
          <strong>T:</strong><span><span data-point-value="total">${total}</span>/${max}</span>
        </span>
      </span>
    </div>`;
}

function rosterRowMarkup(actor, inUse) {
    const targetInUse = !inUse;
    const actionLabel = inUse ? "Move out" : "Move in";
    const actionIcon = inUse ? "fa-arrow-down" : "fa-arrow-up";

    return `
    <div class="hero-points-roster-row" draggable="true" data-actor-id="${actor.id}" data-sort-name="${escapeHtml(actor.name.toLocaleLowerCase())}">
      <span class="hero-points-drag-handle" title="Drag between roster sections"><i class="fas fa-grip-vertical"></i></span>
      <span class="hero-points-roster-name">${escapeHtml(actor.name)}</span>
      <button type="button" class="hero-points-roster-move" data-target-in-use="${targetInUse}">
        <i class="fas ${actionIcon}"></i> ${actionLabel}
      </button>
    </div>`;
}

export function managerMarkup(actors, max) {
    const inUseActors = actors.filter(isActorInUse);
    const inactiveActors = actors.filter((actor) => !isActorInUse(actor));
    const awardRows = inUseActors.map((actor) => awardRowMarkup(actor, max)).join("");
    const inUseRows = inUseActors.map((actor) => rosterRowMarkup(actor, true)).join("");
    const inactiveRows = inactiveActors.map((actor) => rosterRowMarkup(actor, false)).join("");

    return `<form class="hero-points-manager">
    <div class="hero-points-manager-summary">
      <div class="hero-points-maximum">
        <span>Maximum per character</span>
        <strong>${max}</strong>
      </div>
      <button type="button" class="hero-points-session-start">
        <i class="fas fa-play"></i> Start Session
      </button>
    </div>

    <nav class="hero-points-tabs" role="tablist" aria-label="Hero Points manager sections">
      <button type="button" class="active" role="tab" aria-selected="true" data-tab="award">
        <i class="fas fa-star"></i> Award Points
      </button>
      <button type="button" role="tab" aria-selected="false" data-tab="roster">
        <i class="fas fa-users"></i> Manage Roster
      </button>
    </nav>

    <section class="hero-points-tab-panel" role="tabpanel" data-panel="award">
      <div class="hero-points-award-controls">
        <fieldset>
          <legend>Point type</legend>
          <div class="hero-points-segmented-control">
            <label><input type="radio" name="kind" value="persistent" checked><span>Persistent</span></label>
            <label><input type="radio" name="kind" value="ephemeral"><span>Session</span></label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Amount</legend>
          <div class="hero-points-stepper">
            <button type="button" data-amount-step="-1" aria-label="Decrease amount"><i class="fas fa-minus"></i></button>
            <input type="number" name="amount" value="1" min="-${max}" max="${max}" aria-label="Point amount">
            <button type="button" data-amount-step="1" aria-label="Increase amount"><i class="fas fa-plus"></i></button>
          </div>
        </fieldset>
      </div>

      <details class="hero-points-advanced">
        <summary>Advanced adjustments</summary>
        <div class="hero-points-mode-options">
          <label><input type="radio" name="mode" value="add" checked> Add the amount</label>
          <label><input type="radio" name="mode" value="set"> Set the selected pool to the amount</label>
        </div>
      </details>

      <div class="hero-points-list-heading">
        <div>
          <h3>In-use characters</h3>
          <p><span data-award-count>${inUseActors.length}</span> available</p>
        </div>
        <div class="hero-points-list-actions">
          <button type="button" data-select-awards="all">Select all</button>
          <button type="button" data-select-awards="none">Clear</button>
        </div>
      </div>

      <div class="hero-points-award-list">
        ${awardRows}
        <p class="hero-points-empty ${inUseActors.length ? "" : "visible"}" data-empty-awards>No characters are currently in use.</p>
      </div>

      <div class="hero-points-award-footer">
        <span><strong data-selected-count>${inUseActors.length}</strong> selected</span>
        <button type="button" class="hero-points-apply-award" ${inUseActors.length ? "" : "disabled"}>
          <i class="fas fa-star"></i> Award Points
        </button>
      </div>
    </section>

    <section class="hero-points-tab-panel" role="tabpanel" data-panel="roster" hidden>
      <p class="hero-points-roster-help">Drag characters between sections or use the move buttons. Changes save immediately.</p>

      <section class="hero-points-roster-section" data-in-use="true">
        <header>
          <h3>In use</h3>
          <span class="hero-points-count" data-roster-count="true">${inUseActors.length}</span>
        </header>
        <div class="hero-points-roster-list" data-roster-list="true">
          ${inUseRows}
          <p class="hero-points-empty ${inUseActors.length ? "" : "visible"}" data-empty-roster="true">Drop characters here to add them to the active roster.</p>
        </div>
      </section>

      <details class="hero-points-roster-section hero-points-inactive-section" data-in-use="false">
        <summary>
          <span>Not in use</span>
          <span class="hero-points-count" data-roster-count="false">${inactiveActors.length}</span>
          <span class="hero-points-drop-hint">Drop here</span>
        </summary>
        <div class="hero-points-roster-list" data-roster-list="false">
          ${inactiveRows}
          <p class="hero-points-empty ${inactiveActors.length ? "" : "visible"}" data-empty-roster="false">No inactive characters.</p>
        </div>
      </details>
    </section>
  </form>`;
}

function openHeroPointsDialog() {
    const max = getMaxHeroPoints();
    const actors = getCharacterRoster();

    if (!actors.length) {
        ui.notifications?.warn("No character actors found.");
        return;
    }

    let managerDialog;
    managerDialog = new Dialog({
        title: "Hero Points",
        content: managerMarkup(actors, max),
        buttons: {
            close: {
                label: "Close"
            }
        },
        render: (html) => {
            const awardList = html.find(".hero-points-award-list");

            function resizeManagerDialog() {
                requestAnimationFrame(() => managerDialog.setPosition({ height: "auto" }));
            }

            function sortRows(container, selector) {
                const rows = container.children(selector).get();
                rows.sort((left, right) => String(left.dataset.sortName).localeCompare(String(right.dataset.sortName)));
                container.prepend(rows);
            }

            function updateAwardSelection() {
                const selected = awardList.find("input[name='actor']:checked").length;
                html.find("[data-selected-count]").text(selected);
                html.find(".hero-points-apply-award").prop("disabled", selected === 0);
            }

            function updateAwardRow(actor) {
                const state = getHeroPointState(actor);
                const total = getHeroPointTotal(state, max);
                const row = awardList.find(`.hero-points-award-row[data-actor-id="${actor.id}"]`);
                row.find('[data-point-value="ephemeral"]').text(state.ephemeral);
                row.find('[data-point-value="persistent"]').text(state.persistent);
                row.find('[data-point-value="total"]').text(total);
                row.find(".hero-points-point-summary")
                    .attr("aria-label", `Session ${state.ephemeral}, persistent ${state.persistent}, total ${total} of ${max}`);
                row.find(".hero-points-summary-session").attr("title", `Session: ${state.ephemeral}`);
                row.find(".hero-points-summary-persistent").attr("title", `Persistent: ${state.persistent}`);
                row.find(".hero-points-summary-total").attr("title", `Total: ${total}/${max}`);
            }

            function refreshAwardRows() {
                for (const actor of getCharacterRoster().filter(isActorInUse)) {
                    updateAwardRow(actor);
                }
            }

            function updateRosterCounts() {
                for (const inUse of [true, false]) {
                    const list = html.find(`[data-roster-list="${inUse}"]`);
                    const count = list.find(".hero-points-roster-row").length;
                    html.find(`[data-roster-count="${inUse}"]`).text(count);
                    html.find(`[data-empty-roster="${inUse}"]`).toggleClass("visible", count === 0);
                }

                const awardCount = awardList.find(".hero-points-award-row").length;
                html.find("[data-award-count]").text(awardCount);
                html.find("[data-empty-awards]").toggleClass("visible", awardCount === 0);
                updateAwardSelection();
                resizeManagerDialog();
            }

            async function moveRosterActor(actorId, targetInUse) {
                const actor = game.actors.get(actorId);
                if (!actor || isActorInUse(actor) === targetInUse) return;

                const rosterRow = html.find(`.hero-points-roster-row[data-actor-id="${actorId}"]`);
                rosterRow.addClass("saving");

                try {
                    await actor.setFlag(MODULE_ID, IN_USE_FLAG, targetInUse);

                    const targetList = html.find(`[data-roster-list="${targetInUse}"]`);
                    const moveButton = rosterRow.find(".hero-points-roster-move");
                    moveButton.attr("data-target-in-use", String(!targetInUse));
                    moveButton.html(targetInUse
                        ? '<i class="fas fa-arrow-down"></i> Move out'
                        : '<i class="fas fa-arrow-up"></i> Move in');
                    targetList.prepend(rosterRow.detach());
                    sortRows(targetList, ".hero-points-roster-row");

                    const existingAwardRow = awardList.find(`.hero-points-award-row[data-actor-id="${actorId}"]`);
                    if (targetInUse && !existingAwardRow.length) {
                        awardList.prepend($(awardRowMarkup(actor, max)));
                        sortRows(awardList, ".hero-points-award-row");
                    } else if (!targetInUse) {
                        existingAwardRow.remove();
                    }

                    updateRosterCounts();
                } catch (error) {
                    ui.notifications?.error(`Could not update ${actor.name}'s roster status.`);
                    console.error(`${MODULE_ID} | Could not update roster status:`, error);
                } finally {
                    rosterRow.removeClass("saving");
                }
            }

            html.find("[data-tab]").on("click", (event) => {
                const tab = event.currentTarget.dataset.tab;
                html.find("[data-tab]").removeClass("active").attr("aria-selected", "false");
                $(event.currentTarget).addClass("active").attr("aria-selected", "true");
                html.find("[data-panel]").prop("hidden", true);
                html.find(`[data-panel="${tab}"]`).prop("hidden", false);
                resizeManagerDialog();
            });

            html.find("details").on("toggle", resizeManagerDialog);

            html.find("[data-select-awards]").on("click", (event) => {
                const checked = event.currentTarget.dataset.selectAwards === "all";
                awardList.find("input[name='actor']").prop("checked", checked);
                updateAwardSelection();
            });

            html.on("change", ".hero-points-award-row input[name='actor']", updateAwardSelection);

            html.find("[data-amount-step]").on("click", (event) => {
                const input = html.find('input[name="amount"]');
                const current = Number(input.val()) || 0;
                const step = Number(event.currentTarget.dataset.amountStep) || 0;
                input.val(Math.min(max, Math.max(-max, current + step)));
            });

            html.find('input[name="mode"]').on("change", (event) => {
                const label = event.currentTarget.value === "set" ? "Apply Adjustment" : "Award Points";
                html.find(".hero-points-apply-award").html(`<i class="fas fa-star"></i> ${label}`);
            });

            html.find(".hero-points-apply-award").on("click", async () => {
                const form = html[0].querySelector("form.hero-points-manager");
                if (!form) return;

                const formData = new FormData(form);
                const mode = formData.get("mode") || "add";
                const kind = formData.get("kind") || "persistent";
                const amount = Number(formData.get("amount") || 0);
                const actorIds = Array.from(form.querySelectorAll(".hero-points-award-row input[name='actor']:checked"))
                    .map((input) => input.value);

                if (!actorIds.length) {
                    ui.notifications?.warn("Select at least one character.");
                    return;
                }

                const affectedNames = [];
                const applyButton = html.find(".hero-points-apply-award");
                applyButton.prop("disabled", true);

                try {
                    for (const id of actorIds) {
                        const actor = game.actors.get(id);
                        if (!actor || !isActorInUse(actor)) continue;

                        const current = getHeroPointState(actor);
                        const next = mode === "set"
                            ? setHeroPoints(current, kind, amount, max)
                            : addHeroPoints(current, kind, amount, max);

                        if (statesMatch(current, next)) continue;
                        await setHeroPointState(actor, next);
                        affectedNames.push(actor.name);
                        updateAwardRow(actor);
                    }

                    if (!affectedNames.length) {
                        ui.notifications?.warn("The selected hero-point values were already at their limits.");
                        return;
                    }

                    const verb = mode === "set" ? "set to" : "modified by";
                    const list = affectedNames.map(escapeHtml).join(", ");
                    const pool = kind === "ephemeral" ? "Session hero points" : "Persistent hero points";
                    await sendChatWithRollMode({
                        content: `<p>${pool} for <strong>${list}</strong> ${verb} <strong>${amount}</strong>.</p>`,
                        speaker: ChatMessage.getSpeaker({ user: game.user })
                    });
                } finally {
                    updateAwardSelection();
                }
            });

            html.find(".hero-points-session-start").on("click", () => {
                openSessionStartDialog(refreshAwardRows);
            });

            html.on("click", ".hero-points-roster-move", (event) => {
                const row = $(event.currentTarget).closest(".hero-points-roster-row");
                moveRosterActor(row.attr("data-actor-id"), event.currentTarget.dataset.targetInUse === "true");
            });

            html.on("dragstart", ".hero-points-roster-row", (event) => {
                const dragEvent = event.originalEvent;
                dragEvent.dataTransfer.setData("text/plain", event.currentTarget.dataset.actorId);
                dragEvent.dataTransfer.effectAllowed = "move";
                $(event.currentTarget).addClass("dragging");
            });

            html.on("dragend", ".hero-points-roster-row", (event) => {
                $(event.currentTarget).removeClass("dragging");
                html.find(".hero-points-roster-section").removeClass("drag-over");
            });

            html.on("dragover", ".hero-points-roster-section", (event) => {
                event.preventDefault();
                event.originalEvent.dataTransfer.dropEffect = "move";
                html.find(".hero-points-roster-section").removeClass("drag-over");
                $(event.currentTarget).addClass("drag-over");
            });

            html.on("drop", ".hero-points-roster-section", (event) => {
                event.preventDefault();
                event.stopPropagation();
                const section = $(event.currentTarget);
                const actorId = event.originalEvent.dataTransfer.getData("text/plain");
                html.find(".hero-points-roster-section").removeClass("drag-over");
                moveRosterActor(actorId, section.attr("data-in-use") === "true");
            });

            updateAwardSelection();
        }
    }, {
        width: 640,
        classes: ["hero-points-manager-dialog"]
    });
    managerDialog.render(true);
}

function openSessionStartDialog(onComplete) {
    const actors = getCharacterRoster().filter(isActorInUse);

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

                    await onComplete?.();
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

    if (!footer.find(".hero-points-manager-open").length) {
        const manageButton = $(`
      <button type="button" class="hero-points-manager-open">
        <i class="fas fa-star"></i> Hero Points
      </button>
    `);

        manageButton.on("click", (event) => {
            event.preventDefault();
            openHeroPointsDialog();
        });

        footer.append(manageButton);
    }

    log("Added GM Hero Points manager button to Actor directory.");
});
