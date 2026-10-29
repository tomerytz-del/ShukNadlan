/** מה שחוזר לקורא הציבורי. כפילות בלי מזהה ובלי קריטריונים. */

export function publicSavedSearchBody(
  result: Record<string, unknown> | null | undefined,
  assignedToAgency: boolean,
): Record<string, unknown> {
  if (result?.duplicate === true) {
    const labels = Array.isArray(result.saved_labels)
      ? result.saved_labels.filter((x): x is string => typeof x === "string")
      : [];
    return { success: true, duplicate: true, saved_labels: labels };
  }
  return { ...(result || {}), assigned_to_agency: assignedToAgency };
}
