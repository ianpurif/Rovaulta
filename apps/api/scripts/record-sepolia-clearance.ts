import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  clearanceRecordToTransport,
  ROVAULTA_REGISTRY_ABI,
  ROVAULTA_SEPOLIA_DEPLOYMENT,
  ViemClearanceRegistryReader,
  ZERO_BYTES32,
} from "@rovaulta/chain-client";
import { type ClearanceRecord, compareUnixTimestamps, parseUnixTimestamp } from "@rovaulta/domain";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  parseEventLogs,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  createApplicationStoreFromEnvironment,
  createClearanceRecordFromEvaluation,
} from "../src/application/index.js";

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const CONFIRMATION = "YES";

type RecordedEventArgs = {
  readonly clearanceDigest: Hex;
  readonly clearanceIdHash: Hex;
  readonly robotBuildDigest: Hex;
  readonly verdict: Hex;
  readonly issuer: Address;
  readonly issuedAt: bigint;
  readonly expiresAt: bigint;
};

type BindingEventArgs = {
  readonly clearanceDigest: Hex;
  readonly siteIdHash: Hex;
  readonly robotIdHash: Hex;
  readonly robotBuildIdHash: Hex;
  readonly safetyEnvelopeIdHash: Hex;
  readonly safetyEnvelopeCommitment: Hex;
  readonly evaluatorVersionHash: Hex;
  readonly evaluationIdHash: Hex;
  readonly evaluationInputsDigest: Hex;
};

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function positiveIntegerEnvironment(name: string, fallback: number): bigint {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw.length === 0) return BigInt(fallback);
  if (!/^[1-9][0-9]{0,8}$/.test(raw)) throw new Error(`${name} must be a positive integer`);
  const value = BigInt(raw);
  if (value > 31_536_000n) throw new Error(`${name} must not exceed one year`);
  return value;
}

function assertSame(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`Registry event ${label} did not match the request`);
}

function publicErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length <= 180) {
    return error.message
      .replace(/https?:\/\/[^\s)]+/gi, "[rpc-url]")
      .replace(/0x[0-9a-fA-F]{64}/g, "[hex]");
  }
  return "Sepolia clearance issuance failed closed";
}

function validateReceiptEvents(
  logs: readonly unknown[],
  transport: ReturnType<typeof clearanceRecordToTransport>,
  issuer: Address,
): void {
  const decoded = parseEventLogs({
    abi: ROVAULTA_REGISTRY_ABI,
    logs: logs as never,
    strict: false,
  });
  const recorded = decoded.filter((log) => log.eventName === "ClearanceRecorded");
  const bindings = decoded.filter((log) => log.eventName === "ClearanceBindingsRecorded");
  if (recorded.length !== 1 || bindings.length !== 1) {
    throw new Error("Registry receipt did not contain exactly one record and binding event");
  }

  const recordedArgs = recorded[0]?.args as RecordedEventArgs | undefined;
  const bindingArgs = bindings[0]?.args as BindingEventArgs | undefined;
  if (recordedArgs === undefined || bindingArgs === undefined) {
    throw new Error("Registry receipt event arguments were malformed");
  }

  assertSame(recordedArgs.clearanceDigest, transport.clearanceDigest, "clearanceDigest");
  assertSame(recordedArgs.clearanceIdHash, transport.bindings.clearanceIdHash, "clearanceIdHash");
  assertSame(
    recordedArgs.robotBuildDigest,
    transport.bindings.robotBuildDigest,
    "robotBuildDigest",
  );
  assertSame(recordedArgs.verdict, transport.verdict, "verdict");
  assertSame(recordedArgs.issuer.toLowerCase(), issuer.toLowerCase(), "issuer");
  assertSame(recordedArgs.issuedAt, transport.bindings.issuedAt, "issuedAt");
  assertSame(recordedArgs.expiresAt, transport.bindings.expiresAt, "expiresAt");

  assertSame(bindingArgs.clearanceDigest, transport.clearanceDigest, "binding clearanceDigest");
  assertSame(bindingArgs.siteIdHash, transport.bindings.siteIdHash, "siteIdHash");
  assertSame(bindingArgs.robotIdHash, transport.bindings.robotIdHash, "robotIdHash");
  assertSame(bindingArgs.robotBuildIdHash, transport.bindings.robotBuildIdHash, "robotBuildIdHash");
  assertSame(
    bindingArgs.safetyEnvelopeIdHash,
    transport.bindings.safetyEnvelopeIdHash,
    "safetyEnvelopeIdHash",
  );
  assertSame(
    bindingArgs.safetyEnvelopeCommitment,
    transport.bindings.safetyEnvelopeCommitment,
    "safetyEnvelopeCommitment",
  );
  assertSame(
    bindingArgs.evaluatorVersionHash,
    transport.bindings.evaluatorVersionHash,
    "evaluatorVersionHash",
  );
  assertSame(bindingArgs.evaluationIdHash, transport.bindings.evaluationIdHash, "evaluationIdHash");
  assertSame(
    bindingArgs.evaluationInputsDigest,
    transport.bindings.evaluationInputsDigest,
    "evaluationInputsDigest",
  );
}

