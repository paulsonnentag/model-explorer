---
title: Knock out the drug availability loop
author: from the authors' sensitivity analysis
date: 2022-02-04
status: open
kind: Loop knockout
patch: changes/02-knockout-availability.patch
adds: what-ifs/tests/KnockoutAv.cin
published: changes/02-knockout-availability.tsv
---
Sets the strength of every drug availability effect to 0: how available prescription opioids and heroin are no longer changes how many people start misusing, develop a use disorder, or quit. This is the "av" knockout from the authors' sensitivity analysis (lkdict in their control file), which asks how much of the fitted history the loop explains.

The new file applies after the fitted values, so it overrides the nine fitted strengths in every run.

## Published
- The authors ran this twice: with the fitted values kept (X8_lk_run_av, shown as "after") and with the model refitted without the loop (X8_lk_av, "refitted").

## Caveat
We only run the first version. Refitting lets the remaining parameters make up for the missing loop, which is why the refitted run tracks the history again.
