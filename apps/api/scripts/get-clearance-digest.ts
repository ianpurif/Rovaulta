import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { clearanceRecordToTransport } from "@rovaulta/chain-client";

const targetPath = resolve(process.cwd(), process.argv[2] || ".data/clearance-live.json");
const clearance = JSON.parse(readFileSync(targetPath, "utf8"));
const transport = clearanceRecordToTransport(clearance);
process.stdout.write(`${transport.clearanceDigest}\n`);