function writePublicClearance(path: string, clearance: ClearanceRecord): void {
  const target = resolve(process.cwd(), path);
  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target)) throw new Error("ROVAULTA_CLEARANCE_OUTPUT_PATH already exists");
  writeFileSync(target, `${JSON.stringify(clearance, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

async function run(): Promise<void> {
  if (process.env.ROVAULTA_CLEARANCE_CONFIRM?.trim() !== CONFIRMATION) {
    throw new Error(`Set ROVAULTA_CLEARANCE_CONFIRM=${CONFIRMATION} to authorize a Sepolia write`);
  }

  const accountId = requiredEnvironment("ROVAULTA_CLEARANCE_ACCOUNT_ID");
  const evaluationId = requiredEnvironment("ROVAULTA_CLEARANCE_EVALUATION_ID");
  const clearanceId = requiredEnvironment("ROVAULTA_CLEARANCE_ID");
  const rpcUrl = process.env.EVM_RPC_URL?.trim() || process.env.SEPOLIA_RPC_URL?.trim();
  if (rpcUrl === undefined || rpcUrl.length === 0) {
    throw new Error("EVM_RPC_URL or SEPOLIA_RPC_URL is required");
  }
  const privateKey =
    process.env.SEPOLIA_REGISTRAR_PRIVATE_KEY?.trim() ||
    process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY?.trim();
  if (privateKey === undefined || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("SEPOLIA_REGISTRAR_PRIVATE_KEY is required and must be a 32-byte hex key");
  }

  const dbPath = process.env.ROVAULTA_APP_DB_PATH?.trim() || ".data/rovaulta-app.sqlite";
  if (dbPath === ":memory:" || !existsSync(resolve(process.cwd(), dbPath))) {
    throw new Error("ROVAULTA_APP_DB_PATH must point to an existing account application database");
  }

  const ttlSeconds = positiveIntegerEnvironment(
    "ROVAULTA_CLEARANCE_TTL_SECONDS",
    DEFAULT_TTL_SECONDS,
  );
  const outputPath = process.env.ROVAULTA_CLEARANCE_OUTPUT_PATH?.trim();
  if (
    outputPath !== undefined &&
    outputPath.length > 0 &&
    existsSync(resolve(process.cwd(), outputPath))
  ) {
    throw new Error("ROVAULTA_CLEARANCE_OUTPUT_PATH already exists");
  }

  const account = privateKeyToAccount(privateKey as Hex);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });
  const store = createApplicationStoreFromEnvironment();

  try {
    const evaluation = store.getEvaluation(accountId, evaluationId);
    if (evaluation.verdict !== "CLEAR") {
      throw new Error("The account evaluation is not CLEAR; no registry write was attempted");
    }

    const chainId = await publicClient.getChainId();
    if (chainId !== ROVAULTA_SEPOLIA_DEPLOYMENT.chainId) {
      throw new Error("The configured RPC is not Ethereum Sepolia");
    }
    const blockNumber = await publicClient.getBlockNumber();
    const [block, code, authorized] = await Promise.all([
      publicClient.getBlock({ blockNumber }),
      publicClient.getCode({ address: ROVAULTA_SEPOLIA_DEPLOYMENT.verifyingContract, blockNumber }),
      publicClient.readContract({
        address: ROVAULTA_SEPOLIA_DEPLOYMENT.verifyingContract,
        abi: ROVAULTA_REGISTRY_ABI,
        functionName: "registrars",
        args: [account.address],
        blockNumber,
      }),
    ]);
    if (code === undefined || code === "0x")
      throw new Error("Sepolia registry bytecode is unavailable");
    if (!authorized) throw new Error("The registrar account is not authorized by RovaultaRegistry");

    const issuedAt = parseUnixTimestamp(block.timestamp.toString(), "issuedAt");
    const expiresAt = parseUnixTimestamp((block.timestamp + ttlSeconds).toString(), "expiresAt");
    if (compareUnixTimestamps(expiresAt, issuedAt) <= 0)
      throw new Error("Clearance expiry is invalid");
    const clearance = createClearanceRecordFromEvaluation(evaluation, {
      clearanceId,
      issuedAt,
      expiresAt,
    });
    const transport = clearanceRecordToTransport(clearance);
    if (transport.clearanceDigest === ZERO_BYTES32) throw new Error("Clearance digest is zero");

    const existing = await publicClient.readContract({
      address: ROVAULTA_SEPOLIA_DEPLOYMENT.verifyingContract,
      abi: ROVAULTA_REGISTRY_ABI,
      functionName: "clearanceDigestByIdHash",
      args: [transport.bindings.clearanceIdHash],
      blockNumber,
    });
    if (existing !== ZERO_BYTES32) throw new Error("Clearance id is already registered");

    const simulation = await publicClient.simulateContract({
      account,
      address: ROVAULTA_SEPOLIA_DEPLOYMENT.verifyingContract,
      abi: ROVAULTA_REGISTRY_ABI,
      functionName: "recordClearance",
      args: [transport],
    });
    const transactionHash = await walletClient.writeContract(simulation.request);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: transactionHash,
      confirmations: 1,
    });
    if (receipt.status !== "success") throw new Error("Sepolia registry transaction reverted");
    validateReceiptEvents(receipt.logs, transport, account.address);

    const snapshot = await new ViemClearanceRegistryReader(rpcUrl).readExactClearance(clearance);
    if (!snapshot.exactMatch || snapshot.stored === null) {
      throw new Error("Confirmed registry state did not match the requested clearance");
    }
    if (outputPath !== undefined && outputPath.length > 0) {
      writePublicClearance(outputPath, clearance);
      const digestPath = outputPath.endsWith(".json")
        ? outputPath.replace(/\.json$/, ".digest")
        : `${outputPath}.digest`;
      writeFileSync(resolve(process.cwd(), digestPath), `${transport.clearanceDigest}\n`, "utf8");
    }

    console.log(
      JSON.stringify(
        {
          status: "CONFIRMED",
          execution: "live Sepolia transaction",
          chainId,
          network: ROVAULTA_SEPOLIA_DEPLOYMENT.network,
          contractAddress: ROVAULTA_SEPOLIA_DEPLOYMENT.verifyingContract,
          transactionHash,
          blockNumber: receipt.blockNumber.toString(),
          issuer: account.address,
          evaluationExecutionMode: evaluation.executionMode ?? null,
          creCliVersion: evaluation.creCliVersion ?? null,
          clearanceId: clearance.clearanceId,
          evaluationId: clearance.evaluationId,
          siteId: clearance.inputs.siteId,
          robotId: clearance.inputs.robotId,
          robotBuildId: clearance.inputs.robotBuildId,
          clearanceDigest: transport.clearanceDigest,
          robotBuildDigest: transport.bindings.robotBuildDigest,
          issuedAt: clearance.issuedAt,
          expiresAt: clearance.expiresAt,
          events: {
            clearanceRecorded: true,
            clearanceBindingsRecorded: true,
          },
          publicClearancePath:
            outputPath === undefined || outputPath.length === 0
              ? null
              : resolve(process.cwd(), outputPath),
          verifiedAtBlock: snapshot.blockNumber.toString(),
        },
        null,
        2,
      ),
    );
  } finally {
    store.close();
  }
}

run().catch((error: unknown) => {
  console.error(
    JSON.stringify(
      {
        status: "BLOCKED",
        error: publicErrorMessage(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
