// Entry point: the model with its panels unfolded on a board, each joined to the one it was opened from.

import { createApp } from "../03-stock-map/app.ts";
import { canvasLayout } from "./canvas.ts";

createApp(canvasLayout(document.getElementById("board")!));
