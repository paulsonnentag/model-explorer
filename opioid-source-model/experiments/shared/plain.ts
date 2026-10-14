// Everyday wording for the model's variable names, shared by every experiment. Groups of people and
// the flows between them get hand-written names; everything else is rewritten abbreviation by
// abbreviation. One preference, stored in the browser, switches it on or off everywhere.

import { describeFlow } from "./flows.ts";
import type { Semantics, VarInfo } from "./semantics.ts";

const PREFERENCE = "source-plain-labels";

export const PLAIN_STOCKS: Record<string, { name: string; description: string }> = {
  "rx misuse no py heroin": {
    name: "Misusing pills, not addicted",
    description: "Takes prescription painkillers in ways a doctor didn't intend (someone else's pills, extra doses, to get high), but is not addicted and hasn't used heroin in the past year.",
  },
  "rx oud no py heroin no moud": {
    name: "Addicted to pills, no treatment",
    description: "Addicted to prescription painkillers, no heroin in the past year, and not taking addiction medication.",
  },
  "rx oud no heroin by moud": {
    name: "Addicted to pills, on medication",
    description: "Addicted to prescription painkillers and taking buprenorphine, methadone or naltrexone. Some are already doing well but stay on the medication.",
  },
  "rx oud no heroin in remission": {
    name: "Recovered from pills, under 5 years",
    description: "No longer addicted to prescription painkillers, for less than five years. Can still relapse.",
  },
  "rx oud no heroin in stable remission": {
    name: "Recovered from pills, 5+ years",
    description: "No longer addicted for more than five years. The model treats this as recovered for good: nobody relapses from here.",
  },
  "rx oud with py heroin no moud": {
    name: "Addicted to pills, tried heroin, no treatment",
    description: "Addicted to prescription painkillers and has used heroin in the past year, but is not (yet) addicted to heroin. Not taking addiction medication.",
  },
  "rx oud with heroin by moud": {
    name: "Addicted to pills, tried heroin, on medication",
    description: "Addicted to prescription painkillers, has used heroin, and is taking addiction medication.",
  },
  "rx oud with heroin in remission": {
    name: "Recovered (pills + heroin), under 5 years",
    description: "Was addicted to pills and used heroin; no longer addicted, for less than five years. Can still relapse.",
  },
  "rx oud with heroin in stable remission": {
    name: "Recovered (pills + heroin), 5+ years",
    description: "No longer addicted for more than five years; treated as recovered for good.",
  },
  "nondisordered heroin use": {
    name: "Using heroin, not addicted",
    description: "Uses heroin but is not addicted. Includes people who moved on from misusing pills to heroin.",
  },
  "hud no moud": {
    name: "Addicted to heroin, no treatment",
    description: "Addicted to heroin (which since about 2014 mostly means fentanyl too) and not taking addiction medication.",
  },
  "hud by moud": {
    name: "Addicted to heroin, on medication",
    description: "Addicted to heroin and taking buprenorphine, methadone or naltrexone. Some are already doing well but stay on the medication.",
  },
  "hud in remission": {
    name: "Recovered from heroin, under 5 years",
    description: "No longer addicted to heroin, for less than five years. Can still relapse.",
  },
  "hud in stable remission": {
    name: "Recovered from heroin, 5+ years",
    description: "No longer addicted for more than five years; treated as recovered for good.",
  },
};

