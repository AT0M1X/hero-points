const MODULE_ID = "hero-points";

/* ----------------- HELPERS ----------------- */

function log(...args) {
    console.log(`${MODULE_ID} |`, ...args);
}

function clamp(value, min, max) {
    value = Number(value) || 0;
    return Math.min(max, Math.max(min, value));
}

function getHeroPoints(actor) {
    return Number(actor.getFlag(MODULE_ID, "points")) || 0;
}

async function setHeroPoints(actor, value, max) {
    const clamped = clamp(value, 0, max);
    await actor.setFlag(MODULE_ID, "points", clamped);
    return clamped;
}

function getMaxHeroPoints() {
    return game.settings.get(MODULE_ID, "maxPoints");
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
    const current = getHeroPoints(actor);

    const tooltip = "Click to spend a hero point";

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

    function syncDisplay(value) {
        const clamped = clamp(value, 0, max);
        valueSpan.text(clamped);
    }

    // Spend hero point (any owner can do this)
    useButton.on("click", async (event) => {
        event.preventDefault();

        let current = getHeroPoints(actor);
        if (current <= 0) {
            ui.notifications?.warn("No hero points left.");
            return;
        }

        current = await setHeroPoints(actor, current - 1, max);
        syncDisplay(current);

        const speaker = ChatMessage.getSpeaker({ actor });
        sendChatWithRollMode({
            speaker,
            content: `<p><strong>${actor.name}</strong> uses a hero point!</p>`
        });
    });
}


/* ----------------- MASS AWARD DIALOG ----------------- */

function openHeroPointsDialog() {
    const max = getMaxHeroPoints();
    const actors = game.actors.filter(
        (a) => a.type === "character" && a.hasPlayerOwner
    );

    if (!actors.length) {
        ui.notifications?.warn("No player-owned characters found.");
        return;
    }

    let content = `<form class="hero-points-dialog">
    <p>Select which characters to modify and whether to add or set hero points.</p>

    <div class="form-group hero-points-mode">
      <label><input type="radio" name="mode" value="add" checked> Add</label>
      <label><input type="radio" name="mode" value="set"> Set</label>
    </div>

    <div class="form-group">
      <label>Amount</label>
      <input type="number" name="amount" value="1" min="-${max}" max="${max}">
    </div>

    <table class="hero-points-actor-list">
      <thead>
        <tr>
          <th><input type="checkbox" class="hero-points-select-all" checked></th>
          <th>Character</th>
          <th>Current</th>
        </tr>
      </thead>
      <tbody>
  `;

    for (const actor of actors) {
        const current = getHeroPoints(actor);
        content += `
      <tr>
        <td><input type="checkbox" name="actor" value="${actor.id}" checked></td>
        <td>${actor.name}</td>
        <td>${current}</td>
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
                    const amount = Number(formData.get("amount") || 0);

                    const checkboxes = form.querySelectorAll("input[name='actor']:checked");
                    const actorIds = Array.from(checkboxes).map((i) => i.value);

                    if (!actorIds.length) return;

                    const maxPoints = getMaxHeroPoints();
                    const affectedNames = [];

                    for (const id of actorIds) {
                        const actor = game.actors.get(id);
                        if (!actor) continue;

                        const current = getHeroPoints(actor);
                        const newValue = mode === "set" ? amount : current + amount;

                        await setHeroPoints(actor, newValue, maxPoints);
                        affectedNames.push(actor.name);
                    }

                    // Chat summary respecting roll mode
                    const verb = mode === "set" ? "set to" : "modified by";
                    const list = affectedNames.join(", ");
                    const msgContent = `<p>Hero points for <strong>${list}</strong> ${verb} <strong>${amount}</strong>.</p>`;

                    sendChatWithRollMode({
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
            selectAll.on("change", (event) => {
                const checked = event.currentTarget.checked;
                html.find("input[name='actor']").prop("checked", checked);
            });
        }
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

Hooks.once("ready", () => {
    log("Ready. System:", game.system.id, "version:", game.system.version);
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

    if (footer.find(".hero-points-give-all").length) return;

    const button = $(`
    <button type="button" class="hero-points-give-all">
      <i class="fas fa-star"></i> Hero Points
    </button>
  `);

    button.on("click", (event) => {
        event.preventDefault();
        openHeroPointsDialog();
    });

    footer.append(button);
    log("Added GM Hero Points button to Actor directory.");
});
