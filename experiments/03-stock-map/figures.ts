// What each panel and box of Lim et al.'s figures plots, and where it sits on the page, so the paper
// panel can link them into the model. The variable lists follow the authors' plotting notebook
// ("OSM Graphing - Main Paper v3.ipynb"); positions are in PDF points with the origin top-left.

export type RunKey = "Base" | "Pos" | "Neg" | "NoFent";
export type Rect = [x0: number, y0: number, x1: number, y1: number];

export type Series = {
  label: string;
  run: RunKey;
  terms: string[];
  kind: "sim" | "data" | "data-line";
  color: string;
  dash?: string;
  from?: number;
  normalizeAt?: number;
};

export type Chart = { unit: string; divisor: number; series: Series[]; bands?: { between: [number, number]; color: string }[] };
export type Panel = { id: string; title: string; rect?: Rect; from: number; to: number; charts: Chart[] };
export type DiagramPart = { id: string; title: string; rect: Rect; description: string; terms: string[] };
export type Loop = { id: string; title: string; rect: Rect; color: string; description: string; variables: string[] };

export type Figure = {
  kind: "figure";
  id: string;
  label: string;
  title: string;
  page: number;
  rect: Rect;
  caption: string;
  runs: RunKey[];
  panels: Panel[];
  parts?: DiagramPart[];
  loops?: Loop[];
  made: { figure: string; notebookFind: string };
  caveats: string[];
};

const BLUE = "#1f77b4";
const ORANGE = "#ff7f0e";
const GREEN = "#2ca02c";
const RED = "#d62728";
const DATA = "#9a9a9a";
const LEFT: [number, number] = [36, 291];
const RIGHT: [number, number] = [291, 550];

