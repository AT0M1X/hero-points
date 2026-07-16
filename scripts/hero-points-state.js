function toPointCount(value) {
    return Math.max(0, Math.trunc(Number(value) || 0));
}

function toMaximum(value) {
    return Math.max(0, Math.trunc(Number(value) || 0));
}

export function resolveRosterStatus(storedValue, hasPlayerOwner) {
    return typeof storedValue === "boolean" ? storedValue : Boolean(hasPlayerOwner);
}

/**
 * Normalize a hero-point state while preserving persistent points first.
 */
export function normalizeHeroPointState(state = {}, maximum = 0) {
    const max = toMaximum(maximum);
    const source = state && typeof state === "object" ? state : {};
    const persistent = Math.min(toPointCount(source.persistent), max);
    const ephemeral = Math.min(toPointCount(source.ephemeral), max - persistent);

    return { persistent, ephemeral };
}

export function getHeroPointTotal(state, maximum) {
    const normalized = normalizeHeroPointState(state, maximum);
    return normalized.persistent + normalized.ephemeral;
}

/**
 * Spend ephemeral points before persistent points.
 */
export function spendHeroPoint(state, maximum) {
    const next = normalizeHeroPointState(state, maximum);

    if (next.ephemeral > 0) {
        next.ephemeral -= 1;
        return { state: next, spent: "ephemeral" };
    }

    if (next.persistent > 0) {
        next.persistent -= 1;
        return { state: next, spent: "persistent" };
    }

    return { state: next, spent: null };
}

/**
 * Add to one point pool. Positive persistent awards replace ephemeral points
 * when necessary so the more valuable award is never lost at the maximum.
 */
export function addHeroPoints(state, kind, amount, maximum) {
    const max = toMaximum(maximum);
    const next = normalizeHeroPointState(state, max);
    const delta = Math.trunc(Number(amount) || 0);

    if (kind === "ephemeral") {
        if (delta >= 0) {
            next.ephemeral = Math.min(next.ephemeral + delta, max - next.persistent);
        } else {
            next.ephemeral = Math.max(0, next.ephemeral + delta);
        }
        return next;
    }

    if (kind !== "persistent") {
        throw new TypeError(`Unknown hero-point kind: ${kind}`);
    }

    if (delta < 0) {
        next.persistent = Math.max(0, next.persistent + delta);
        return next;
    }

    const freeCapacity = max - next.persistent - next.ephemeral;
    const pointsInFreeCapacity = Math.min(delta, freeCapacity);
    const remainingAward = delta - pointsInFreeCapacity;
    const replacedEphemeral = Math.min(remainingAward, next.ephemeral);

    next.persistent += pointsInFreeCapacity + replacedEphemeral;
    next.ephemeral -= replacedEphemeral;
    return next;
}

/**
 * Set one point pool. Persistent points retain priority over ephemeral points.
 */
export function setHeroPoints(state, kind, amount, maximum) {
    const max = toMaximum(maximum);
    const next = normalizeHeroPointState(state, max);
    const target = Math.min(toPointCount(amount), max);

    if (kind === "persistent") {
        next.persistent = target;
        next.ephemeral = Math.min(next.ephemeral, max - next.persistent);
        return next;
    }

    if (kind === "ephemeral") {
        next.ephemeral = Math.min(target, max - next.persistent);
        return next;
    }

    throw new TypeError(`Unknown hero-point kind: ${kind}`);
}

/**
 * Begin a session with one ephemeral point when persistent points leave room.
 */
export function resetEphemeralHeroPoint(state, maximum) {
    const next = normalizeHeroPointState(state, maximum);
    next.ephemeral = next.persistent < toMaximum(maximum) ? 1 : 0;
    return next;
}
