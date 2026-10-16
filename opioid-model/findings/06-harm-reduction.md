---
title: Harm reduction saves the most lives, fastest; the small rise in addiction is people being alive
paper: papers/stringfellow-2022-sciadv.pdf
anchors: 6 have the largest and most immediate annual effects | 6 lead to a slight increase in OUD prevalence | 7 An unintended consequence of overdose
source: Stringfellow et al. 2022 (Science Advances), Effects of strategies on annual opioid overdose deaths and OUD prevalence; Fig. 1D
trace: source:model.mdl@what-ifs/policies/FentODRisk.cin>var:fentanyl effect on od rate h max net → map>flow:overdose death hud
trace run: Lower fentanyl overdose risk
trace year: 2032
---

Lowering fentanyl's overdose risk and handing out more naloxone cut deaths more, and sooner, than any other strategy. The people they save are still addicted, so slightly more people have an addiction; combined with other strategies, that rise is offset.

> The fentanyl harm reduction strategy … and increasing naloxone distribution … have the largest and most immediate annual effects on opioid overdose deaths, peaking at reductions of 14.2% for fentanyl harm reduction and 3.4% for naloxone kits, both in 2025. … The overdose harm reduction strategies … lead to a slight increase in OUD prevalence (+1.6% and +0.3%, respectively) because of lives saved.

## Runs

- **No policy**: Trends continue, no policy change.
- **Lower fentanyl overdose risk** (policy FentODRisk): Drug checking and careful dosing cut fentanyl's extra overdose risk by 20%.
- **More naloxone kits** (policy NxKits): 20% more naloxone kits handed out, so fewer overdoses end in death.
- **Policy package** (policy Package): The paper's package 1: both of these with five other strategies, including recovery support.

## Charts

- **Overdose deaths, change against no policy (%)**: total overdose deaths; change from 2020
- **People with addiction, change against no policy (%)**: total with ud; change from 2020
- **Addicted to heroin, change against no policy (%)**: hud total; change from 2020

## Measures

- **Largest cut in deaths**: largest drop in total overdose deaths
- **Deaths 2020–2032**: projected cumulative overdose deaths at end; difference
- **Addiction 2032**: total with ud in 2032; percent

## Paper

Fentanyl harm reduction: 14.2% peak cut in annual deaths (2025), 11.3% fewer cumulative deaths 2022–2032 (more than 61,000 lives), +1.6% OUD prevalence in 2032. Naloxone kits: 3.4% peak cut, +0.3% OUD prevalence. Package 1: 29.9% fewer deaths and 15.1% less OUD in 2032. 'An unintended consequence of overdose harm reduction strategies is a small (<0.7% total) increase in person-years of OUD due to fewer people dying, which is offset when combined with other strategies. Moreover, even with the increased person-years of OUD, the overdose harm reduction strategies still lead to fewer people dying of overdose compared to baseline.'

## Caveat

The two strategies are not modelled alike, so their sizes are not directly comparable. In the paper's words, 'a 20% increase in naloxone distribution in SOURCE equates to an approximately 10% increase in naloxone actually being administered in the event of an overdose', while the fentanyl strategy is a direct cut in fentanyl's excess overdose risk with no specific intervention behind it.
