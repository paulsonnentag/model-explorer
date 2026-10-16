// Entry point: the model with its panels laid out as a code editor, the files beside the running model.

import { createApp } from "../03-stock-map/app.ts";
import { editorLayout } from "./editor.ts";

createApp(editorLayout(document.getElementById("workbench")!));
