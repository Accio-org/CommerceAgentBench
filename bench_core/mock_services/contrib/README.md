# Contributed mock services (staging)

Community mock environments land here first. This directory is the intake stage
of the benchmark, not a holding pen beside it.

## Where this is going

Services staged here are **intended for promotion**. The plan is to migrate them
into the shipped set progressively, building out real workflow cases against
each one as it goes, and to publish the result as the test set of a subsequent
Commerce Agent Bench release.

That is what the staging step is *for*. A replica service on its own is
infrastructure; what makes it a benchmark is the set of real workflows an agent
has to complete against it. Landing the service first, then growing that case
set with it in the repository, is how a contributed mock becomes a scored
domain instead of stalling at the door.

So the migration is the expected outcome, not an exception. What it is not is a
same-release guarantee: promotion moves on the release cadence, in the order the
case work is ready, and a service may be revised or renamed along the way.

## What staging means until then

- **Nothing here is in the runtime image.** `docker/openclaw/Dockerfile.all-mocks`
  copies services one by one, by name, from the directory above this one. A
  service in `contrib/` is never copied, so it cannot affect a run.
- **Nothing here is in `MOCK_SERVICE_REGISTRY`.** That registry is the record of
  what the benchmark currently ships; a staged service gets its entry when it is
  promoted, not before. `scripts/validate_release.py` fails the release if a
  registry entry points into this directory.
- **Nothing here is scored yet.** Published results are unaffected by anything
  in this directory, which is exactly why work can land here early.

What a merge into `contrib/` *does* mean is that the work is accepted, credited,
and public. Your [`CONTRIBUTORS.md`](../../../CONTRIBUTORS.md) row lands with
that merge — it does not wait for promotion.

## Licensing applies on arrival, not on promotion

Code and assets here are in the repository, published to GitHub, and
distributed under the repository's Apache-2.0 terms like everything outside
`datasets_domain_v1/`. "Not promoted yet" is not a holding pen for the licence
question — distribution has already happened.

So the asset audit in
[`CONTRIBUTING.md`](../../../CONTRIBUTING.md) is a condition of merging *here*:
mirrored stylesheets, webfonts, icons, product photography, and captured
third-party responses must be redistributable or replaced with an original
equivalent, and recorded in
[`THIRD_PARTY_NOTICES.md`](../../../THIRD_PARTY_NOTICES.md) when kept. No real
personal data, credentials, or customer records.

The rest of the bar — determinism, server-side validation, a verifier readout,
committed seed data — is checked at promotion, when the service is actually
run. It is still the bar; it is only assessed later.

## Layout

One directory per service, named as the service would be named once promoted
(the eventual `MOCK_SERVICE_REGISTRY` key):

```
contrib/
  acme_crm/
    README.md      # what it replicates, ports, verifier readout, seed shape
    server.js
    ...
```

Pick a name that does not collide with an existing service in the directory
above, and say in your `README.md` which port the service wants — promotion has
to fit it into a flat namespace (`/opt/mock_services/<name>`, one port space),
so collisions are cheaper to find now than then.

## Running one locally

Staged services are outside the image but *inside* the Docker build context —
the context is `bench_core/mock_services`, this directory's parent — so
you can build and run one without relocating any files.

Add a copy line to `docker/openclaw/Dockerfile.all-mocks`, placed with the other
`COPY` lines and **before** the final `RUN` that chowns `/opt/mock_services` to
`mocksvc`, so your service picks up the same ownership and permissions:

```dockerfile
COPY contrib/acme_crm/ /opt/mock_services/acme_crm/
```

Note the destination has no `contrib/` in it. `install_path` is flat for every
service, staged or not. If your service needs dependencies installed, mirror the
`RUN cd /opt/mock_services/<name> && bun install …` block an adjacent service
uses.

Then build and point your task's `base_images` at the local tag:

```bash
docker build --platform linux/amd64 \
  -f docker/openclaw/Dockerfile.all-mocks \
  -t realreplicabench/openclaw:dev \
  bench_core/mock_services
```

Revert the `COPY` line before you commit. It belongs in the promotion commit,
not in the one that stages the service.

## Promotion

A maintainer step, on the release cadence rather than per merge:

1. **Build out the real workflow cases.** Enough tasks against the service that
   promoting it adds a domain rather than a single scenario, each one a state
   change a real user of the replicated product would actually make, each with a
   deterministic verifier. This is the substantive step and usually the long
   one; the rest is mechanical. Contributors are welcome to do it with us —
   staged services stay open for case work.
2. Confirm the promotion bar in [`CONTRIBUTING.md`](../../../CONTRIBUTING.md) —
   determinism, server-side validation, verifier readout, committed seed data.
3. `git mv contrib/<name> ../<name>`
4. Add the `MOCK_SERVICE_REGISTRY` entry — source dir, install path, kind, port,
   health path, launcher.
5. Add the `COPY` line and any dependency-install block to
   `Dockerfile.all-mocks`.
6. Bake a new image on a **new tag**, run the tasks, then repin with
   `python scripts/repin_runtime_image.py --new-digest sha256:<new>`.
7. Flip the service's `CONTRIBUTORS.md` row from `staged` to `shipped`.

Steps 3–5 travel together — `scripts/validate_release.py` fails the release if
one of them is missing. A mock-behaviour change is a scoring change, so step 6
is a version boundary; see
[`CONTRIBUTING.md`](../../../CONTRIBUTING.md).
