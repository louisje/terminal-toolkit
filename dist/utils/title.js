export function normalizeTitle(title) {
    const normalized = (title ?? "")
        .replace(/[\u0000-\u001f\u007f]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");
    if (!normalized) {
        return undefined;
    }
    return normalized;
}
export function buildSetWindowTitleSequence(title) {
    const sanitized = title.replace(/[\u0007\u001b]/g, "");
    return `\u001b]0;${sanitized}\u0007`;
}
export function createClientTitleSetter(write) {
    return (title) => {
        const normalized = normalizeTitle(title);
        if (!normalized) {
            return;
        }
        write(buildSetWindowTitleSequence(normalized));
    };
}
//# sourceMappingURL=title.js.map