import { verifyReleaseBundle, readReleaseManifest } from './release-bundle.mjs';

const directory = readArgument('--directory') ?? process.argv[2];
if (!directory) throw new Error('core_release_bundle_directory_required');

const manifest = await readReleaseManifest(directory);
const verified = await verifyReleaseBundle(directory, manifest);
process.stdout.write(`${JSON.stringify({
  ok: true,
  gate: 'collector-core-release-bundle',
  directory,
  ...verified,
  browserProfileCreated: false,
  livePlatformRequests: 0
}, null, 2)}\n`);

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}
