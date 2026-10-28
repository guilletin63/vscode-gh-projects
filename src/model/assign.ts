// Labels and assignees: which ids to add and remove to get the values the user chose.

/** GitHub accepts at most 10 assignees per issue, pull request or draft. */
export const MAX_ASSIGNEES = 10;

export interface ListChange {
  add: string[];
  remove: string[];
  /** Every chosen id, in the order chosen (drafts replace their assignees at once). */
  ids: string[];
}

/**
 * Plans the change from `currentIds` to the chosen `keys` (label names, logins; compared
 * without case). Fails on a key that isn't among the choices or on more than `max` keys.
 */
export function planListChange<T extends { id: string }>(
  choices: T[],
  currentIds: string[],
  keys: string[],
  keyOf: (choice: T) => string,
  max?: number,
): ListChange | { error: string } {
  const ids: string[] = [];
  for (const key of keys) {
    const choice = choices.find((c) => keyOf(c).toLowerCase() === key.toLowerCase());
    if (!choice) return { error: `Unknown value: ${key}.` };
    if (!ids.includes(choice.id)) ids.push(choice.id);
  }
  if (max !== undefined && ids.length > max) return { error: `At most ${max} can be chosen.` };
  return { add: ids.filter((id) => !currentIds.includes(id)), remove: currentIds.filter((id) => !ids.includes(id)), ids };
}
