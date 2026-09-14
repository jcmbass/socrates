/**
 * Metro config for the npm-workspaces monorepo, per the official Expo
 * monorepo guide (https://docs.expo.dev/guides/monorepos/):
 *
 * 1. `watchFolders` includes the workspace root so Metro watches and
 *    transpiles `packages/core` and `packages/domain` straight from their
 *    `.ts` sources (both packages ship sources, not builds — see their
 *    package.json `exports` maps).
 * 2. `nodeModulesPaths` resolves modules first from this app's own
 *    node_modules, then from the hoisted root node_modules (where npm
 *    workspaces places `@buxo/*` symlinks and shared deps like `zod`).
 *
 * Subpath imports like `@buxo/core/prompts` resolve through those packages'
 * `exports` maps (Metro resolves package exports by default on this SDK).
 */
/* eslint-disable @typescript-eslint/no-require-imports -- Metro config is CommonJS by contract */
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

module.exports = config;
