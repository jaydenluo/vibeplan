# Vibe Plan

[中文](README.md) · English

Vibe Plan is a self-hosted collaboration platform for AI-assisted development. It provides web-based project management and task collaboration, plus the `vibeplan` CLI for local Git projects.

## License

This project may be used, modified, and privately deployed by individuals and organizations for personal or internal use. Commercial operation, sale, paid hosting, and commercial SaaS or managed services are prohibited. See [LICENSE](LICENSE) for the full terms. Contact the copyright holder for commercial licensing.

## Quick start

### 1. Create an account and project

Open [Vibe Plan](https://vibeplan.szxinjin.cn/projects), register and sign in, then create or select a project. Keep its project ID.

### 2. Install the CLI

Node.js 22 or newer is required:

```bash
npm install --global @vibeplan/cli@latest
vibeplan --version
```

### 3. Sign in and bind the local project

Run these commands in the root of the local Git project:

```bash
vibeplan login
vibeplan init --project-id PROJECT_ID
```

Replace `PROJECT_ID` with the ID from the website. Check the current login with `vibeplan whoami`.

### 4. Install assistant rules and start synchronization

For Codex:

```bash
vibeplan install-codex
```

For Claude Code:

```bash
vibeplan install-claude
```

Start synchronization in the same project directory:

```bash
vibeplan start
```

Once synchronization is running, ask Codex or Claude Code to add a task to Vibe Plan or implement `TASK_ID`. See [user-guide.md](user-guide.md) for the full guide.

Common daemon commands:

```bash
vibeplan status
vibeplan logs --follow
vibeplan stop
```

## Local development

To develop Vibe Plan itself, install Node.js 22, pnpm 11, and Docker:

```bash
./start.sh
```

- Web: <http://localhost:5173>
- API: <http://localhost:4000>

## Build and test

```bash
pnpm lint
pnpm test
pnpm build
```

## Publish the npm CLI

Configure the npm token:

```bash
cp scripts/tencent-credentials.env.example scripts/tencent-credentials.env
# Set NPM_TOKEN in the file
```

Automatically increment the patch version and publish both packages:

```bash
scripts/publish-npm.sh
```

Publish an explicit version:

```bash
scripts/publish-npm.sh 0.2.0
```

The publish order is `@vibeplan/templates` followed by `@vibeplan/cli`. After publishing, the script exits without waiting for npm registry propagation.

## Publish container images

Set `TENCENT_CCR_USERNAME` and `TENCENT_CCR_PASSWORD` in `scripts/tencent-credentials.env`, then run:

```bash
scripts/build-and-push-tencent.sh
```

You can also specify a version or publish npm at the same time:

```bash
scripts/build-and-push-tencent.sh 0.2.0
scripts/build-and-push-tencent.sh --publish-npm
```

Deployment files are in `deploy/server/`.
