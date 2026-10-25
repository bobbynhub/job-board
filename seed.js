import { normalizeJob } from "./lib.js";
import { demoJobs } from "./public/demo.js";
export function seedJobs() {
  return demoJobs().map(normalizeJob);
}
