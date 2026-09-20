/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/* Copyright (c) 2026 by Christian Kellner. */

export function useSelector<State, Selected>(selector: (state: State) => Selected): Selected;
export function useActions<Actions>(): Actions;
export function useIsLoading(action: (...arguments_: never[]) => unknown): boolean;
