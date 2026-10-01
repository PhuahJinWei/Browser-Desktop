/**
 * A window title as the current skin writes it.
 *
 * Apps title their windows "Document — Program". The 1990s wrote the same thing with a hyphen,
 * "untitled - Paint", and the em dash is one of those details that is wrong without being
 * noticeably wrong — so the classic skin swaps it where titles are drawn, and apps keep one spelling.
 */
export function periodTitle(title: string, classic: boolean): string {
  return classic ? title.replaceAll(' — ', ' - ') : title;
}
