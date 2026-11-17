const TEMPLATE_ACTION = /\{\{[\s\S]*?\}\}/g
const MASK = "\u0000"
const MASKED_ONLY = /^[\s\u0000]*$/

/**
 * Hides the `{{ }}` actions of Go templates, as in Helm charts, so that a YAML parser reads the rest.
 * An action that shares its line with other text turns into a run of `_`, a plain scalar: `name: {{ .Values.name }}` reads `name: ____…`.
 * A line holding nothing but actions and blanks turns into blanks, so `{{- if .Values.enabled }}` drops out of the structure.
 * The text keeps its length and its line breaks, so offsets stay those of the file.
 */
export function maskTemplateActions(text: string): string {
    if (!text.includes("{{")) {
        return text
    }
    const masked = text.replace(TEMPLATE_ACTION, (action) => action.replace(/[^\r\n]/g, MASK))
    return masked
        .split("\n")
        .map((line) =>
            line.includes(MASK) ? line.replaceAll(MASK, MASKED_ONLY.test(line) ? " " : "_") : line
        )
        .join("\n")
}
