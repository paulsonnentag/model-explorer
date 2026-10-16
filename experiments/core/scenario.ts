// How a published run is assembled: the equations, then the calibration-weight and projection
// change files, then the fitted parameter values, then one or more scenario files on top.

import type { Override } from "./compile.ts";

export type ScenarioSources = {
  baseChanges: { file: string; overrides: Override[] }[];
  fitted: { target: string; value: number }[];
  scenarios: { name: string; overrides: Override[] }[];
};

export function scenarioOverrides(sources: ScenarioSources, scenarioNames: string[]): Override[] {
  return [
    ...sources.baseChanges.flatMap((c) => c.overrides),
    ...sources.fitted.map(({ target, value }) => ({ target, value })),
    ...scenarioNames.flatMap((name) => sources.scenarios.find((s) => s.name === name)?.overrides ?? []),
  ];
}
