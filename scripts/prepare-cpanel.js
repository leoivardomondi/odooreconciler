const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const deployDir = path.join(rootDir, 'deploy-cpanel');
const zipFile = path.join(rootDir, 'cpanel-deployment.zip');

console.log('[cpanel-pack] Step 1: Running TypeScript build...');
execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });

console.log('[cpanel-pack] Step 2: Preparing staging directory...');
if (fs.existsSync(deployDir)) {
  fs.rmSync(deployDir, { recursive: true, force: true });
}
fs.mkdirSync(deployDir, { recursive: true });

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const file of fs.readdirSync(src)) {
      copyRecursive(path.join(src, file), path.join(dest, file));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

// Copy essential folders and files
const itemsToCopy = [
  'dist',
  path.join('src', 'views'),
  path.join('src', 'public'),
  'package.json',
  'package-lock.json',
  'server.js',
  'passenger.js',
  '.htaccess',
  '.env.example',
  'eng.traineddata',
];

for (const item of itemsToCopy) {
  const srcPath = path.join(rootDir, item);
  const destPath = path.join(deployDir, item);
  if (fs.existsSync(srcPath)) {
    copyRecursive(srcPath, destPath);
    console.log(`  ✓ Copied: ${item}`);
  }
}

// Ensure writable runtime directories exist with .gitkeep
const runtimeDirs = ['storage', 'tmp', 'uploads'];
for (const dir of runtimeDirs) {
  const dirPath = path.join(deployDir, dir);
  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(path.join(dirPath, '.gitkeep'), '', 'utf8');
  console.log(`  ✓ Created runtime dir: ${dir}/`);
}

// Create cPanel zip file
console.log('[cpanel-pack] Step 3: Creating cpanel-deployment.zip...');
if (fs.existsSync(zipFile)) {
  fs.unlinkSync(zipFile);
}

try {
  if (process.platform === 'win32') {
    execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${deployDir}/*' -DestinationPath '${zipFile}' -Force"`, {
      cwd: rootDir,
      stdio: 'inherit',
    });
  } else {
    execSync(`cd "${deployDir}" && zip -r "${zipFile}" .`, {
      cwd: rootDir,
      stdio: 'inherit',
    });
  }
  const zipStats = fs.statSync(zipFile);
  const sizeMb = (zipStats.size / (1024 * 1024)).toFixed(2);
  console.log(`[cpanel-pack] ✓ Successfully created cpanel-deployment.zip (${sizeMb} MB)`);
} catch (err) {
  console.warn('[cpanel-pack] Note: ZIP creation failed or powershell unavailable. Staging files are ready in ./deploy-cpanel/', err.message);
}

console.log('[cpanel-pack] Staging complete at ./deploy-cpanel and ./cpanel-deployment.zip');

