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
const HERO_POINT_FEEDBACK_DURATION = 1600;
const heroPointFeedbackByActor = new Map();
const managerRowFeedbackTimeouts = new WeakMap();

const INSPIRATION_CONTROL_SELECTOR = [
    '.sheet-header button.inspiration[data-action="toggleInspiration"]',
    '.sheet-header [data-application-action="inspiration"]',
    '.sheet-header [data-action="inspiration"]',
    '.sheet-header [data-action="toggleInspiration"]',
    '.sheet-header [data-tooltip*="Inspiration"]',
    '.sheet-header [aria-label*="Inspiration"]'
].join(", ");

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

export function awardNoChangeMessage(mode, amount) {
    if (mode === "set") return "Already at that value";
    if (amount > 0) return "Already at maximum";
    if (amount < 0) return "Already at zero";
    return "No change requested";
}

export function heroPointPopoverMarkup(state, maximum, feedback = null) {
    const max = Math.max(0, Math.trunc(Number(maximum) || 0));
    const normalized = normalizeHeroPointState(state, max);
    const total = getHeroPointTotal(normalized, max);
    const empty = Math.max(0, max - total);
    const instruction = total > 0 ? "Click to spend a hero point" : "No hero points available";
    const feedbackLabel = feedback?.type === "ephemeral" ? "Session point" : "Persistent point";
    const feedbackMarkup = feedback?.type === "empty"
        ? `
        <i class="fas fa-star" aria-hidden="true"></i>
        <strong>No points available</strong>`
        : feedback
            ? `
        <i class="fas fa-star" aria-hidden="true"></i>
        <strong>Hero Point used!</strong>
        <span>${feedbackLabel} · ${total}/${max} remaining</span>`
            : "";

    return `
      <span class="hero-points-popover-details">
        <span class="hero-points-popover-heading">
          <strong>Hero Points</strong>
          <span>${instruction}</span>
        </span>
        <span class="hero-points-popover-bars" aria-hidden="true">
          <span class="hero-points-slots">${heroPointSlotsMarkup(normalized, max)}</span>
        </span>
        <span class="hero-points-popover-breakdown">
          <span class="hero-points-popover-stat hero-points-popover-session">
            <strong>${normalized.ephemeral}</strong><span>Session</span>
          </span>
          <span class="hero-points-popover-stat hero-points-popover-persistent">
            <strong>${normalized.persistent}</strong><span>Persistent</span>
          </span>
          <span class="hero-points-popover-stat hero-points-popover-empty">
            <strong>${empty}</strong><span>Empty</span>
          </span>
        </span>
      </span>
      <span class="hero-points-popover-feedback">
        ${feedbackMarkup}
      </span>
    `;
}

function getHeroPointFeedback(actorId) {
    const feedback = heroPointFeedbackByActor.get(actorId);
    if (!feedback) return null;
    if (feedback.expiresAt > Date.now()) return feedback;

    heroPointFeedbackByActor.delete(actorId);
    return null;
}

function beginHeroPointFeedback(actorId, type) {
    const feedback = {
        type,
        expiresAt: Date.now() + HERO_POINT_FEEDBACK_DURATION,
        animated: false
    };
    heroPointFeedbackByActor.set(actorId, feedback);
    return feedback;
}

