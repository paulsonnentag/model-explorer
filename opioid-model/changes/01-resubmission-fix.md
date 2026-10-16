---
title: Correct hardcoded policy constants
author: T. Y. Lim
date: 2022-02-17
status: merged
commit: f0b1756
kind: Bug fix
patch: changes/01-resubmission-fix.patch
published: changes/01-resubmission-fix.tsv
---
Committed as "Results update for resubmission" while the PNAS paper was in review. Two policy levers had been left switched on in the model file, so every run, including the baseline the policies are compared against, already had a policy in it from 2022: people with prescription opioid use disorder sought treatment 49% more often, and naloxone kits were distributed slightly more efficiently.

Setting both back to 0 changes nothing before 2022, so the fit to history stands; the projections change, and with them every result that compares a policy with the baseline. The commit also regenerated all results and figures.

> 220214 - Corrected erroneous hardcoding (which assigned nonzero values to some policy change variables)

## Published
- Base − Cnst delta for projected cumulative overdose deaths: −7.05% → −8.96% (X8_summary.txt)
- Base − Cnst delta for projected cumulative UD person years: 8.63% → 8.14% (X8_summary.txt)

## Caveat
The model file changed in three copies in the repository (Vensim Files/, Model & Analysis Replication Package/ and Analysis & Graphing/X8_IterCal/), identically; this is the diff of one.
