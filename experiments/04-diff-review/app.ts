// The state of the review: everything the stock and flow map from experiment 03 needs, drawn from the
// version of the model after the change, with the version before it as the comparison run.

import type { MapApp } from "../03-stock-map/context.ts";
import type { ChangeFile } from "./change-file.ts";
import type { Review } from "./review.ts";

export type ReviewApp = MapApp & {
  changes: ChangeFile[];
  review: Review;
  // The files in changes/, and the what-if files changes add, by path in opioid-model/.
  texts: Map<string, string>;
  // How "Files changed" shows a change: what it does to the model, or the text diff as git shows it.
  diffView: "model" | "raw";
  selectChange: (id: string) => void;
  setDiffView: (view: "model" | "raw") => void;
};

export type PanelView = {
  // Drawn once per change; the others also redraw when the year moves past what they show.
  static?: boolean;
  width: (app: ReviewApp) => number;
  kind: (app: ReviewApp, id: string) => string;
  title: (app: ReviewApp, id: string) => string;
  render: (body: HTMLElement, app: ReviewApp, id: string) => void;
  update?: (body: HTMLElement, app: ReviewApp, id: string) => void;
  focus?: (body: HTMLElement, app: ReviewApp, id: string, spec: string) => void;
  source?: (app: ReviewApp, id: string) => string;
};
