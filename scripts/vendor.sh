#!/usr/bin/env bash
# Vendors the publishable build of mppx or machine-fetch at one commit into vendor/<package>.
#
#   scripts/vendor.sh mppx|machine-fetch <repository> <ref>
#
# <repository> is a git URL or a local clone, such as one holding an unpublished branch. The package
# is built and packed as it would be published, and vendor/<package> keeps its dist/, package.json,
# and LICENSE, plus VENDORED with the commit. wallet-cli pins both packages to commits this way until
# it chooses to upgrade. Afterwards delete node_modules and run `pnpm install`: pnpm copies file:
# dependencies into node_modules and does not refresh them otherwise, even with --force.
set -euo pipefail

if [ $# -ne 3 ]; then
  echo "usage: $0 mppx|machine-fetch <repository> <ref>" >&2
  exit 2
fi

package="$1"
repository="$2"
ref="$3"
case "$package" in
mppx | machine-fetch) ;;
*)
  echo "unknown package: $package (expected mppx or machine-fetch)" >&2
  exit 2
  ;;
esac

root="$(cd "$(dirname "$0")/.." && pwd)"
destination="$root/vendor/$package"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

git clone --quiet "$repository" "$work/source"
cd "$work/source"
git -c advice.detachedHead=false checkout --quiet "$ref"
commit="$(git rev-parse HEAD)"
# A build that is not reproducible from the commit VENDORED records is no use.
pnpm install --frozen-lockfile --ignore-scripts --reporter=silent
pnpm build >/dev/null
# mppx strips its development-only `src` export conditions before it publishes.
if [ "$package" = mppx ]; then node --import tsx scripts/prepare:publish.ts; fi
# Packing applies `files` and resolves catalog: and workspace: versions, as publishing does.
pnpm pack --pack-destination "$work" >/dev/null
mkdir "$work/packed"
tar -xzf "$work"/*.tgz -C "$work/packed"

rm -rf "$destination"
mkdir -p "$destination"
cp -R "$work/packed/package/dist" "$destination/dist"
cp LICENSE "$destination/LICENSE"
# Keep what resolution needs. Scripts, dev dependencies, and the CLI binary do not apply here.
node -e '
const fs = require("node:fs");
const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
for (const field of ["scripts", "devDependencies", "pnpm", "packageManager", "publishConfig", "bin", "files"])
  delete pkg[field];
fs.writeFileSync(process.argv[2], `${JSON.stringify(pkg, null, 2)}\n`);
' "$work/packed/package/package.json" "$destination/package.json"
printf '%s\n' "$commit" >"$destination/VENDORED"

echo "Vendored $package $commit into vendor/$package"