function heroPointFeedbackClasses(feedback) {
    if (!feedback) return "";
    const typeClass = feedback.type === "ephemeral"
        ? "hero-points-feedback-session"
        : feedback.type === "persistent"
            ? "hero-points-feedback-persistent"
            : "hero-points-feedback-empty";
    const restoredClass = feedback.animated ? " hero-points-feedback-restored" : "";
    return ` hero-points-feedback-active ${typeClass}${restoredClass}`;
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

function createElementFromMarkup(markup) {
    const template = document.createElement("template");
    template.innerHTML = markup.trim();
    return template.content.firstElementChild;
}

function getRenderElement(value) {
    if (value?.nodeType === 1 && typeof value.querySelector === "function") return value;

    const first = value?.[0];
    if (first?.nodeType === 1 && typeof first.querySelector === "function") return first;

    return null;
}

function getDialogV2() {
    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    if (!DialogV2) throw new Error("Foundry DialogV2 API is unavailable.");
    return DialogV2;
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
    const feedback = getHeroPointFeedback(actor.id);

    const html = `
    <div class="hero-points-counter${heroPointFeedbackClasses(feedback)}" data-actor-id="${actor.id}">
      <a class="hero-points-use" data-action="use-hero-point" role="button" tabindex="0" aria-label="${tooltip}">
        <i class="fas fa-star hero-points-icon"></i>
        <span class="hero-points-number">
          <span class="hero-points-value">${current}</span><span class="hero-points-max">/${max}</span>
        </span>
        <span class="hero-points-popover" aria-hidden="true">${heroPointPopoverMarkup(state, max, feedback)}</span>
      </a>
    </div>
  `;

    return createElementFromMarkup(html);
}

function attachHeroPointsListeners(sheet, counter) {
    const actor = sheet.actor;
    if (!counter) {
        log("attachHeroPointsListeners: no .hero-points-counter found");
        return;
    }

    const valueSpan = counter.querySelector(".hero-points-value");
    const useButton = counter.querySelector(".hero-points-use");
    const popover = counter.querySelector(".hero-points-popover");
    if (!valueSpan || !useButton || !popover) return;

    const max = getMaxHeroPoints();
    const feedbackClasses = [
        "hero-points-feedback-active",
        "hero-points-feedback-session",
        "hero-points-feedback-persistent",
        "hero-points-feedback-empty",
        "hero-points-feedback-restored"
    ];

    function applyFeedback(feedback) {
        if (!feedback) {
            counter.classList.remove(...feedbackClasses);
            return;
        }

        const shouldAnimateEntrance = !counter.classList.contains("hero-points-feedback-active") && !feedback.animated;
        counter.classList.remove(...feedbackClasses);

        // The feedback markup and state class are otherwise applied in the same
        // render cycle, which lets browsers skip the entrance transition.
        if (shouldAnimateEntrance) void counter.offsetWidth;

        counter.classList.add(...heroPointFeedbackClasses(feedback).trim().split(/\s+/));
        feedback.animated = true;

        const remainingDuration = Math.max(0, feedback.expiresAt - Date.now());
        setTimeout(() => {
            const currentFeedback = heroPointFeedbackByActor.get(actor.id);
            if (currentFeedback && currentFeedback.expiresAt !== feedback.expiresAt) return;

            if (currentFeedback) heroPointFeedbackByActor.delete(actor.id);
            counter.classList.remove(...feedbackClasses);
        }, remainingDuration);
    }

    function syncDisplay(state) {
        const tooltip = heroPointTooltip(state, max);
        const feedback = getHeroPointFeedback(actor.id);
        valueSpan.textContent = String(getHeroPointTotal(state, max));
        popover.innerHTML = heroPointPopoverMarkup(state, max, feedback);
        useButton.setAttribute("aria-label", tooltip);
        applyFeedback(feedback);
    }

    applyFeedback(getHeroPointFeedback(actor.id));

    // Spend hero point (any owner can do this)
    useButton.addEventListener("click", async (event) => {
        event.preventDefault();

        const result = spendHeroPoint(getHeroPointState(actor), max);
        if (!result.spent) {
            beginHeroPointFeedback(actor.id, "empty");
            syncDisplay(result.state);
            return;
        }

        beginHeroPointFeedback(actor.id, result.spent);
        syncDisplay(result.state);

        await setHeroPointState(actor, result.state);

        const speaker = ChatMessage.getSpeaker({ actor });
        const pointType = result.spent === "ephemeral" ? "session" : "persistent";
        await sendChatWithRollMode({
            speaker,
            content: `<p><strong>${escapeHtml(actor.name)}</strong> uses a ${pointType} hero point!</p>`
        });
    });

    useButton.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.currentTarget.click();
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

    return `<div class="hero-points-manager">
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
        <button type="button" class="hero-points-apply-award" aria-live="polite" ${inUseActors.length ? "" : "disabled"}>
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
  </div>`;
}

function openHeroPointsDialog() {
    const max = getMaxHeroPoints();
    const actors = getCharacterRoster();

    if (!actors.length) {
        ui.notifications?.warn("No character actors found.");
        return;
    }

    const DialogV2 = getDialogV2();
    const managerDialog = new DialogV2({
        window: { title: "Hero Points" },
        content: createElementFromMarkup(managerMarkup(actors, max)),
        buttons: [{ action: "close", label: "Close" }],
        classes: ["hero-points-manager-dialog"],
        position: { width: 640, height: "auto" }
    });

    managerDialog.addEventListener("render", () => {
        const html = managerDialog.element;
        const awardList = html.querySelector(".hero-points-award-list");
        if (!awardList) return;

        let awardFeedbackTimeout;
        let sessionFeedbackTimeout;
        const query = (selector) => html.querySelector(selector);
        const queryAll = (selector) => Array.from(html.querySelectorAll(selector));

        function resizeManagerDialog() {
            requestAnimationFrame(() => managerDialog.setPosition({ height: "auto" }));
        }

        function sortRows(container, selector) {
            const rows = Array.from(container.children).filter((child) => child.matches(selector));
            rows.sort((left, right) => String(left.dataset.sortName).localeCompare(String(right.dataset.sortName)));
            container.prepend(...rows);
        }

        function updateAwardSelection() {
            const selected = awardList.querySelectorAll("input[name='actor']:checked").length;
            const selectedCount = query("[data-selected-count]");
            const applyButton = query(".hero-points-apply-award");
            if (selectedCount) selectedCount.textContent = String(selected);
            if (applyButton) applyButton.disabled = selected === 0;
        }

        function updateAwardRow(actor, highlightKind = null) {
            const row = awardList.querySelector(`.hero-points-award-row[data-actor-id="${actor.id}"]`);
            if (!row) return;

            const state = getHeroPointState(actor);
            const total = getHeroPointTotal(state, max);
            row.querySelector('[data-point-value="ephemeral"]').textContent = String(state.ephemeral);
            row.querySelector('[data-point-value="persistent"]').textContent = String(state.persistent);
            row.querySelector('[data-point-value="total"]').textContent = String(total);
            row.querySelector(".hero-points-point-summary")
                ?.setAttribute("aria-label", `Session ${state.ephemeral}, persistent ${state.persistent}, total ${total} of ${max}`);
            row.querySelector(".hero-points-summary-session")?.setAttribute("title", `Session: ${state.ephemeral}`);
            row.querySelector(".hero-points-summary-persistent")?.setAttribute("title", `Persistent: ${state.persistent}`);
            row.querySelector(".hero-points-summary-total")?.setAttribute("title", `Total: ${total}/${max}`);

            if (!highlightKind) return;

            const typeClass = highlightKind === "ephemeral"
                ? "hero-points-award-row-updated-session"
                : "hero-points-award-row-updated-persistent";
            const poolPill = row.querySelector(highlightKind === "ephemeral"
                ? ".hero-points-summary-session"
                : ".hero-points-summary-persistent");
            const highlightedPills = [poolPill, row.querySelector(".hero-points-summary-total")].filter(Boolean);
            const existingTimeout = managerRowFeedbackTimeouts.get(row);
            if (existingTimeout) clearTimeout(existingTimeout);

            row.classList.remove(
                "hero-points-award-row-updated",
                "hero-points-award-row-updated-session",
                "hero-points-award-row-updated-persistent"
            );
            for (const pill of highlightedPills) pill.classList.remove("hero-points-summary-updated");
            void row.offsetWidth;
            row.classList.add("hero-points-award-row-updated", typeClass);
            for (const pill of highlightedPills) pill.classList.add("hero-points-summary-updated");

            managerRowFeedbackTimeouts.set(row, setTimeout(() => {
                row.classList.remove(
                    "hero-points-award-row-updated",
                    "hero-points-award-row-updated-session",
                    "hero-points-award-row-updated-persistent"
                );
                for (const pill of highlightedPills) pill.classList.remove("hero-points-summary-updated");
                managerRowFeedbackTimeouts.delete(row);
            }, 1000));
        }

        function restoreAwardButtonLabel() {
            const mode = query('input[name="mode"]:checked')?.value || "add";
            const label = mode === "set" ? "Apply Adjustment" : "Award Points";
            const applyButton = query(".hero-points-apply-award");
            if (applyButton) applyButton.innerHTML = `<i class="fas fa-star"></i> ${label}`;
        }

        function clearAwardFeedback() {
            if (awardFeedbackTimeout) clearTimeout(awardFeedbackTimeout);
            awardFeedbackTimeout = undefined;
            query(".hero-points-apply-award")?.classList.remove("hero-points-award-success", "hero-points-award-limit");
            restoreAwardButtonLabel();
        }

        function showAwardFeedback() {
            const applyButton = query(".hero-points-apply-award");
            if (!applyButton) return;
            if (awardFeedbackTimeout) clearTimeout(awardFeedbackTimeout);
            applyButton.classList.remove("hero-points-award-success", "hero-points-award-limit");
            void applyButton.offsetWidth;
            applyButton.classList.add("hero-points-award-success");
            applyButton.innerHTML = '<i class="fas fa-check"></i> Points updated!';

            awardFeedbackTimeout = setTimeout(() => {
                applyButton.classList.remove("hero-points-award-success", "hero-points-award-limit");
                restoreAwardButtonLabel();
                awardFeedbackTimeout = undefined;
            }, 1500);
        }

        function showAwardLimitFeedback(message) {
            const applyButton = query(".hero-points-apply-award");
            if (!applyButton) return;
            if (awardFeedbackTimeout) clearTimeout(awardFeedbackTimeout);
            applyButton.classList.remove("hero-points-award-success", "hero-points-award-limit");
            void applyButton.offsetWidth;
            applyButton.classList.add("hero-points-award-limit");
            applyButton.innerHTML = `<i class="fas fa-circle-minus"></i> ${message}`;

            awardFeedbackTimeout = setTimeout(() => {
                applyButton.classList.remove("hero-points-award-success", "hero-points-award-limit");
                restoreAwardButtonLabel();
                awardFeedbackTimeout = undefined;
            }, 1500);
        }

        function refreshAwardRows(highlightKind = null, highlightedActorIds = []) {
            const highlightedIds = new Set(highlightedActorIds);
            for (const actor of getCharacterRoster().filter(isActorInUse)) {
                updateAwardRow(actor, highlightedIds.has(actor.id) ? highlightKind : null);
            }
        }

        function restoreSessionStartButton() {
            const startButton = query(".hero-points-session-start");
            if (!startButton) return;
            startButton.classList.remove("hero-points-session-success");
            startButton.innerHTML = '<i class="fas fa-play"></i> Start Session';
        }

        function clearSessionStartFeedback() {
            if (sessionFeedbackTimeout) clearTimeout(sessionFeedbackTimeout);
            sessionFeedbackTimeout = undefined;
            restoreSessionStartButton();
        }

        function showSessionStartFeedback(changedActorIds) {
            const startButton = query(".hero-points-session-start");
            if (!startButton) return;
            if (sessionFeedbackTimeout) clearTimeout(sessionFeedbackTimeout);
            startButton.classList.remove("hero-points-session-success");
            void startButton.offsetWidth;
            startButton.classList.add("hero-points-session-success");
            startButton.innerHTML = '<i class="fas fa-check"></i> Session started!';
            refreshAwardRows("ephemeral", changedActorIds);

            sessionFeedbackTimeout = setTimeout(() => {
                restoreSessionStartButton();
                sessionFeedbackTimeout = undefined;
            }, 1600);
        }

        function updateRosterCounts() {
            for (const inUse of [true, false]) {
                const list = query(`[data-roster-list="${inUse}"]`);
                const count = list?.querySelectorAll(".hero-points-roster-row").length || 0;
                const countElement = query(`[data-roster-count="${inUse}"]`);
                const emptyElement = query(`[data-empty-roster="${inUse}"]`);
                if (countElement) countElement.textContent = String(count);
                emptyElement?.classList.toggle("visible", count === 0);
            }

            const awardCount = awardList.querySelectorAll(".hero-points-award-row").length;
            const awardCountElement = query("[data-award-count]");
            if (awardCountElement) awardCountElement.textContent = String(awardCount);
            query("[data-empty-awards]")?.classList.toggle("visible", awardCount === 0);
            updateAwardSelection();
            resizeManagerDialog();
        }

        async function moveRosterActor(actorId, targetInUse) {
            const actor = game.actors.get(actorId);
            if (!actor || isActorInUse(actor) === targetInUse) return;

            const rosterRow = query(`.hero-points-roster-row[data-actor-id="${actorId}"]`);
            if (!rosterRow) return;
            rosterRow.classList.add("saving");

            try {
                await actor.setFlag(MODULE_ID, IN_USE_FLAG, targetInUse);

                const targetList = query(`[data-roster-list="${targetInUse}"]`);
                const moveButton = rosterRow.querySelector(".hero-points-roster-move");
                moveButton.dataset.targetInUse = String(!targetInUse);
                moveButton.innerHTML = targetInUse
                    ? '<i class="fas fa-arrow-down"></i> Move out'
                    : '<i class="fas fa-arrow-up"></i> Move in';
                targetList.prepend(rosterRow);
                sortRows(targetList, ".hero-points-roster-row");

                const existingAwardRow = awardList.querySelector(`.hero-points-award-row[data-actor-id="${actorId}"]`);
                if (targetInUse && !existingAwardRow) {
                    awardList.prepend(createElementFromMarkup(awardRowMarkup(actor, max)));
                    sortRows(awardList, ".hero-points-award-row");
                } else if (!targetInUse) {
                    existingAwardRow?.remove();
                }

                updateRosterCounts();
            } catch (error) {
                ui.notifications?.error(`Could not update ${actor.name}'s roster status.`);
                console.error(`${MODULE_ID} | Could not update roster status:`, error);
            } finally {
                rosterRow.classList.remove("saving");
            }
        }

        html.addEventListener("click", async (event) => {
            const target = event.target.closest?.("button, a");
            if (!target || !html.contains(target)) return;

            if (target.matches("[data-tab]")) {
                const tab = target.dataset.tab;
                for (const button of queryAll("[data-tab]")) {
                    button.classList.toggle("active", button === target);
                    button.setAttribute("aria-selected", String(button === target));
                }
                for (const panel of queryAll("[data-panel]")) panel.hidden = panel.dataset.panel !== tab;
                resizeManagerDialog();
                return;
            }

            if (target.matches("[data-select-awards]")) {
                const checked = target.dataset.selectAwards === "all";
                for (const input of awardList.querySelectorAll("input[name='actor']")) input.checked = checked;
                updateAwardSelection();
                return;
            }

            if (target.matches("[data-amount-step]")) {
                const input = query('input[name="amount"]');
                const current = Number(input?.value) || 0;
                const step = Number(target.dataset.amountStep) || 0;
                if (input) input.value = String(Math.min(max, Math.max(-max, current + step)));
                return;
            }

            if (target.matches(".hero-points-apply-award")) {
                const form = managerDialog.form;
                if (!form) return;

                const formData = new FormData(form);
                const mode = formData.get("mode") || "add";
                const kind = formData.get("kind") || "persistent";
                const amount = Number(formData.get("amount") || 0);
                const actorIds = Array.from(awardList.querySelectorAll("input[name='actor']:checked"))
                    .map((input) => input.value);

                if (!actorIds.length) {
                    ui.notifications?.warn("Select at least one character.");
                    return;
                }

                const affectedNames = [];
                clearAwardFeedback();
                target.disabled = true;

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
                        updateAwardRow(actor, kind);
                    }

                    if (!affectedNames.length) {
                        showAwardLimitFeedback(awardNoChangeMessage(mode, amount));
                        return;
                    }

                    const verb = mode === "set" ? "set to" : "modified by";
                    const list = affectedNames.map(escapeHtml).join(", ");
                    const pool = kind === "ephemeral" ? "Session hero points" : "Persistent hero points";
                    showAwardFeedback();
                    await sendChatWithRollMode({
                        content: `<p>${pool} for <strong>${list}</strong> ${verb} <strong>${amount}</strong>.</p>`,
                        speaker: ChatMessage.getSpeaker({ user: game.user })
                    });
                } finally {
                    updateAwardSelection();
                }
                return;
            }

            if (target.matches(".hero-points-session-start")) {
                clearSessionStartFeedback();
                openSessionStartDialog(({ changedActorIds }) => showSessionStartFeedback(changedActorIds));
                return;
            }

            if (target.matches(".hero-points-roster-move")) {
                const row = target.closest(".hero-points-roster-row");
                await moveRosterActor(row?.dataset.actorId, target.dataset.targetInUse === "true");
            }
        });

        html.addEventListener("change", (event) => {
            if (event.target.matches(".hero-points-award-row input[name='actor']")) updateAwardSelection();
            if (event.target.matches('input[name="mode"]')) {
                const applyButton = query(".hero-points-apply-award");
                if (!applyButton?.matches(".hero-points-award-success, .hero-points-award-limit")) {
                    restoreAwardButtonLabel();
                }
            }
        });

        for (const details of queryAll("details")) details.addEventListener("toggle", resizeManagerDialog);

        html.addEventListener("dragstart", (event) => {
            const row = event.target.closest?.(".hero-points-roster-row");
            if (!row || !event.dataTransfer) return;
            event.dataTransfer.setData("text/plain", row.dataset.actorId);
            event.dataTransfer.effectAllowed = "move";
            row.classList.add("dragging");
        });

        html.addEventListener("dragend", (event) => {
            event.target.closest?.(".hero-points-roster-row")?.classList.remove("dragging");
            for (const section of queryAll(".hero-points-roster-section")) section.classList.remove("drag-over");
        });

        html.addEventListener("dragover", (event) => {
            const section = event.target.closest?.(".hero-points-roster-section");
            if (!section) return;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
            for (const candidate of queryAll(".hero-points-roster-section")) candidate.classList.remove("drag-over");
            section.classList.add("drag-over");
        });

        html.addEventListener("drop", (event) => {
            const section = event.target.closest?.(".hero-points-roster-section");
            if (!section || !event.dataTransfer) return;
            event.preventDefault();
            event.stopPropagation();
            const actorId = event.dataTransfer.getData("text/plain");
            for (const candidate of queryAll(".hero-points-roster-section")) candidate.classList.remove("drag-over");
            moveRosterActor(actorId, section.dataset.inUse === "true");
        });

        updateAwardSelection();
    }, { once: true });

    managerDialog.render({ force: true });
}

