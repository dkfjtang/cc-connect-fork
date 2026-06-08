#!/usr/bin/env node
import { runDev } from "../src/cli/dev.js";

const exitCode = await runDev();
process.exit(exitCode);
