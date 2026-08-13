/**
 * Keeps navigation confirmation policy independent from React so every link in
 * the teacher shell can use the same rule and it can be regression-tested.
 */
export function shouldAllowNavigation(hasUnsavedChanges: boolean, confirm: () => boolean, isSaving = false) {
  return !isSaving && (!hasUnsavedChanges || confirm());
}

/** Browser history cannot be cancelled directly; callers restore their sentinel entry on block. */
export function shouldRestoreHistoryOnPopstate(hasUnsavedChanges: boolean, confirm: () => boolean, isSaving = false) {
  return isSaving || (hasUnsavedChanges && !confirm());
}