// Earlier rules win, so phrases come before the abbreviations they contain.
const RULES: [RegExp, string][] = [
  [/\bRx OUD no PY heroin\b/g, "pill addiction without heroin"],
  [/\bRx OUD with PY heroin\b/g, "pill addiction with heroin use"],
  [/\bRx OUD no H(eroin)?\b/g, "pill addiction without heroin"],
  [/\bRx OUD with H(eroin)?\b/g, "pill addiction with heroin use"],
  [/\bRx misuse no PY heroin\b/g, "pill misuse without heroin"],
  [/\bRx OUD\b/g, "pill addiction"],
  [/\bRx misuse\b/g, "pill misuse"],
  [/\bno MOUD Tx\b/g, "without medication"],
  [/\bby MOUD\b/g, "on addiction medication"],
  [/\bno MOUD\b/g, "not on addiction medication"],
  [/\bin MOUD Tx\b/g, "on addiction medication"],
  [/\bMOUD\b/g, "addiction medication"],
  [/\bin stable remission\b/gi, "in long-term recovery (5+ years)"],
  [/\bin remission\b/gi, "in recovery (under 5 years)"],
  [/\bremission\b/g, "recovery"],
  [/\bRemission\b/g, "Recovery"],
  [/\bin Tx\b/g, "in treatment"],
  [/\bno PY heroin\b/g, "no heroin in the past year"],
  [/\bwith PY heroin\b/g, "with heroin in the past year"],
  [/\bPY\b/g, "past-year"],
  [/\bNonOD\b|\bnonOD\b/g, "non-overdose"],
  [/\bNFOD\b/g, "non-fatal overdose"],
  [/\bODs\b/g, "overdoses"],
  [/\bOD\b/g, "overdose"],
  [/\bOUD\b/g, "opioid addiction"],
  [/\bHUD\b/g, "heroin addiction"],
  [/\bNDHU\b/g, "non-addicted heroin use"],
  [/\bUD\b/g, "addiction"],
  [/\bTx\b/g, "treatment"],
  [/\bRx\b/g, "prescription"],
  [/\bH\b/g, "heroin"],
  [/\bNx\b/g, "naloxone"],
  [/\bSI\b/g, "social influence"],
  [/\bMMT\b/g, "methadone"],
  [/\bBup\b/g, "buprenorphine"],
  [/\bViv\b/g, "naltrexone (Vivitrol)"],
  [/\bMME\b/g, "morphine-equivalent dose"],
  [/\bADF\b/g, "abuse-deterrent pill"],
  [/\bMU\b/g, "misuse"],
  [/\bOTP\b/g, "methadone clinic"],
  [/\bIMF\b/g, "illicit fentanyl"],
  [/\bsynth\b/gi, "fentanyl-type"],
  [/\bcoeff\b/g, "strength"],
  [/\b100k\b/g, "per 100,000"],
  [/\bNVSS\b/g, "(CDC death records)"],
  [/\bNSDUH\b/g, "(national drug-use survey)"],
  [/\bNESARC\b/g, "(NESARC survey)"],
  [/\bIQVIA\b/g, "(IQVIA pharmacy data)"],
  [/\bRAND\b/g, "(RAND estimate)"],
  [/\bSAMHSA\b/g, "(SAMHSA)"],
  [/\bRDAS\b/g, "(RADARS survey)"],
  [/\bNSSATS\b/g, "(treatment facility survey)"],
  [/\bNFLIS\b/g, "(drug lab data)"],
  [/\bDATA\b/g, "(data)"],
];

export function isPlain(): boolean {
  return localStorage.getItem(PREFERENCE) !== "off";
}

export function setPlain(on: boolean) {
  localStorage.setItem(PREFERENCE, on ? "on" : "off");
}

export function plainToggle(id = "ctl-plain"): string {
  return `<label class="check plain-toggle" title="Everyday wording instead of the model's variable names"><input type="checkbox" id="${id}"${isPlain() ? " checked" : ""}> Plain-language labels</label>`;
}

// Replaces every variable's display name; the original stays in `modelName`.
export function applyPlainNames(sem: Semantics) {
  const names = new Map([...sem.vars.values()].map((info) => [info.key, plainName(sem, info)]));
  for (const [key, name] of names) sem.vars.get(key)!.name = name;
}

export function plainName(sem: Semantics, info: VarInfo): string {
  const stock = PLAIN_STOCKS[info.key];
  if (stock) return stock.name;
  const flow = describeFlow(sem, info);
  const phrase = flow ? plainFlowPhrase(info.key) : null;
  const group = flow ? (flow.from ?? flow.to) : null;
  if (phrase && group && PLAIN_STOCKS[group]) return `${phrase} · ${lowerFirst(PLAIN_STOCKS[group].name)}`;
  return dejargon(info.modelName);
}

export function plainDescription(key: string): string | null {
  return PLAIN_STOCKS[key]?.description ?? null;
}

// What a flow does to the people taking it, without saying which group they are in.
export function plainFlowPhrase(key: string): string | null {
  if (/^overdose death/.test(key)) return "Dies of an overdose";
  if (/^nonod death/.test(key)) return "Dies of other causes";
  if (/own rx/.test(key)) return "Starts misusing their own prescription";
  if (/diverted/.test(key)) return "Starts misusing someone else's pills";
  if (/initiating heroin no rx/.test(key)) return "Starts using heroin (no pill misuse before)";
  if (/initiating heroin/.test(key)) return "Starts using heroin";
  if (/developing hud/.test(key)) return "Becomes addicted to heroin";
  if (/developing rx oud/.test(key)) return "Becomes addicted to pills";
  if (/net quitting heroin/.test(key)) return "Stops using heroin (net)";
  if (/net quitting/.test(key)) return "Stops using (net)";
  if (/tx engagement/.test(key)) return "Starts addiction medication";
  if (/tx exit in remission/.test(key)) return "Finishes medication, no longer addicted";
  if (/tx exit with ud/.test(key)) return "Stops medication while still addicted";
  if (/^remitting/.test(key)) return "Recovers without medication";
  if (/stabilizing/.test(key)) return "Stays recovered for 5 years";
  if (/relaps/.test(key)) return "Relapses into addiction";
  return null;
}

export function dejargon(name: string): string {
  let out = name;
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  out = out.replace(/\s+/g, " ").trim();
  return out.charAt(0).toUpperCase() + out.slice(1);
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
