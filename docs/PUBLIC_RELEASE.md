# Public release process

MD Ops is released from a reviewed source snapshot, not from a private development repository or its history.

## Public boundary

The public release may contain:

- application, API, MCP, and site source;
- synthetic examples and screenshots;
- public documentation, tests, and CI configuration; and
- generic local deployment guidance.

It must not contain:

- personal notes or real vault content;
- private hostnames, network addresses, user directories, or service inventories;
- credentials, connection strings, authentication files, or environment files;
- private deployment automation; or
- objects, commits, tags, reflogs, or metadata from a private repository.

A scanner pass means **no configured findings were detected**. It is not proof that disclosure is impossible. The release gate combines automated scanning, an exact-file manifest, and human review.

## Commit 1: clean snapshot

1. Freeze the candidate worktree. Stop unrelated edits during the export.
2. Run the full verification and privacy gates:

   ```bash
   npm run verify
   ./scripts/audit-public-tree.sh
   git diff --check
   ```

3. Export the current source bytes to a new directory:

   ```bash
   ./scripts/export-public-snapshot.sh /path/to/md-ops-public
   ```

   The exporter copies the current tracked and untracked source set, skips files deleted from the worktree, initializes a new Git repository, stages the result, and creates `PUBLIC_SOURCE_MANIFEST.sha256`. It does not create a commit or remote.

4. Review the exported file list and manifest. Run a clean install and all verification in the exported directory.
5. Create the initial commit with the maintainer's GitHub-provided noreply address.
6. Run both tree and full-history audits against that one-commit repository:

   ```bash
   ./scripts/audit-public-tree.sh
   python3 scripts/audit-public-history.py
   ```

7. Re-run Gitleaks against the exact one-commit repository. Record tool version, commit ID, file count, and manifest hash in the release evidence.
8. Create or push the public repository only after explicit publication approval.

Do not graft, filter, force-push, or otherwise transform the private history into the public repository. A fresh source snapshot is easier to inspect and has a smaller disclosure surface.

## Required first-release gates

- Full Linux CI and container verification pass in the exported repository.
- No configured findings in tree, history, dependency, container, and secret scans.
- Synthetic-only examples, fixtures, screenshots, and browser evidence.
- Third-party notices reviewed before distributing images or bundles.
- README and support policy make the one-trusted-operator model explicit.
- macOS and Windows are not claimed until their setup has been exercised.
- The public repository starts with the reviewed snapshot as commit 1.

## Website deployment

`mdops.z4cllc.com` is for the static marketing and documentation site. It is not an ingress for the MD Ops API or a user's note collection.

The production workflow is deliberately manual:

1. Open a pull request from the public repository.
2. Require `ci` and `security-audit` before merge.
3. Merge to `main` without rewriting history.
4. Manually dispatch `.github/workflows/deploy.yml` from `main`.
5. Approve the protected `mdops-site-production` environment.
6. Deploy the exact commit to the `md-ops-site` Cloudflare Pages project.
7. Smoke-test the custom domain and retain the deployment URL and commit ID.
8. If the smoke test fails, roll Cloudflare Pages back to the prior successful production deployment before attempting another release.

The Cloudflare token should be scoped to the minimum Pages permissions for the intended account. The custom domain is attached once; normal site updates do not need DNS write permission.

## Two independent update lanes

### Static site

Pull request → required checks → reviewed merge → manual production approval → Pages deployment → external smoke test → rollback if needed.

Cloudflare Pages keeps previous successful deployments. Use its production rollback control or the documented Pages rollback API. Do not repair production by editing generated `dist/` files.

### Installed MD Ops runtime

MD Ops must not auto-update or reset a live checkout in place. A safe runtime update needs:

1. an explicit version or immutable image digest;
2. configuration and Markdown roots outside the release directory;
3. a separate candidate checkout or container;
4. the full verification suite and a loopback readiness probe before switching;
5. unchanged read-only mount defaults unless the operator deliberately enabled writing;
6. a retained previous release and exact rollback command; and
7. a note backup plus tested restore path before updating any write-enabled installation.

Until a transactional updater implements those guarantees, prepare upgrades in a separate directory and switch only after verification. Never use `git reset --hard` as a production update mechanism.
