---
title: Fentanyl's toll is smaller than the raw counts, because it scared people off heroin
paper: papers/lim-2022-pnas.pdf
anchors: 5 the fentanyl surge caused a | 4 there would have been 59,000
source: Lim et al. 2022 (PNAS), Competing Influences of Naloxone and Fentanyl; Fig. 4
loops: perceived risk heroin use relative
---

Without fentanyl fewer people would have died, but more would have started heroin: the deaths fentanyl caused raised the perceived risk of heroin and held use down.

> The fentanyl surge caused a rapid increase in the perceived risk associated with heroin use, which led to less heroin use by 2020 than there would have been otherwise.

## Runs

- **As fitted**: Actual history, the model as calibrated.
- **Without fentanyl** (history NoFentHist): The same history if illicit fentanyl had never entered the heroin supply.

## Charts

- **Opioid overdose deaths**: total overdose deaths; data total overdose deaths nvss
- **People starting heroin**: initiating heroin with rx misuse + initiating heroin with rx oud + initiating heroin no rx; data total heroin initiation data
- **Perceived risk of heroin (1999 = 1)**: perceived risk heroin use relative

## Measures

- **Deaths 1999–2020**: cumulative overdose deaths in 2020; difference
- **Heroin starts 1999–2020**: initiating heroin with rx misuse + initiating heroin with rx oud + initiating heroin no rx summed to 2021; difference

## Paper

59,000 fewer deaths 1999–2020 without fentanyl (90% credible interval 55,000–65,000), against ~228,000 deaths involving synthetic opioids in the raw counts.

## Caveat

Here the gap is about 130,000 by 2020 (91,000 by 2019), and Vensim's own published runs of this model agree, so it is not our engine. The authors' results summary lists 476,507 deaths 'without fentanyl' by 2019, which is what the run with fentanyl reaches by 2019 (476,508 here), and 535,337 − 476,507 = 58,830, the paper's 59,000. The paper's figure may compare the fitted run at two dates; we have not been able to confirm this. The direction holds either way: fewer deaths, more people starting heroin.