export const FIGURES: Figure[] = [
  {
    kind: "figure",
    id: "fig1",
    label: "Fig. 1",
    title: "Overview of key transitions and feedback effects",
    page: 2,
    rect: [36, 556, 550, 745],
    caption:
      "A map of the model: people move between misuse, use disorder, treatment and remission, and die of overdoses. Coloured circles mark feedback loops that make transition rates respond to the state of the crisis.",
    runs: ["Base"],
    panels: [],
    parts: [
      {
        id: "misuse",
        title: "Misuse",
        rect: [93, 621, 176, 672],
        description: "People misusing prescription opioids, or using heroin without a use disorder.",
        terms: ["rx misuse no py heroin", "nondisordered heroin use"],
      },
      {
        id: "oud",
        title: "Opioid use disorder",
        rect: [214, 621, 282, 672],
        description: "People with a use disorder and not in treatment: Rx only, Rx and heroin, heroin.",
        terms: ["rx oud no py heroin no moud", "rx oud with py heroin no moud", "hud no moud"],
      },
      {
        id: "treatment",
        title: "Treatment",
        rect: [327, 621, 397, 672],
        description: "People receiving medication for opioid use disorder (buprenorphine, methadone or Vivitrol).",
        terms: ["total by moud"],
      },
      {
        id: "remission",
        title: "Remission",
        rect: [327, 560, 397, 611],
        description: "People in early remission, who can still relapse at a high rate.",
        terms: ["rx oud no heroin in remission", "rx oud with heroin in remission", "hud in remission"],
      },
      {
        id: "stable",
        title: "Stable remission",
        rect: [428, 560, 499, 611],
        description: "People in stable remission, with a much lower relapse rate.",
        terms: ["rx oud no heroin in stable remission", "rx oud with heroin in stable remission", "hud in stable remission"],
      },
      {
        id: "deaths",
        title: "Total fatal overdoses",
        rect: [187, 681, 227, 701],
        description: "Overdose deaths per year across all groups.",
        terms: ["total overdose deaths"],
      },
    ],
    loops: [
      {
        id: "si",
        title: "Social influence",
        rect: [436, 628, 522, 640],
        color: "#3b7dd8",
        description: "The more people use, the more others start: initiation and use disorder rise with the number of current users.",
        variables: [
          "social influence strength developing hud",
          "social influence strength developing rx oud",
          "social influence strength initiating heroin with rx oud",
          "social influence strength initiating ndhu no rx",
          "social influence strength initiating ndhu with rx",
          "social influence strength initiating rx misuse",
        ],
      },
      {
        id: "pr",
        title: "Perceived risk",
        rect: [436, 643, 522, 655],
        color: "#e07b24",
        description: "Overdoses make opioids look riskier, which discourages starting and encourages quitting.",
        variables: [
          "perceived risk strength initiating heroin with rx use",
          "perceived risk strength initiating ndhu no rx",
          "perceived risk strength initiating rx misuse diverted",
          "perceived risk strength initiating rx misuse own rx",
          "perceived risk strength net quit heroin with rx oud",
          "perceived risk strength net quit ndhu",
          "perceived risk strength net quit ndhu with rx",
          "perceived risk strength net quit rx misuse",
        ],
      },
      {
        id: "av",
        title: "Street availability",
        rect: [436, 674, 536, 686],
        color: "#8e6bbf",
        description: "How easy prescription opioids and heroin are to get on the street, which depends on how many people demand them.",
        variables: [
          "heroin availability strength developing hud",
          "heroin availability strength initiating ndhu no rx",
          "heroin availability strength net quit ndhu",
          "rx availability strength developing rx oud",
          "rx availability strength initiating rx misuse",
          "rx availability strength net quit rx misuse",
          "rx vs h availability strength developing hud with rx oud",
          "rx vs h availability strength initiating heroin with rx oud",
          "rx vs h availability strength initiating ndhu with rx",
        ],
      },
    ],
    made: { figure: "", notebookFind: "" },
    caveats: [
      "The diagram itself is drawn by hand; it is not generated from the model. The boxes are linked to the stocks they summarise.",
      "Switching a loop off sets its strengths to 1e-6 without re-fitting, like the authors' crude loop knockout run (LK_*.cin). Their full test re-estimates the other parameters.",
      "The treatment availability loop has no knockout set in the authors' analysis, so it has no switch here.",
    ],
  },
  {
    kind: "figure",
    id: "fig2",
    label: "Fig. 2",
    title: "Model fit to data for selected variables",
    page: 3,
    rect: [36, 32, 550, 574],
    caption:
      "Simulated output (blue) against historical data (gray) for initiation, use disorder prevalence and overdose deaths, 1999–2020. Sources: NSDUH (initiation, use disorder), NVSS (overdose deaths).",
    runs: ["Base"],
    panels: [
      fitPanel("inrt", "Total Rx misuse initiation", [LEFT[0], 52, LEFT[1], 207], ["inrm", "inrd"], 1e6, "millions/year"),
      fitPanel("inht", "Total heroin initiation", [RIGHT[0], 52, RIGHT[1], 207], ["inht"], 1e6, "millions/year"),
      fitPanel("rout", "Total Rx opioid use disorder", [LEFT[0], 208, LEFT[1], 363], ["roud", "rouh"], 1e6, "millions"),
      fitPanel("hud", "Heroin use disorder", [RIGHT[0], 208, RIGHT[1], 363], ["hud"], 1e6, "millions"),
      fitPanel("odrb", "Overdose deaths (Rx opioids only)", [LEFT[0], 364, LEFT[1], 540], ["odrb"], 1e3, "thousands/year"),
      fitPanel("odhc", "Overdose deaths (heroin & illicit synthetics)", [RIGHT[0], 364, RIGHT[1], 540], ["odhc"], 1e3, "thousands/year"),
    ],
    made: { figure: "X8_fits_main.pdf", notebookFind: "PLOT MAIN FITS AND PROJECTIONS" },
    caveats: [
      "The gray error bars (95% CIs from DataErr) are computed in the authors' Python post-processing, not in the model, so they are not redrawn here.",
      "Panels that add two series (total Rx misuse initiation, total Rx OUD) are sums of the model's calibration variables, as in the notebook.",
    ],
  },
  {
    kind: "figure",
    id: "fig3",
    label: "Fig. 3",
    title: "Changes in transitions, hazard rates and source populations",
    page: 4,
    rect: [36, 32, 550, 376],
    caption:
      "For five transitions: the flow (top), its per-person hazard rate (middle) and the population it draws from (bottom), the last two relative to 1999. A flow can change because the risk changed or because the group at risk grew.",
    runs: ["Base"],
    panels: [
      ratePanel("a", "A) Initiating Rx misuse from medical use", [60, 45, 162, 336], "initiating rx misuse own rx", "initiation rate rx misuse own rx effective", "patients with current month opioid rx"),
      ratePanel("b", "B) Initiating heroin from Rx misuse", [163, 45, 252, 336], "initiating heroin with rx misuse", "initiation rate heroin with rx misuse effective", "rx misuse no py heroin"),
      ratePanel("c", "C) Initiating heroin from Rx OUD", [253, 45, 345, 336], "initiating heroin with rx oud", "initiation rate heroin with rx oud effective", "rx oud no py heroin no moud"),
      ratePanel("d", "D) Overdose death from Rx OUD (no H use)", [346, 45, 456, 336], "overdose death rx oud no h", "overdose death rate rx oud no h", "rx oud no py heroin no moud"),
      ratePanel("e", "E) Overdose death from HUD", [457, 45, 550, 336], "overdose death hud", "overdose death rate hud", "hud no moud"),
    ],
    made: { figure: "X8_rates_3row_noUD.pdf", notebookFind: "PLOT RATE-STOCK-HAZARD GRAPHS" },
    caveats: ["The shaded 95% credible bands come from re-running 5,000 MCMC parameter samples; only the best-fit run is redrawn here."],
  },
  {
    kind: "figure",
    id: "fig4",
    label: "Fig. 4",
    title: "Impacts of naloxone and IMF on opioid overdose deaths",
    page: 4,
    rect: [299, 460, 550, 746],
    caption:
      "Deaths averted by layperson naloxone (green shading) and excess deaths due to illicitly manufactured fentanyl (red shading). Dashed lines are observed data.",
    runs: ["Base", "NoFent"],
    panels: [
      {
        id: "main",
        title: "Overdose deaths (people/year)",
        rect: [299, 462, 550, 682],
        from: 1999,
        to: 2020,
        charts: [
          {
            unit: "people/year",
            divisor: 1,
            series: [
              { label: "Baseline (data)", run: "Base", terms: ["total overdose deaths nvss"], kind: "data-line", color: BLUE, dash: "5,3" },
              { label: "Baseline (simulated)", run: "Base", terms: ["total overdose deaths"], kind: "sim", color: BLUE },
              {
                label: "No layperson naloxone (simulated)",
                run: "Base",
                terms: ["total overdose deaths", "nx utilization deaths averted rx user", "nx utilization deaths averted h user"],
                kind: "sim",
                color: GREEN,
              },
              { label: "No synthetic opioids (data)", run: "Base", terms: ["total overdose deaths base rx nvss", "total overdose deaths base heroin nvss"], kind: "data-line", color: RED, dash: "5,3" },
              { label: "No IMF (simulated counterfactual)", run: "NoFent", terms: ["total overdose deaths"], kind: "sim", color: RED },
            ],
            bands: [
              { between: [1, 2], color: GREEN },
              { between: [1, 4], color: RED },
            ],
          },
        ],
      },
    ],
    made: { figure: "X8_fentnxodsingle.pdf", notebookFind: "PLOT FENTANYL AND NALOXONE COUNTERFACTUALS" },
    caveats: [
      "“No layperson naloxone” is not a separate run: it adds the deaths the model says naloxone averted back onto the baseline.",
      "“No IMF” is a separate run (NoFentHist.cin) that rewrites history so illicit fentanyl never arrives.",
    ],
  },
  {
    kind: "figure",
    id: "fig5",
    label: "Fig. 5",
    title: "Projections under three sets of assumptions",
    page: 6,
    rect: [36, 32, 550, 574],
    caption:
      "Simulated history and projections to 2032 under Exogenous Trends Continue (blue), optimistic (orange) and pessimistic (green) assumptions about the inputs in Table 1.",
    runs: ["Base", "Pos", "Neg"],
    panels: [
      projPanel("inrt", "Total Rx misuse initiation", [LEFT[0], 52, LEFT[1], 205], ["inrm", "inrd"], 1e6, "millions/year"),
      projPanel("inht", "Total heroin initiation", [RIGHT[0], 52, RIGHT[1], 205], ["inht"], 1e6, "millions/year"),
      projPanel("rout", "Total Rx opioid use disorder", [LEFT[0], 206, LEFT[1], 358], ["roud", "rouh"], 1e6, "millions"),
      projPanel("hud", "Heroin use disorder", [RIGHT[0], 206, RIGHT[1], 358], ["hud"], 1e6, "millions"),
      projPanel("odrt", "Overdose deaths (Rx + Rx synthetics)", [LEFT[0], 359, LEFT[1], 524], ["odrb", "odsb"], 1e3, "thousands/year"),
      projPanel("odhc", "Overdose deaths (heroin & illicit synthetics)", [RIGHT[0], 359, RIGHT[1], 524], ["odhc"], 1e3, "thousands/year"),
    ],
    made: { figure: "X8_fits_proj_scens.pdf", notebookFind: "PLOT TRIPLE SCENARIO PROJECTIONS FIGURE" },
    caveats: ["The 95% credible bands come from 5,000 MCMC parameter samples; only the best-fit runs are redrawn here."],
  },
];

