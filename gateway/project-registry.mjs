// Project registry for the merged workspace.
// The registry (../registry/projects.json) is the single list of every project
// folder under ../projects. This module validates it, reports which standalone
// apps are available, and serves those apps under /apps/<id>/ from the same
// origin so the command center can open them without a second server.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
export const APP_ROOT = resolve(__dirname, '..');
export const PROJECTS_DIR = join(APP_ROOT, 'projects');
export const REGISTRY_PATH = join(APP_ROOT, 'registry', 'projects.json');

const STAGE_IDS = new Set(['sense', 'verify', 'act', 'finance', 'prove']);
const APP_ID = /^[a-z0-9][a-z0-9-]*$/;

export const APP_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.csv': 'text/csv; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

// Validates the registry shape and returns the project list. Throws with a
// message that names the broken entry, so a bad edit fails at startup.
export function parseRegistry(raw) {
  if (!raw || !Array.isArray(raw.projects)) throw new Error('registry: "projects" must be an array');
  const seen = new Set();
  for (const project of raw.projects) {
    if (!project || typeof project.id !== 'string' || !APP_ID.test(project.id)) {
      throw new Error(`registry: invalid project id ${JSON.stringify(project?.id)}`);
    }
    if (seen.has(project.id)) throw new Error(`registry: duplicate project id ${project.id}`);
    seen.add(project.id);
    if (!Array.isArray(project.stages) || project.stages.some((stage) => !STAGE_IDS.has(stage))) {
      throw new Error(`registry: ${project.id} has an unknown stage`);
    }
    if (project.folder != null && (typeof project.folder !== 'string' || project.folder.includes('/') || project.folder.includes('\\') || project.folder.startsWith('.'))) {
      throw new Error(`registry: ${project.id} folder must be a single folder name`);
    }
    if (project.local && (typeof project.local.root !== 'string' || !project.folder)) {
      throw new Error(`registry: ${project.id} local app needs a folder and a root`);
    }
  }
  return raw.projects;
}

export function loadRegistry(path = REGISTRY_PATH) {
  return parseRegistry(JSON.parse(readFileSync(path, 'utf8')));
}

// Absolute directory that serves a project's standalone app, or null.
export function localAppRoot(project) {
  if (!project.local || !project.folder) return null;
  return resolve(PROJECTS_DIR, project.folder, project.local.root);
}

// Each registry entry that declares a standalone app, with whether its entry
// page is present on disk. Used by /api/v1/projects so the UI never links to a
// missing app.
export function listProjectApps(projects) {
  return projects
    .filter((project) => project.local)
    .map((project) => {
      const root = localAppRoot(project);
      return {
        id: project.id,
        path: `/apps/${project.id}/`,
        available: existsSync(join(root, 'index.html')),
        build: project.local.build ?? null,
      };
    });
}

// Resolves a request path inside /apps/<id>/ to a file. Returns { status, filePath }.
// Refuses traversal and anything outside the declared root, including encoded
// separators.
export function resolveAppFile(projects, appId, rawRelative) {
  const project = projects.find((item) => item.id === appId && item.local);
  if (!project) return { status: 404 };
  const root = localAppRoot(project);
  let relative;
  try {
    relative = decodeURIComponent(rawRelative || '');
  } catch {
    return { status: 400 };
  }
  if (relative.includes('\0')) return { status: 400 };
  let target = normalize(join(root, relative));
  if (target !== root && !target.startsWith(root + sep)) return { status: 403 };
  if (existsSync(target) && statSync(target).isDirectory()) target = join(target, 'index.html');
  if (!existsSync(target) || !statSync(target).isFile()) return { status: 404 };
  return { status: 200, filePath: target };
}

export function appContentType(filePath) {
  return APP_MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
}
