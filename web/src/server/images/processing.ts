import sharp from "sharp";

import { createWorkGate } from "../../lib/async/work";

sharp.concurrency(2);

/** Admission precedes source loading; ingestion and regional preparation share memory. */
export const processImage = createWorkGate(1);