function fitPanel(id: string, title: string, rect: Rect, elements: string[], divisor: number, unit: string): Panel {
  return {
    id,
    title,
    rect,
    from: 1999,
    to: 2020,
    charts: [
      {
        unit,
        divisor,
        series: [
          { label: "Simulated", run: "Base", terms: elements.map((e) => `simvar[${e}]`), kind: "sim", color: BLUE },
          { label: "Historical", run: "Base", terms: elements.map((e) => `datavar[${e}]`), kind: "data", color: DATA },
        ],
      },
    ],
  };
}

function projPanel(id: string, title: string, rect: Rect, elements: string[], divisor: number, unit: string): Panel {
  const terms = elements.map((e) => `simvar[${e}]`);
  return {
    id,
    title,
    rect,
    from: 1999,
    to: 2032,
    charts: [
      {
        unit,
        divisor,
        series: [
          { label: "Exogenous trends continue (ETC)", run: "Base", terms, kind: "sim", color: BLUE },
          { label: "Optimistic", run: "Pos", terms, kind: "sim", color: ORANGE, from: 2020 },
          { label: "Pessimistic", run: "Neg", terms, kind: "sim", color: GREEN, from: 2020 },
        ],
      },
    ],
  };
}

function ratePanel(id: string, title: string, rect: Rect, flow: string, hazard: string, source: string): Panel {
  return {
    id,
    title,
    rect,
    from: 1999,
    to: 2020,
    charts: [
      { unit: "thousand people/year", divisor: 1e3, series: [{ label: "Transition", run: "Base", terms: [flow], kind: "sim", color: BLUE }] },
      { unit: "hazard rate, relative to 1999", divisor: 1, series: [{ label: "Hazard rate", run: "Base", terms: [hazard], kind: "sim", color: RED, normalizeAt: 1999 }] },
      { unit: "source population, relative to 1999", divisor: 1, series: [{ label: "Source population", run: "Base", terms: [source], kind: "sim", color: GREEN, normalizeAt: 1999 }] },
    ],
  };
}
