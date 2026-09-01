# Safe upgrades

MD Ops reads files that remain outside the application release. An application update must not rewrite, move, or bundle those files.

## Safety contract

- Pin an explicit release version or immutable container digest.
- Keep configuration and Markdown roots outside the source or image.
- Keep vault mounts read-only unless writing was deliberately enabled.
- Prepare and verify a candidate release separately from the running release.
- Retain the previous release until the candidate passes post-switch checks.
- Back up and test restoration of every write-enabled Markdown root before an upgrade.
- Never put credentials in Git, Compose files, release bundles, or command output.
- Never update production with an in-place `git reset --hard`.

## Source-checkout upgrade

This is the supported manual pattern until a transactional updater is shipped.

1. Record the running version, service configuration, health result, and current release path.
2. Create a new checkout for the target release. Do not reuse the live checkout.
3. Install only from lockfiles and run:

   ```bash
   npm run setup:ci
   npm run verify
   ./scripts/audit-public-tree.sh
   ```

4. Start the candidate on a different loopback port with the same root IDs and equivalent read-only mounts.
5. Check `/readyz`, trusted-host behavior, root listing, and one synthetic or non-sensitive read.
6. Stop the candidate. Switch the service's release pointer or working directory in one reviewed change.
7. Restart only the MD Ops service and repeat the readiness and read checks.
8. If a check fails, restore the previous release pointer and restart. Do not modify note data while diagnosing the release.
9. Keep the previous release until the new version has completed its observation window.

## Container upgrade

1. Record the running image digest and Compose configuration.
2. Pull the new immutable digest without changing the running container.
3. Start a candidate project against a temporary synthetic vault and verify the container.
4. Confirm that production vault mounts remain external and have the intended `ro` or `rw` mode.
5. Replace only the MD Ops service.
6. Verify `/readyz`, trusted-host rejection, mount mode, and the expected browser/API route.
7. On failure, restore the previous digest and recreate only the MD Ops service.

Do not use mutable `latest` tags for unattended updates.

## Write-enabled installations

Writing is separately gated at the API, filesystem, and operation-intent layers. An upgrade must preserve those controls.

Before switching a write-enabled installation:

- create a timestamped backup or filesystem snapshot of each Markdown root;
- verify that the backup can restore at least one synthetic test file;
- preserve root IDs and mount destinations;
- stop concurrent writes during the switch; and
- test conditional-write conflict handling after the upgrade.

Application rollback does not replace note-data recovery. Keep release rollback and data backup as separate controls.

## Website updates

The public site follows a different lane: pull request, required CI/security checks, reviewed merge, manual production approval, Cloudflare Pages deployment, external smoke test, and prior-deployment rollback. See [Public release process](PUBLIC_RELEASE.md).
