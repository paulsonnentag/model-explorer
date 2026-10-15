---
title: Add relapse from stable remission
author: example, not from the authors
date: 2026-10-15
status: open
kind: New flow
patch: changes/05-stable-relapse.patch
---
In the model, people whose remission from heroin use disorder has stabilized (5+ years) never return to it; they only leave by dying. This adds a flow back into heroin use disorder, at a tenth of the relapse rate from early remission, scaled by the same social influence effect as other relapses.

A made-up change to show a structural diff: a new flow, a new constant, and two stock equations that gain an inflow and an outflow.

## Caveat
The 0.1 is an assumption, not an estimate, and the model was not refitted. The Vensim diagrams were not updated, so the new flow appears on our map but not on the authors' "Treatment & Remission" view.
