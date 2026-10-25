// Display-only translation of raw upstream source ids into the names shown to people.
// The ids themselves (junksnap, clearsky, teesri, vayu) stay as stable keys in data, URLs and tests;
// only the text rendered on screen goes through these helpers.

const SOURCE_DISPLAY: Record<string, string> = {
  junksnap: 'DumpWatch',
  clearsky: 'AshAlert',
  teesri: 'TapAlert',
  vayu: 'AirPulse',
};

const ID_PATTERN = /\b(junksnap|clearsky|teesri|vayu)\b/gi;

/** Replace raw source ids inside a provenance string (operation, schema, source) with display names. */
export function displayText(value: string): string {
  return value.replace(ID_PATTERN, (match, _id: string, offset: number, whole: string) => {
    const name = SOURCE_DISPLAY[match.toLowerCase()];
    // Ids joined with '-' or '/' (for example "junksnap-feature-collection") keep their lowercase id style.
    const next = whole[offset + match.length];
    return next === '-' || next === '/' || whole[offset - 1] === '-' ? name.toLowerCase() : name;
  });
}

/** The upstream hostname is an implementation detail; show which service it belongs to instead. */
export function displayEndpoint(source: string, url: string | null | undefined): string {
  if (!url) return 'Unavailable';
  return `${SOURCE_DISPLAY[source] ?? 'Upstream'} public API`;
}
