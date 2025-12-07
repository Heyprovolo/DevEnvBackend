#!/usr/bin/env node
import "dotenv/config";
import { seedProviders } from "../seed/seedProviders.ts";

seedProviders()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
