import { resolve } from "node:path";
import { ViemClearanceRegistryReader } from "@rovaulta/chain-client";
import { parseClearanceRecord } from "@rovaulta/domain";
import type { ApplicationStore } from "../application/index.js";
import { readEnvironment } from "../environment.js";
import { createGraphReaderFromEnvironment } from "../graph/index.js";
import type { ReleaseService } from "../release/index.js";
import { DeploymentCatalog, parseDeploymentCatalogEntry } from "./catalog.js";
import { DeploymentAgent } from "./deployment-agent.js";
import { GeminiDeploymentModel } from "./gemini-model.js";
import { DeploymentAgentError } from "./types.js";

export * from "./catalog.js";
export * from "./deployment-agent.js";
export * from "./gemini-model.js";
export * from "./tools.js";
export * from "./types.js";

export function createDeploymentAgentFromEnvironment(
  releaseService: ReleaseService,
  environment: NodeJS.ProcessEnv = process.env,
  applicationStore?: ApplicationStore,
): DeploymentAgent {
  const apiKey = environment.GEMINI_API_KEY;
  const model = readEnvironment(environment, "GEMINI_MODEL");
  const catalogPath = readEnvironment(environment, "ROVAULTA_AGENT_CATALOG_PATH");
  const normalizedCatalogPath = catalogPath?.trim() || undefined;
  const rpcUrl = environment.EVM_RPC_URL || environment.SEPOLIA_RPC_URL;
  if (!apiKey || !rpcUrl) {
    throw new DeploymentAgentError(
      "PROVIDER_UNAVAILABLE",
      "AI provider and Sepolia RPC configuration are required",
    );
  }
  const graphConfigured =
    (readEnvironment(environment, "THE_GRAPH_STUDIO_QUERY_URL")?.trim() || "") !== "" ||
    ((readEnvironment(environment, "THE_GRAPH_API_KEY")?.trim() || "") !== "" &&
      (readEnvironment(environment, "THE_GRAPH_SUBGRAPH_ID")?.trim() || "") !== "");
  const accountResolver =
    applicationStore === undefined
      ? undefined
      : (accountId: string, _request: unknown, clearanceInput: unknown) => {
          const clearance = parseClearanceRecord(clearanceInput);
          const context = applicationStore.getDeploymentContext(
            accountId,
            clearance.evaluationId,
            clearance,
          );
          return parseDeploymentCatalogEntry({
            key: context.evaluation.evaluationId,
            aliases: {
              site: Array.from(
                new Set([
                  context.evaluation.siteId,
                  context.evaluation.siteId.replace(/^site:/, ""),
                ]),
              ),
              robot: Array.from(
                new Set([
                  context.evaluation.robotId,
                  context.evaluation.robotId.replace(/^robot:/, ""),
                ]),
              ),
              build: Array.from(
                new Set([
                  context.evaluation.robotBuildId,
                  context.evaluation.robotBuildId.replace(/^robot-build:/, ""),
                ]),
              ),
            },
            target: {
              siteId: context.evaluation.siteId,
              robotId: context.evaluation.robotId,
              robotBuildId: context.evaluation.robotBuildId,
              robotBuildDigest: context.evaluation.robotBuildDigest,
            },
            evaluation: {
              evaluationId: context.evaluation.evaluationId,
              verdict: context.evaluation.verdict === "CLEAR" ? "CLEAR" : "HOLD",
            },
            clearance: context.clearance,
          });
        };
  return new DeploymentAgent({
    model: new GeminiDeploymentModel({
      apiKey,
      ...(model === undefined ? {} : { model }),
    }),
    ...(normalizedCatalogPath === undefined
      ? {}
      : { catalog: DeploymentCatalog.fromFile(resolve(process.cwd(), normalizedCatalogPath)) }),
    reader: new ViemClearanceRegistryReader(rpcUrl),
    releaseService,
    ...(accountResolver === undefined ? {} : { accountResolver }),
    ...(graphConfigured ? { graphReader: createGraphReaderFromEnvironment(environment) } : {}),
  });
}
