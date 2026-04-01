export function stripBoldMarkers(text: string): string {
  if (!text) {
    return "";
  }

  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/__/g, "");
}