export function sessionStartMarkup(actors, maximum) {
    const max = Math.max(0, Math.trunc(Number(maximum) || 0));
    const blockedCount = actors.filter((actor) => getHeroPointState(actor).persistent >= max).length;
    const eligibleCount = actors.length - blockedCount;
    const characterLabel = actors.length === 1 ? "character" : "characters";
    const blockedNote = blockedCount
        ? `<p class="hero-points-session-limit-note"><i class="fas fa-circle-info"></i> <strong>${blockedCount}</strong> ${blockedCount === 1 ? "character is" : "characters are"} already at the maximum through persistent points and cannot receive a session point.</p>`
        : "";

    return `
    <div class="hero-points-session-confirmation">
      <header class="hero-points-session-confirmation-header">
        <span class="hero-points-session-confirmation-icon" aria-hidden="true">
          <span class="hero-points-session-play-symbol"></span>
        </span>
        <div>
          <h2>Ready for a new session?</h2>
          <p>Prepare Hero Points for ${actors.length} in-use ${characterLabel}.</p>
        </div>
      </header>

      <div class="hero-points-session-preview" aria-label="Session start preview">
        <span class="hero-points-session-preview-item">
          <strong>${actors.length}</strong><span>In use</span>
        </span>
        <span class="hero-points-session-preview-item hero-points-session-preview-eligible">
          <strong>${eligibleCount}</strong><span>Receive point</span>
        </span>
        <span class="hero-points-session-preview-item hero-points-session-preview-blocked">
          <strong>${blockedCount}</strong><span>At maximum</span>
        </span>
      </div>

      <div class="hero-points-session-rules">
        <div class="hero-points-session-rule hero-points-session-rule-session">
          <i class="fas fa-star"></i>
          <span><strong>Session points</strong><small>Reset for this session</small></span>
          <b>Set to 1</b>
        </div>
        <div class="hero-points-session-rule hero-points-session-rule-persistent">
          <i class="fas fa-bookmark"></i>
          <span><strong>Persistent points</strong><small>Saved between sessions</small></span>
          <b>Unchanged</b>
        </div>
      </div>

      ${blockedNote}
    </div>`;
}

