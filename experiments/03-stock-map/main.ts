// Entry point: the model with its panels laid out as a trail, left to right.

import { createApp } from "./app.ts";
import { trailLayout } from "./trail.ts";

createApp(trailLayout(document.getElementById("trail")!));