function openSessionStartDialog(onComplete) {
    const actors = getCharacterRoster().filter(isActorInUse);

    if (!actors.length) {
        ui.notifications?.warn("No in-use player characters found.");
        return;
    }

    const max = getMaxHeroPoints();
    const DialogV2 = getDialogV2();
    const sessionDialog = new DialogV2({
        window: { title: "Start Hero Point Session" },
        content: createElementFromMarkup(sessionStartMarkup(actors, max)),
        buttons: [
            { action: "cancel", label: "Cancel" },
            {
                action: "start",
                label: "Start Session",
                default: true,
                callback: async () => {
                    const resetNames = [];
                    const atMaximumNames = [];
                    const changedActorIds = [];

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
                            changedActorIds.push(actor.id);
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

                    await onComplete?.({ changedActorIds, resetNames, atMaximumNames });
                }
            }
        ],
        classes: ["hero-points-session-start-dialog"],
        position: { width: 480, height: "auto" }
    });

    sessionDialog.render({ force: true });
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

        const hookElement = getRenderElement(element);
        const sheetElement = getRenderElement(sheet.element);
        const html = hookElement?.querySelector(".sheet-header") ? hookElement : (sheetElement || hookElement);
        if (!html) {
            log("HTML root is empty, aborting.");
            return;
        }

        // Remove previous widget on re-render
        for (const counter of html.querySelectorAll(".hero-points-counter")) counter.remove();

        // DnD5e 5.3 (the first V14-compatible release) uses the inspiration
        // button selector below. The remaining selectors preserve V13 support.
        let anchor = html.querySelector(INSPIRATION_CONTROL_SELECTOR);
        if (!anchor) {
            anchor = html.querySelector(".sheet-header button i.fa-star")?.closest("button") || null;
        }

        if (anchor) {
            log("Hiding inspiration control:", anchor);
            anchor.classList.add("hero-points-original-hidden");
        }

        // Fallback header area if we didn't find a star button
        if (!anchor) {
            anchor = html.querySelector(
                ".sheet-header .right, .sheet-header .attributes, .sheet-header .resources, " +
                ".sheet-header .summary, .sheet-header"
            );
            if (anchor) {
                log("Using fallback header anchor:", anchor);
            } else {
                log("No suitable anchor found; hero points widget not injected.");
                return;
            }
        }

        const heroEl = createHeroPointsElement(actor);

        // If anchor is one of the header containers, append; otherwise insert after
        if (
            anchor.classList.contains("sheet-header") ||
            anchor.classList.contains("right") ||
            anchor.classList.contains("attributes") ||
            anchor.classList.contains("resources") ||
            anchor.classList.contains("summary")
        ) {
            anchor.append(heroEl);
        } else {
            anchor.insertAdjacentElement("afterend", heroEl);
        }

        log("Hero points widget injected for actor:", actor.name);

        attachHeroPointsListeners(sheet, heroEl);
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
 * ApplicationV2 sheet hook used by the current DnD5e character sheet.
 */
Hooks.on("renderActorSheetV2", (sheet, element, data) => {
    injectHeroPointsGeneric(sheet, element, { hook: "renderActorSheetV2" });
});

/**
 * GM button in the Actor directory footer.
 */
Hooks.on("renderActorDirectory", (app, html, data) => {
    if (!game.user.isGM) return;

    const root = getRenderElement(html) || getRenderElement(app.element);
    if (!root) return;

    const footerSelector = '[data-application-part="footer"], .directory-footer, footer.directory-footer, footer';
    const footer = root.matches(footerSelector)
        ? root
        : root.querySelector(footerSelector);
    if (!footer) return;

    if (!root.querySelector(".hero-points-manager-open")) {
        const manageButton = createElementFromMarkup(`
      <button type="button" class="hero-points-manager-open">
        <i class="fas fa-star"></i> Hero Points
      </button>
    `);

        manageButton.addEventListener("click", (event) => {
            event.preventDefault();
            openHeroPointsDialog();
        });

        footer.append(manageButton);
    }

    log("Added GM Hero Points manager button to Actor directory.");
});
